import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.database import Base, _get_session_factory, get_engine
from app.maintenance import run_maintenance
from app.models import (
    AgentInvestigation,
    InvestigationEvent,
    Membership,
    Organization,
    Project,
    ProjectScan,
)


class MaintenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "maintenance.db"
        self.database_url = f"sqlite+pysqlite:///{self.database_path}"
        self.engine = create_engine(self.database_url)
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, expire_on_commit=False)
        _get_session_factory.cache_clear()
        get_engine.cache_clear()

    def tearDown(self) -> None:
        self.engine.dispose()
        get_engine(self.database_url).dispose()
        _get_session_factory.cache_clear()
        get_engine.cache_clear()
        self.temp_dir.cleanup()

    def test_recovers_stale_runs_and_removes_data_older_than_retention(self) -> None:
        now = datetime.now(timezone.utc)
        organization = Organization(name="Test")
        with self.session_factory() as session:
            session.add(organization)
            session.flush()
            session.add(Membership(organization_id=organization.id, user_id="user", role="owner"))
            project = Project(organization_id=organization.id, name="project")
            session.add(project)
            session.flush()

            stale = AgentInvestigation(
                organization_id=organization.id,
                project_id=project.id,
                actor_user_id="user",
                ecosystem="npm",
                package_name="lodash",
                version="1.0.0",
                question="Check",
                status="running",
                created_at=now - timedelta(hours=1),
            )
            expired = AgentInvestigation(
                organization_id=organization.id,
                project_id=project.id,
                actor_user_id="user",
                ecosystem="npm",
                package_name="old-package",
                version="1.0.0",
                question="Check",
                status="completed",
                created_at=now - timedelta(days=91),
            )
            old_scan = ProjectScan(
                organization_id=organization.id,
                project_id=project.id,
                actor_user_id="user",
                ecosystem="npm",
                result={},
                created_at=now - timedelta(days=91),
            )
            session.add_all([stale, expired, old_scan])
            session.commit()
            stale_id = stale.id
            expired_id = expired.id

        with patch(
            "app.maintenance.get_settings",
            return_value=Settings(
                database_url=self.database_url,
                database_url_unpooled="",
                _env_file=None,
            ),
        ):
            result = run_maintenance(now)

        self.assertEqual(result.recovered_investigations, 1)
        self.assertEqual(result.deleted_investigations, 1)
        self.assertEqual(result.deleted_scans, 1)
        with self.session_factory() as session:
            recovered = session.get(AgentInvestigation, stale_id)
            self.assertEqual(recovered.status, "failed")
            self.assertEqual(recovered.error_code, "stale_run_recovered")
            self.assertEqual(
                session.scalar(
                    select(InvestigationEvent.event_type).where(
                        InvestigationEvent.investigation_id == stale_id
                    )
                ),
                "investigation.recovered_as_failed",
            )
            self.assertIsNone(session.get(AgentInvestigation, expired_id))


if __name__ == "__main__":
    unittest.main()
