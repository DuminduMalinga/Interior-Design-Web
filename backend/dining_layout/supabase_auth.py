"""
Sign-in check shared by the detector and the six layout services.

This exact file sits in each service folder (the folders are built into
separate images, so they cannot import from each other). Change them together.

Every route except /health asks for a signed-in user: the browser sends the
Supabase access token it already has as `Authorization: Bearer <token>`, and
this module asks Supabase whether the token is good. Only the project URL and
the public anon key are needed - no secret key ever reaches these services.

Environment:
  SUPABASE_URL         https://<project-ref>.supabase.co
  SUPABASE_ANON_KEY    the public anon / publishable key
  REQUIRE_AUTH         "false" turns the check off, for local development only
  ENABLE_DOCS          "true" turns /docs and /openapi.json back on (off by default)

If the check is on but SUPABASE_URL / SUPABASE_ANON_KEY are missing, requests
are refused with 503 rather than let through.
"""
import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.request
from typing import Optional

from fastapi import Header, HTTPException

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
REQUIRE_AUTH = os.getenv("REQUIRE_AUTH", "true").strip().lower() not in ("0", "false", "no")
ENABLE_DOCS = os.getenv("ENABLE_DOCS", "false").strip().lower() in ("1", "true", "yes")

#: a token that Supabase accepted is trusted this long before it is asked again
CACHE_SECONDS = 60
CACHE_MAX_ENTRIES = 2000
_accepted: dict[str, float] = {}
_lock = threading.Lock()


def docs_kwargs() -> dict:
    """Arguments for FastAPI(...) that hide the interactive API docs unless ENABLE_DOCS is on."""
    if ENABLE_DOCS:
        return {}
    return {"docs_url": None, "redoc_url": None, "openapi_url": None}


def _supabase_accepts(token: str) -> Optional[bool]:
    """True/False when Supabase answers, None when it cannot be reached."""
    request = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status == 200 and bool(json.load(response).get("id"))
    except urllib.error.HTTPError as exc:
        return False if exc.code in (400, 401, 403) else None
    except Exception:  # noqa: BLE001 - network trouble is not a verdict on the token
        return None


def require_user(authorization: Optional[str] = Header(default=None)) -> None:
    """FastAPI dependency: let the request through only for a signed-in Supabase user."""
    if not REQUIRE_AUTH:
        return
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(503, "The sign-in check is not configured on this server.")

    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(401, "Sign in first.", headers={"WWW-Authenticate": "Bearer"})
    token = token.strip()

    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    with _lock:
        if _accepted.get(key, 0.0) > now:
            return

    verdict = _supabase_accepts(token)
    if verdict is None:
        raise HTTPException(503, "The sign-in check is unavailable. Try again shortly.")
    if not verdict:
        raise HTTPException(401, "Sign in again.", headers={"WWW-Authenticate": "Bearer"})

    with _lock:
        if len(_accepted) >= CACHE_MAX_ENTRIES:
            for stale in [k for k, expires in _accepted.items() if expires <= now]:
                _accepted.pop(stale, None)
            if len(_accepted) >= CACHE_MAX_ENTRIES:
                _accepted.clear()
        _accepted[key] = now + CACHE_SECONDS
