"""Persist normalized project dependency inventories."""

from alembic import op
import sqlalchemy as sa

revision = "0003_project_inventory"
down_revision = "0002_rls_scans_invitations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_inventories",
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("manager", sa.String(length=20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("digest", sa.String(length=64), nullable=False),
        sa.Column("packages", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "organization_id"],
            ["projects.id", "projects.organization_id"],
            ondelete="CASCADE",
            name="fk_project_inventories_project_organization",
        ),
        sa.PrimaryKeyConstraint("project_id"),
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            """
            CREATE POLICY project_inventories_select ON project_inventories
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM organization_memberships m
                    WHERE m.organization_id = project_inventories.organization_id
                      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
                )
            )
            """
        )
        op.execute(
            """
            CREATE POLICY project_inventories_insert ON project_inventories
            FOR INSERT WITH CHECK (
                EXISTS (
                    SELECT 1 FROM organization_memberships m
                    WHERE m.organization_id = project_inventories.organization_id
                      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
                )
            )
            """
        )
        op.execute(
            """
            CREATE POLICY project_inventories_update ON project_inventories
            FOR UPDATE
            USING (
                EXISTS (
                    SELECT 1 FROM organization_memberships m
                    WHERE m.organization_id = project_inventories.organization_id
                      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM organization_memberships m
                    WHERE m.organization_id = project_inventories.organization_id
                      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
                )
            )
            """
        )
        op.execute("ALTER TABLE project_inventories ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE project_inventories FORCE ROW LEVEL SECURITY")
        op.execute(
            """
            CREATE POLICY project_inventories_maintenance_access ON project_inventories
            FOR ALL
            USING (current_setting('app.maintenance', true) = 'true')
            WITH CHECK (current_setting('app.maintenance', true) = 'true')
            """
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS project_inventories_maintenance_access ON project_inventories")
        op.execute("DROP POLICY IF EXISTS project_inventories_select ON project_inventories")
        op.execute("DROP POLICY IF EXISTS project_inventories_insert ON project_inventories")
        op.execute("DROP POLICY IF EXISTS project_inventories_update ON project_inventories")
        op.execute("ALTER TABLE project_inventories NO FORCE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE project_inventories DISABLE ROW LEVEL SECURITY")
    op.drop_table("project_inventories")
