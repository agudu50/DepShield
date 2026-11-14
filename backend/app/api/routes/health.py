import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.agents.bifrost import BifrostError, ModelNotAllowedError, cost_tier, make_bifrost_client, provider_of
from app.config import get_settings

router = APIRouter(tags=["health"])
settings = get_settings()


@router.get("/health")
@router.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "DepShield AI"}


@router.get("/api/v1/ai/models")
def list_ai_models() -> dict[str, Any]:
    """Models users may pick between; Bifrost routes each by its provider prefix."""
    models = list(dict.fromkeys([settings.bifrost_model, *settings.bifrost_models]))
    return {
        "default": settings.bifrost_model,
        "fallbacks": settings.bifrost_fallback_models,
        "models": [
            {"id": m, "provider": provider_of(m), "name": m.split("/", 1)[-1], "tier": cost_tier(m)} for m in models
        ],
    }


@router.get("/api/health/bifrost")
async def bifrost_health(model: str | None = Query(default=None, max_length=120)) -> dict[str, Any]:
    """Round-trip a minimal real completion through the configured Bifrost gateway.

    Returns the gateway's own response id, model and token usage so callers can
    tell a live upstream answer apart from canned or mocked output.
    """
    if not settings.bifrost_base_url:
        return {"status": "not_configured"}

    try:
        client = make_bifrost_client(settings, model)
    except ModelNotAllowedError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    settings_model = client.model
    started = time.perf_counter()
    try:
        reply = await client.ping()
    except BifrostError as exc:
        return {
            "status": "unreachable",
            "configured_model": settings_model,
            "error": str(exc),
            "cause": type(exc.__cause__).__name__ if exc.__cause__ else None,
        }
    return {
        "status": "live",
        "configured_model": settings_model,
        "model": reply.model,
        "gateway_response_id": reply.response_id,
        "usage": reply.usage,
        "latency_ms": round((time.perf_counter() - started) * 1000),
        "reply": reply.answer[:40],
    }
