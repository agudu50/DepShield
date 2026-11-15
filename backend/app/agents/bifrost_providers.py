"""Which providers are actually set up in the Bifrost gateway.

Uses Bifrost's management API (`GET /api/providers/{provider}`): a configured provider
returns 200 with its (redacted) keys; an unknown one returns an error status. Results are
cached briefly so opening the model picker doesn't hammer the gateway.
"""
from __future__ import annotations

import asyncio
import time
from typing import Literal
from urllib.parse import quote, urlsplit

import httpx

CACHE_TTL_SECONDS = 30.0
# Providers that legitimately run without an API key (configured by URL instead).
KEYLESS_PROVIDERS = {"ollama", "sgl", "vllm"}

Availability = Literal["checked", "partial", "unreachable"]

_cache: dict[str, tuple[float, Availability, dict[str, bool | None]]] = {}


def gateway_root(base_url: str) -> str:
    """`http://host:8080/openai` → `http://host:8080` (management API lives at the root)."""
    parts = urlsplit(base_url)
    return f"{parts.scheme}://{parts.netloc}"


async def provider_availability(
    base_url: str,
    providers: list[str],
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[Availability, dict[str, bool | None]]:
    """Return an overall status and, per provider, True (set up), False (not set up) or None (unknown)."""
    unique = sorted(set(providers))
    key = f"{gateway_root(base_url)}|{','.join(unique)}"
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_TTL_SECONDS:
        return hit[1], hit[2]

    root = gateway_root(base_url)
    unreachable = False

    async def check(client: httpx.AsyncClient, provider: str) -> bool | None:
        nonlocal unreachable
        try:
            res = await client.get(f"{root}/api/providers/{quote(provider)}")
        except httpx.HTTPError:
            unreachable = True
            return None
        if res.status_code in (400, 404):
            return False  # not configured, or not a provider this gateway supports
        if res.status_code != 200:
            return None  # e.g. management API behind auth: can't tell
        try:
            data = res.json()
        except ValueError:
            return None
        keys = data.get("keys") if isinstance(data, dict) else None
        if isinstance(keys, list) and not keys and provider not in KEYLESS_PROVIDERS:
            return False  # provider entry exists but has no API key
        return True

    async with httpx.AsyncClient(timeout=3.0, transport=transport) as client:
        results = await asyncio.gather(*(check(client, p) for p in unique))

    by_provider = dict(zip(unique, results))
    if unreachable and all(v is None for v in results):
        status: Availability = "unreachable"
    elif any(v is None for v in results):
        status = "partial"
    else:
        status = "checked"
    # Don't cache a total failure for long: the user is probably starting the gateway right now.
    if status != "unreachable":
        _cache[key] = (time.monotonic(), status, by_provider)
    return status, by_provider


def clear_cache() -> None:
    _cache.clear()
