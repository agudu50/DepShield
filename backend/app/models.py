from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _new_id() -> str:
    return str(uuid4())


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_by_user_id: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    projects: Mapped[list["Project"]] = relationship(
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    invitations: Mapped[list["OrganizationInvitation"]] = relationship(
        back_populates="organization",
        cascade="all, delete-orphan",
    )


class Membership(Base):
    __tablename__ = "organization_memberships"
    __table_args__ = (
        CheckConstraint(
            "role IN ('owner', 'admin', 'member')",
            name="ck_organization_memberships_role",
        ),
        Index("ix_organization_memberships_user_id", "user_id"),
    )

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)

    organization: Mapped[Organization] = relationship(back_populates="memberships")


class OrganizationInvitation(Base):
    __tablename__ = "organization_invitations"
    __table_args__ = (
        CheckConstraint(
            "role IN ('admin', 'member')",
            name="ck_organization_invitations_role",
        ),
        Index("ix_organization_invitations_organization_created", "organization_id", "created_at"),
        Index("ix_organization_invitations_expires_at", "expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    token_digest: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    inviter_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    organization: Mapped[Organization] = relationship(back_populates="invitations")


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_projects_organization_name"),
        UniqueConstraint("id", "organization_id", name="uq_projects_id_organization"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)

    organization: Mapped[Organization] = relationship(back_populates="projects")
    investigations: Mapped[list["AgentInvestigation"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class AgentInvestigation(Base):
    __tablename__ = "agent_investigations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('running', 'completed', 'failed')",
            name="ck_agent_investigations_status",
        ),
        ForeignKeyConstraint(
            ["project_id", "organization_id"],
            ["projects.id", "projects.organization_id"],
            ondelete="CASCADE",
            name="fk_agent_investigations_project_organization",
        ),
        Index("ix_agent_investigations_project_created", "project_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[str] = mapped_column(
        nullable=False,
    )
    actor_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    ecosystem: Mapped[str] = mapped_column(String(20), nullable=False)
    package_name: Mapped[str] = mapped_column(String(214), nullable=False)
    version: Mapped[str] = mapped_column(String(100), nullable=False)
    question: Mapped[str] = mapped_column(String(1000), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    answer: Mapped[str | None] = mapped_column(Text)
    evidence: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False, default=list)
    model: Mapped[str | None] = mapped_column(String(255))
    gateway_response_id: Mapped[str | None] = mapped_column(String(255))
    usage: Mapped[dict[str, int]] = mapped_column(JSON, nullable=False, default=dict)
    error_code: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped[Project] = relationship(back_populates="investigations")
    events: Mapped[list["InvestigationEvent"]] = relationship(
        back_populates="investigation",
        cascade="all, delete-orphan",
        order_by="InvestigationEvent.id",
    )


class InvestigationEvent(Base):
    __tablename__ = "investigation_events"
    __table_args__ = (
        Index("ix_investigation_events_investigation_id", "investigation_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    investigation_id: Mapped[str] = mapped_column(
        ForeignKey("agent_investigations.id", ondelete="CASCADE"),
        nullable=False,
    )
    actor_user_id: Mapped[str | None] = mapped_column(String(255))
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)

    investigation: Mapped[AgentInvestigation] = relationship(back_populates="events")


class ProjectScan(Base):
    __tablename__ = "project_scans"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "organization_id"],
            ["projects.id", "projects.organization_id"],
            ondelete="CASCADE",
            name="fk_project_scans_project_organization",
        ),
        Index("ix_project_scans_project_created", "project_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    ecosystem: Mapped[str] = mapped_column(String(20), nullable=False)
    result: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)


class ProjectInventory(Base):
    __tablename__ = "project_inventories"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "organization_id"],
            ["projects.id", "projects.organization_id"],
            ondelete="CASCADE",
            name="fk_project_inventories_project_organization",
        ),
    )

    project_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    manager: Mapped[str] = mapped_column(String(20), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    packages: Mapped[list[dict[str, str]]] = mapped_column(JSON, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        onupdate=_utc_now,
        nullable=False,
    )
