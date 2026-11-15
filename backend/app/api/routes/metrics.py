from __future__ import annotations

import re
import threading
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db_session
from app.site_metrics import record_visit, summary

router = APIRouter(prefix="/api/v1/metrics", tags=["metrics"])

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
# Per-visitor throttle so one tab can't inflate counts by hammering the endpoint.
_MIN_SECONDS_BETWEEN = {"view": 5.0, "heartbeat": 30.0}
_last_seen: dict[tuple[str, str], float] = {}
_lock = threading.Lock()


class VisitRequest(BaseModel):
    visitor_id: str = Field(min_length=36, max_length=36)
    heartbeat: bool = False

    @field_validator("visitor_id")
    @classmethod
    def must_be_uuid4(cls, value: str) -> str:
        value = value.lower()
        if not _UUID.fullmatch(value):
            raise ValueError("visitor_id must be a random UUID v4")
        return value


def _throttled(visitor_id: str, kind: str) -> bool:
    now = time.monotonic()
    key = (visitor_id, kind)
    with _lock:
        if len(_last_seen) > 50_000:  # bound memory
            _last_seen.clear()
        if now - _last_seen.get(key, 0.0) < _MIN_SECONDS_BETWEEN[kind]:
            return True
        _last_seen[key] = now
        return False


@router.post("/visit", status_code=204)
def post_visit(request: VisitRequest, session: Session = Depends(get_db_session)) -> Response:
    """Anonymous page view / presence beacon. Stores only a random browser ID and a timestamp."""
    if not _throttled(request.visitor_id, "heartbeat" if request.heartbeat else "view"):
        try:
            record_visit(session, request.visitor_id, request.heartbeat)
        except SQLAlchemyError as exc:
            session.rollback()
            raise HTTPException(status_code=503, detail="Metrics are temporarily unavailable") from exc
    return Response(status_code=204)


@router.get("/summary")
def get_summary(response: Response, session: Session = Depends(get_db_session)) -> dict[str, Any]:
    """Public aggregate numbers shown on the site."""
    response.headers["Cache-Control"] = "public, max-age=15"
    try:
        return summary(session)
    except SQLAlchemyError:
        session.rollback()
        # e.g. the migration hasn't been applied yet: the UI hides the panel.
        return {"available": False}
