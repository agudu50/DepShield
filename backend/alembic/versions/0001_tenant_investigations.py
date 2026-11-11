"""Create tenant, project, and investigation history tables."""

from alembic import op
import sqlalchemy as sa

revision = "0001_tenant_investigations"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "organization_memberships",
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "role IN ('owner', 'admin', 'member')",
            name="ck_organization_memberships_role",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("organization_id", "user_id"),
    )
    op.create_index(
        "ix_organization_memberships_user_id",
        "organization_memberships",
        ["user_id"],
    )
    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "name",
            name="uq_projects_organization_name",
        ),
        sa.UniqueConstraint(
            "id",
            "organization_id",
            name="uq_projects_id_organization",
        ),
    )
    op.create_table(
        "agent_investigations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("actor_user_id", sa.String(length=255), nullable=False),
        sa.Column("ecosystem", sa.String(length=20), nullable=False),
        sa.Column("package_name", sa.String(length=214), nullable=False),
        sa.Column("version", sa.String(length=100), nullable=False),
        sa.Column("question", sa.String(length=1000), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("model", sa.String(length=255), nullable=True),
        sa.Column("gateway_response_id", sa.String(length=255), nullable=True),
        sa.Column("usage", sa.JSON(), nullable=False),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('running', 'completed', 'failed')",
            name="ck_agent_investigations_status",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "organization_id"],
            ["projects.id", "projects.organization_id"],
            ondelete="CASCADE",
            name="fk_agent_investigations_project_organization",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_agent_investigations_project_created",
        "agent_investigations",
        ["project_id", "created_at"],
    )
    op.create_table(
        "investigation_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("investigation_id", sa.String(length=36), nullable=False),
        sa.Column("actor_user_id", sa.String(length=255), nullable=True),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["investigation_id"],
            ["agent_investigations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_investigation_events_investigation_id",
        "investigation_events",
        ["investigation_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_investigation_events_investigation_id", table_name="investigation_events")
    op.drop_table("investigation_events")
    op.drop_index("ix_agent_investigations_project_created", table_name="agent_investigations")
    op.drop_table("agent_investigations")
    op.drop_table("projects")
    op.drop_index("ix_organization_memberships_user_id", table_name="organization_memberships")
    op.drop_table("organization_memberships")
    op.drop_table("organizations")
