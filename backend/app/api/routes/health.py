import time
from typing import Any

from fastapi import APIRouter

from app.agents.bifrost import BifrostClient, BifrostError
from app.config import get_settings

router = APIRouter(tags=["health"])
settings = get_settings()


@router.get("/health")
@router.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "DepShield AI"}


@router.get("/api/health/bifrost")
async def bifrost_health() -> dict[str, Any]:
    """Round-trip a minimal real completion through the configured Bifrost gateway.

    Returns the gateway's own response id, model and token usage so callers can
    tell a live upstream answer apart from canned or mocked output.
    """
    if not settings.bifrost_base_url:
        return {"status": "not_configured"}

    client = BifrostClient(
        base_url=settings.bifrost_base_url,
        model=settings.bifrost_model,
        virtual_key=settings.bifrost_virtual_key.get_secret_value(),
    )
    started = time.perf_counter()
    try:
        reply = await client.ping()
    except BifrostError as exc:
        return {
            "status": "unreachable",
            "configured_model": settings.bifrost_model,
            "error": str(exc),
            "cause": type(exc.__cause__).__name__ if exc.__cause__ else None,
        }
    return {
        "status": "live",
        "configured_model": settings.bifrost_model,
        "model": reply.model,
        "gateway_response_id": reply.response_id,
        "usage": reply.usage,
        "latency_ms": round((time.perf_counter() - started) * 1000),
        "reply": reply.answer[:40],
    }
