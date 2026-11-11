import argparse
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import _get_session_factory, set_rls_maintenance
from app.models import AgentInvestigation, InvestigationEvent, OrganizationInvitation, ProjectScan

logger = logging.getLogger(__name__)

RETENTION_DAYS = 90
STALE_INVESTIGATION_MINUTES = 30


@dataclass(frozen=True)
class MaintenanceResult:
    recovered_investigations: int
    deleted_investigations: int
    deleted_scans: int
    deleted_invitations: int


def run_maintenance(now: datetime | None = None) -> MaintenanceResult:
    settings = get_settings()
    database_url = (
        settings.database_url_unpooled.get_secret_value()
        or settings.database_url.get_secret_value()
    )
    if not database_url:
        raise RuntimeError("Set DATABASE_URL_UNPOOLED or DATABASE_URL before running maintenance")

    current_time = now or datetime.now(timezone.utc)
    retention_cutoff = current_time - timedelta(days=RETENTION_DAYS)
    stale_cutoff = current_time - timedelta(minutes=STALE_INVESTIGATION_MINUTES)
    session_factory = _get_session_factory(database_url)

    with session_factory() as session:
        set_rls_maintenance(session)
        with session.begin():
            stale_runs = session.scalars(
                select(AgentInvestigation)
                .where(
                    AgentInvestigation.status == "running",
                    AgentInvestigation.created_at < stale_cutoff,
                )
                .with_for_update(skip_locked=True)
            ).all()
            for investigation in stale_runs:
                investigation.status = "failed"
                investigation.error_code = "stale_run_recovered"
                investigation.completed_at = current_time
                session.add(
                    InvestigationEvent(
                        investigation_id=investigation.id,
                        actor_user_id=None,
                        event_type="investigation.recovered_as_failed",
                        payload={"code": "stale_run_recovered"},
                        created_at=current_time,
                    )
                )

            deleted_investigations = session.execute(
                delete(AgentInvestigation).where(
                    AgentInvestigation.created_at < retention_cutoff,
                ).execution_options(synchronize_session=False)
            ).rowcount or 0
            deleted_scans = session.execute(
                delete(ProjectScan).where(ProjectScan.created_at < retention_cutoff)
                .execution_options(synchronize_session=False)
            ).rowcount or 0
            deleted_invitations = session.execute(
                delete(OrganizationInvitation).where(
                    OrganizationInvitation.expires_at < retention_cutoff,
                ).execution_options(synchronize_session=False)
            ).rowcount or 0

        result = MaintenanceResult(
            recovered_investigations=len(stale_runs),
            deleted_investigations=deleted_investigations,
            deleted_scans=deleted_scans,
            deleted_invitations=deleted_invitations,
        )
        logger.info(
            "DepShield maintenance complete: %s stale investigations recovered; "
            "%s investigations, %s scans, and %s old invitations deleted",
            result.recovered_investigations,
            result.deleted_investigations,
            result.deleted_scans,
            result.deleted_invitations,
        )
        return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Recover stale investigations and enforce data retention.")
    parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    run_maintenance()


if __name__ == "__main__":
    main()
