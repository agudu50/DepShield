from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
@router.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "DepShield AI"}
