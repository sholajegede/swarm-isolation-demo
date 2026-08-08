"""Kimi K3 through the Moonshot API.

The model id is configuration. It is never written into this file, because
pinned model ids stop working.
"""

from __future__ import annotations

import re
import threading
import time
from typing import Any

import requests

from .config import optional, required


class KimiError(RuntimeError):
    pass


# Moonshot caps how many requests one account may have in flight. Workers run
# in parallel, and several swarms may run at once, so calls are gated here
# rather than left to collide and fail. Set below the account limit when more
# than one swarm process runs at a time.
_MAX_IN_FLIGHT = max(1, int(optional("KIMI_MAX_CONCURRENCY", "3")))
_GATE = threading.Semaphore(_MAX_IN_FLIGHT)

_RETRY_AFTER = re.compile(r"try again after (\d+)", re.IGNORECASE)
_MAX_RATE_LIMIT_RETRIES = 4


class Kimi:
    def __init__(self) -> None:
        self.base_url = required("KIMI_BASE_URL").rstrip("/")
        self.api_key = required("KIMI_API_KEY")
        self.model = required("KIMI_MODEL")
        # kimi-k3 defaults to maximum reasoning effort, which is slow and
        # expensive for work this small. Overridable for a deeper run.
        self.reasoning_effort = optional("KIMI_REASONING_EFFORT", "low")
        self._effort_supported = True

    def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        # Summaries were being cut off mid-sentence at 900.
        max_tokens: int = 1200,
    ) -> dict[str, Any]:
        # No temperature is sent: kimi-k3 accepts only its default, and pinning
        # a value that a future model rejects is the same trap as pinning an id.
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        if self._effort_supported and self.reasoning_effort:
            payload["reasoning_effort"] = self.reasoning_effort

        response = self._post(payload)

        # Not every deployment accepts the effort hint. Drop it and retry only
        # when that is what the API objected to, so a real problem is not
        # silently retried into a different failure.
        if (
            response.status_code == 400
            and self._effort_supported
            and "effort" in response.text.lower()
        ):
            self._effort_supported = False
            payload.pop("reasoning_effort", None)
            response = self._post(payload)

        if response.status_code != 200:
            raise KimiError(f"HTTP {response.status_code}: {response.text[:300]}")

        body = response.json()
        if not body.get("choices"):
            raise KimiError(f"no choices returned: {str(body)[:300]}")
        return body

    def _post(self, payload: dict[str, Any]) -> requests.Response:
        """One request, holding a concurrency slot, retrying on rate limits.

        A rate limit is a "not now", not a "no". Failing the worker over one
        would lose real work for a reason that clears in a second.
        """
        headers = {
            "authorization": f"Bearer {self.api_key}",
            "content-type": "application/json",
        }

        for attempt in range(_MAX_RATE_LIMIT_RETRIES + 1):
            with _GATE:
                response = requests.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=180,
                )

            if response.status_code != 429 or attempt == _MAX_RATE_LIMIT_RETRIES:
                return response

            # Wait outside the slot so a sleeping worker does not block others.
            match = _RETRY_AFTER.search(response.text)
            wait = float(match.group(1)) if match else 2.0
            time.sleep(min(wait, 5.0) * (attempt + 1))

        return response

    @staticmethod
    def usage_of(body: dict[str, Any]) -> tuple[int, int]:
        usage = body.get("usage") or {}
        return int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))
