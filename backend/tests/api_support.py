import os
import unittest
from collections.abc import Generator

os.environ["ENVIRONMENT"] = "test"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import AuthenticatedUser, get_current_user
from app.config import Settings, get_settings
from app.database import Base, get_db_session
from app.main import app
from app.models import Membership, Organization, Project


class DatabaseBackedApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.session_factory = sessionmaker(bind=self.engine, expire_on_commit=False)
        Base.metadata.create_all(self.engine)
        app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
        app.dependency_overrides[get_db_session] = self.get_test_session
        self.set_user("test-user")
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        self.engine.dispose()

    def get_test_session(self) -> Generator[Session, None, None]:
        with self.session_factory() as session:
            yield session

    def set_user(self, user_id: str, email: str | None = None) -> None:
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            id=user_id,
            email=email or f"{user_id}@example.test",
        )

    def create_project(
        self,
        user_id: str = "test-user",
        role: str = "owner",
        name: str = "demo",
    ) -> tuple[str, str, str]:
        with self.session_factory() as session:
            organization = Organization(name=f"{name} organization")
            session.add(organization)
            session.flush()
            membership = Membership(
                organization_id=organization.id,
                user_id=user_id,
                role=role,
            )
            project = Project(organization_id=organization.id, name=name)
            session.add_all([membership, project])
            session.commit()
            return organization.id, project.id, project.name
