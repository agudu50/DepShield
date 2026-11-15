"""Public, anonymous site metrics.

Privacy model: a visitor is a random UUID generated in the browser. No IP address,
user agent, cookie or account is stored. Counters for audits are aggregate numbers only.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import BigInteger, Date, DateTime, Integer, String, func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.database import Base, _get_session_factory

logger = logging.getLogger(__name__)

ACTIVE_WINDOW = timedelta(minutes=5)
SUMMARY_TTL_SECONDS = 15.0
COUNTERS = ("manifests_audited", "packages_checked", "advisories_found")


class SiteVisit(Base):
    """One row per anonymous visitor per UTC day."""

    __tablename__ = "site_visits"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    visitor_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class SiteCounter(Base):
    """Aggregate product counters (no per-user data)."""

    __tablename__ = "site_counters"

    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def record_visit(session: Session, visitor_id: str, heartbeat: bool) -> None:
    """Count a page view (or just refresh "last seen" for a heartbeat)."""
    now = _now()
    today = now.date()
    for attempt in range(2):
        row = session.get(SiteVisit, (today, visitor_id))
        if row is None:
            session.add(SiteVisit(day=today, visitor_id=visitor_id, views=0 if heartbeat else 1, first_seen=now, last_seen=now))
        else:
            row.last_seen = now
            if not heartbeat:
                row.views += 1
        try:
            session.commit()
            break
        except IntegrityError:
            session.rollback()  # two first-views raced; retry as an update
            if attempt == 1:
                raise
    _invalidate_summary()


def increment_counters(session: Session, amounts: dict[str, int]) -> None:
    for name, amount in amounts.items():
        if name not in COUNTERS or amount <= 0:
            continue
        row = session.get(SiteCounter, name)
        if row is None:
            session.add(SiteCounter(name=name, value=amount))
        else:
            row.value += amount
    session.commit()
    _invalidate_summary()


_summary_lock = threading.Lock()
_summary_cache: tuple[float, dict[str, Any]] | None = None


def _invalidate_summary() -> None:
    global _summary_cache
    with _summary_lock:
        _summary_cache = None


def summary(session: Session) -> dict[str, Any]:
    global _summary_cache
    with _summary_lock:
        if _summary_cache and time.monotonic() - _summary_cache[0] < SUMMARY_TTL_SECONDS:
            return _summary_cache[1]

    now = _now()
    today = now.date()
    total_views = session.scalar(select(func.coalesce(func.sum(SiteVisit.views), 0))) or 0
    unique_visitors = session.scalar(select(func.count(func.distinct(SiteVisit.visitor_id)))) or 0
    visitors_today = session.scalar(select(func.count()).select_from(SiteVisit).where(SiteVisit.day == today)) or 0
    here_now = (
        session.scalar(
            select(func.count(func.distinct(SiteVisit.visitor_id))).where(SiteVisit.last_seen >= now - ACTIVE_WINDOW)
        )
        or 0
    )
    counters = {name: 0 for name in COUNTERS}
    for row in session.scalars(select(SiteCounter)):
        if row.name in counters:
            counters[row.name] = int(row.value)

    data = {
        "available": True,
        "page_views": int(total_views),
        "unique_visitors": int(unique_visitors),
        "visitors_today": int(visitors_today),
        "here_now": int(here_now),
        **counters,
        "generated_at": now.isoformat(),
    }
    with _summary_lock:
        _summary_cache = (time.monotonic(), data)
    return data


def record_audit_best_effort(database_url: str, *, manifests: int, packages: int, advisories: int) -> None:
    """Bump audit counters without ever failing the audit that triggered it."""
    if not database_url:
        return
    try:
        with _get_session_factory(database_url)() as session:
            increment_counters(
                session,
                {"manifests_audited": manifests, "packages_checked": packages, "advisories_found": advisories},
            )
    except SQLAlchemyError:
        logger.warning("Could not record audit metrics", exc_info=True)
