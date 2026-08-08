"""Kimi K3 through the Moonshot API.

The model id is configuration. It is never written into this file, because
pinned model ids stop working.
"""

from __future__ import annotations

from typing import Any

import requests

from .config import optional, required


class KimiError(RuntimeError):
    pass


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
        max_tokens: int = 900,
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

        response = requests.post(
            f"{self.base_url}/chat/completions",
            json=payload,
            headers={
                "authorization": f"Bearer {self.api_key}",
                "content-type": "application/json",
            },
            timeout=180,
        )

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
            response = requests.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers={
                    "authorization": f"Bearer {self.api_key}",
                    "content-type": "application/json",
                },
                timeout=180,
            )

        if response.status_code != 200:
            raise KimiError(f"HTTP {response.status_code}: {response.text[:300]}")

        body = response.json()
        if not body.get("choices"):
            raise KimiError(f"no choices returned: {str(body)[:300]}")
        return body

    @staticmethod
    def usage_of(body: dict[str, Any]) -> tuple[int, int]:
        usage = body.get("usage") or {}
        return int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))
