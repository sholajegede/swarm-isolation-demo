"""The only way a worker reaches data.

Workers do not talk to the database. They call these HTTP endpoints carrying
their own org-scoped token, and the backend decides what happens. A refusal
comes back as a normal result here, not an exception, because a refusal is
information the worker is meant to see and report.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import tools_base_url
from .identity import WorkerIdentity, fetch_token

_LOCAL = threading.local()


def _session() -> requests.Session:
    """One pooled session per thread.

    Workers run in parallel, and sharing a connection pool across threads was
    producing intermittent TLS errors. Retries cover connection-level faults
    and the gateway statuses that mean "not processed"; 4xx is never retried,
    because a refusal is an answer, not a failure.
    """
    session = getattr(_LOCAL, "session", None)
    if session is None:
        session = requests.Session()
        retry = Retry(
            total=3,
            connect=3,
            read=2,
            backoff_factor=0.5,
            status_forcelist=(502, 503, 504),
            allowed_methods=frozenset({"POST"}),
        )
        session.mount("https://", HTTPAdapter(max_retries=retry))
        session.mount("http://", HTTPAdapter(max_retries=retry))
        _LOCAL.session = session
    return session


@dataclass
class ToolResult:
    status: int
    body: dict[str, Any]

    @property
    def allowed(self) -> bool:
        return self.status == 200 and bool(self.body.get("ok"))

    @property
    def reason(self) -> str:
        return str(self.body.get("reason", "")) or ("ok" if self.allowed else "unknown")

    @property
    def crossed_boundary(self) -> bool:
        return bool(self.body.get("crossOrg"))


class Backend:
    """A worker's connection to the tool endpoints, tagged with its run."""

    def __init__(self, correlation_id: str, worker_label: str) -> None:
        self.base_url = tools_base_url()
        self.correlation_id = correlation_id
        self.worker_label = worker_label

    def call(
        self,
        path: str,
        identity: WorkerIdentity,
        body: dict[str, Any] | None = None,
    ) -> ToolResult:
        # The token is fetched before every call. Cached until it nears expiry,
        # so this is cheap, but it is never assumed to still be valid.
        token = fetch_token(identity)

        response = _session().post(
            f"{self.base_url}{path}",
            json=body or {},
            headers={
                "authorization": f"Bearer {token}",
                "content-type": "application/json",
                # Tracing labels. The backend never lets these affect a decision.
                "x-correlation-id": self.correlation_id,
                "x-worker-label": self.worker_label,
            },
            timeout=30,
        )

        try:
            payload = response.json()
        except ValueError:
            payload = {}

        return ToolResult(status=response.status_code, body=payload)

    # ------------------------------------------------------------ run log

    def start_run(self, identity: WorkerIdentity, goal: str) -> ToolResult:
        return self.call(
            "/runs/start",
            identity,
            {"correlationId": self.correlation_id, "goal": goal},
        )

    def event(
        self,
        identity: WorkerIdentity,
        kind: str,
        message: str,
        worker_label: str | None = None,
    ) -> ToolResult:
        """Append to the run timeline.

        Losing a timeline line is a cosmetic loss, so a network fault here must
        not take a worker down with it. The audit trail is written server-side
        by the seam and is unaffected either way - that is the record that
        matters, and it is not this one.
        """
        try:
            return self.call(
                "/runs/event",
                identity,
                {
                    "correlationId": self.correlation_id,
                    "workerLabel": worker_label or self.worker_label,
                    "kind": kind,
                    "message": message,
                },
            )
        except requests.RequestException as error:
            return ToolResult(
                status=0, body={"ok": False, "reason": f"event_not_logged: {error}"}
            )

    def finish_run(self, identity: WorkerIdentity, status: str) -> ToolResult:
        return self.call(
            "/runs/finish",
            identity,
            {"correlationId": self.correlation_id, "status": status},
        )
