"""Worker identity: one org-scoped Kinde M2M app per role per tenant.

Every worker fetches its own token before it touches a tool endpoint. There is
no shared credential anywhere in this file, and no way for a worker to obtain
another tenant's token: the client id and secret it uses are chosen by the role
it was created with.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import requests

from .config import required

_TOKENS: dict[tuple[str, str], tuple[str, float]] = {}
_LOCK = threading.Lock()

# Refresh a little before expiry so a long run cannot be cut off mid-call.
_EARLY_REFRESH_SECONDS = 60


@dataclass(frozen=True)
class WorkerIdentity:
    """Which M2M application a worker authenticates as."""

    tenant: str  # "A", "B", "C"
    role: str  # "READER" or "WRITER"

    @property
    def client_id_var(self) -> str:
        return f"KINDE_M2M_TENANT_{self.tenant}_{self.role}_CLIENT_ID"

    @property
    def client_secret_var(self) -> str:
        return f"KINDE_M2M_TENANT_{self.tenant}_{self.role}_CLIENT_SECRET"


def fetch_token(identity: WorkerIdentity) -> str:
    """Exchange this worker's credentials for an org-scoped access token."""
    key = (identity.tenant, identity.role)

    with _LOCK:
        cached = _TOKENS.get(key)
        if cached and cached[1] - _EARLY_REFRESH_SECONDS > time.time():
            return cached[0]

    response = requests.post(
        required("KINDE_M2M_TOKEN_URL"),
        data={
            "grant_type": "client_credentials",
            "client_id": required(identity.client_id_var),
            "client_secret": required(identity.client_secret_var),
            "audience": required("KINDE_AUDIENCE"),
        },
        headers={"content-type": "application/x-www-form-urlencoded"},
        timeout=30,
    )

    if response.status_code != 200:
        # A suspended organization fails here, before any tool call is made.
        raise TokenRefused(
            f"tenant {identity.tenant} {identity.role}: HTTP {response.status_code}",
            status=response.status_code,
        )

    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise TokenRefused(f"tenant {identity.tenant} {identity.role}: no access_token")

    expires_at = time.time() + float(payload.get("expires_in", 300))
    with _LOCK:
        _TOKENS[key] = (token, expires_at)
    return token


def forget_tokens() -> None:
    """Drop every cached token, forcing the next call to re-authenticate."""
    with _LOCK:
        _TOKENS.clear()


class TokenRefused(RuntimeError):
    def __init__(self, message: str, status: int = 0) -> None:
        super().__init__(message)
        self.status = status
