"""Configuration, read from .env.local.

Nothing here decides policy. The isolation mode in particular is never read by
the swarm - the backend decides it and reports it back. A worker that could
read the mode would be one step away from choosing it.
"""

from __future__ import annotations

import os
from pathlib import Path

_LOADED = False


def load_env(path: str = ".env.local") -> None:
    """Read a .env file into os.environ without overwriting real env vars."""
    global _LOADED
    if _LOADED:
        return
    _LOADED = True

    env_path = Path(path)
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        # Strip trailing inline comments only where they follow whitespace.
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def required(name: str) -> str:
    load_env()
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set in .env.local")
    return value


def optional(name: str, default: str = "") -> str:
    load_env()
    return os.environ.get(name, default).strip() or default


def tools_base_url() -> str:
    return optional(
        "NEXT_PUBLIC_CONVEX_SITE_URL", "http://127.0.0.1:3211"
    ).rstrip("/")


def org_code(tenant: str) -> str:
    return required(f"KINDE_ORG_TENANT_{tenant.upper()}")


def tenant_directory() -> dict[str, str]:
    """Every tenant on the platform, as the orchestrator knows them.

    Platform software legitimately knows which tenants exist. Knowing a tenant
    code is not permission to read its data - that is the whole point of what
    the backend enforces.
    """
    directory: dict[str, str] = {}
    for tenant in ("A", "B", "C"):
        try:
            directory[f"Tenant {tenant}"] = org_code(tenant)
        except RuntimeError:
            continue
    return directory
