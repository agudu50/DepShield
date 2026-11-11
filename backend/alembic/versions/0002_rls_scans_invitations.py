"""Add persistent project scans, organization invitations, and tenant RLS."""

from alembic import op
import sqlalchemy as sa

revision = "0002_rls_scans_invitations"
down_revision = "0001_tenant_investigations"
branch_labels = None
depends_on = None


_RLS_TABLES = (
    "organizations",
    "organization_memberships",
    "organization_invitations",
    "projects",
    "agent_investigations",
    "investigation_events",
    "project_scans",
)


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("created_by_user_id", sa.String(length=255), nullable=True),
    )
    op.execute(
        """
        UPDATE organizations
        SET created_by_user_id = (
            SELECT user_id
            FROM organization_memberships
            WHERE organization_id = organizations.id
            ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at
            LIMIT 1
        )
        WHERE created_by_user_id IS NULL
        """
    )
    op.create_table(
        "organization_invitations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("inviter_user_id", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "role IN ('admin', 'member')",
            name="ck_organization_invitations_role",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_digest"),
    )
    op.create_index(
        "ix_organization_invitations_organization_created",
        "organization_invitations",
        ["organization_id", "created_at"],
    )
    op.create_index(
        "ix_organization_invitations_expires_at",
        "organization_invitations",
        ["expires_at"],
    )
    op.create_table(
        "project_scans",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("actor_user_id", sa.String(length=255), nullable=False),
        sa.Column("ecosystem", sa.String(length=20), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "organization_id"],
            ["projects.id", "projects.organization_id"],
            ondelete="CASCADE",
            name="fk_project_scans_project_organization",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_project_scans_project_created",
        "project_scans",
        ["project_id", "created_at"],
    )

    if op.get_bind().dialect.name != "postgresql":
        return

    policies = (
        """
        CREATE POLICY organizations_select ON organizations
        FOR SELECT USING (
            EXISTS (
                SELECT 1 FROM organization_memberships m
                WHERE m.organization_id = organizations.id
                  AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
            )
            OR created_by_user_id = NULLIF(current_setting('app.user_id', true), '')
        )
        """,
        """
        CREATE POLICY organizations_insert ON organizations
        FOR INSERT WITH CHECK (
            created_by_user_id = NULLIF(current_setting('app.user_id', true), '')
        )
        """,
        """
        CREATE POLICY organizations_update ON organizations
        FOR UPDATE
        USING (
            id = NULLIF(current_setting('app.organization_id', true), '')
            AND NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
        )
        WITH CHECK (
            id = NULLIF(current_setting('app.organization_id', true), '')
            AND NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
        )
        """,
        """
        CREATE POLICY organizations_delete ON organizations
        FOR DELETE USING (
            id = NULLIF(current_setting('app.organization_id', true), '')
            AND NULLIF(current_setting('app.organization_role', true), '') = 'owner'
        )
        """,
        """
        CREATE POLICY organization_memberships_select ON organization_memberships
        FOR SELECT USING (
            user_id = NULLIF(current_setting('app.user_id', true), '')
            OR organization_id = NULLIF(current_setting('app.organization_id', true), '')
        )
        """,
        """
        CREATE POLICY organization_memberships_insert ON organization_memberships
        FOR INSERT WITH CHECK (
            (
                user_id = NULLIF(current_setting('app.user_id', true), '')
                AND role = 'owner'
                AND EXISTS (
                    SELECT 1 FROM organizations o
                    WHERE o.id = organization_memberships.organization_id
                      AND o.created_by_user_id = NULLIF(current_setting('app.user_id', true), '')
                )
            )
            OR (
                user_id = NULLIF(current_setting('app.user_id', true), '')
                AND organization_id = NULLIF(current_setting('app.organization_id', true), '')
                AND EXISTS (
                    SELECT 1 FROM organization_invitations i
                    WHERE i.id = NULLIF(current_setting('app.invitation_id', true), '')
                      AND i.organization_id = organization_memberships.organization_id
                      AND i.role = organization_memberships.role
                      AND lower(i.email) = NULLIF(current_setting('app.user_email', true), '')
                      AND i.accepted_at IS NULL
                      AND i.revoked_at IS NULL
                      AND i.expires_at > now()
                )
            )
        )
        """,
        """
        CREATE POLICY organization_memberships_update ON organization_memberships
        FOR UPDATE
        USING (
            organization_id = NULLIF(current_setting('app.organization_id', true), '')
            AND NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
            AND (
                role != 'owner'
                OR NULLIF(current_setting('app.organization_role', true), '') = 'owner'
            )
        )
        WITH CHECK (
            organization_id = NULLIF(current_setting('app.organization_id', true), '')
            AND NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
            AND (
                role != 'owner'
                OR NULLIF(current_setting('app.organization_role', true), '') = 'owner'
            )
        )
        """,
        """
        CREATE POLICY organization_memberships_delete ON organization_memberships
        FOR DELETE USING (
            organization_id = NULLIF(current_setting('app.organization_id', true), '')
            AND NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
            AND (
                role != 'owner'
                OR NULLIF(current_setting('app.organization_role', true), '') = 'owner'
            )
        )
        """,
        """
        CREATE POLICY organization_invitations_select ON organization_invitations
        FOR SELECT USING (
            organization_id = NULLIF(current_setting('app.organization_id', true), '')
            OR (
                lower(email) = NULLIF(current_setting('app.user_email', true), '')
                AND accepted_at IS NULL
                AND revoked_at IS NULL
                AND expires_at > now()
            )
        )
        """,
        """
        CREATE POLICY organization_invitations_insert ON organization_invitations
        FOR INSERT WITH CHECK (
            organization_id = NULLIF(current_setting('app.organization_id', true), '')
            AND inviter_user_id = NULLIF(current_setting('app.user_id', true), '')
            AND NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
        )
        """,
        """
        CREATE POLICY organization_invitations_update ON organization_invitations
        FOR UPDATE
        USING (
            (
                organization_id = NULLIF(current_setting('app.organization_id', true), '')
                AND NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
            )
            OR (
                id = NULLIF(current_setting('app.invitation_id', true), '')
                AND lower(email) = NULLIF(current_setting('app.user_email', true), '')
                AND accepted_at IS NULL
                AND revoked_at IS NULL
                AND expires_at > now()
            )
        )
        WITH CHECK (
            organization_id = NULLIF(current_setting('app.organization_id', true), '')
            AND (
                NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
                OR (
                    id = NULLIF(current_setting('app.invitation_id', true), '')
                    AND lower(email) = NULLIF(current_setting('app.user_email', true), '')
                )
            )
        )
        """,
        """
        CREATE POLICY organization_invitations_delete ON organization_invitations
        FOR DELETE USING (
            organization_id = NULLIF(current_setting('app.organization_id', true), '')
            AND NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
        )
        """,
        """
        CREATE POLICY projects_select ON projects
        FOR SELECT USING (
            EXISTS (
                SELECT 1 FROM organization_memberships m
                WHERE m.organization_id = projects.organization_id
                  AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
            )
        )
        """,
        """
        CREATE POLICY projects_insert ON projects
        FOR INSERT WITH CHECK (
            organization_id = NULLIF(current_setting('app.organization_id', true), '')
            AND NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
        )
        """,
        """
        CREATE POLICY projects_update ON projects
        FOR UPDATE
        USING (
            organization_id = NULLIF(current_setting('app.organization_id', true), '')
            AND NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
        )
        WITH CHECK (
            organization_id = NULLIF(current_setting('app.organization_id', true), '')
            AND NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
        )
        """,
        """
        CREATE POLICY projects_delete ON projects
        FOR DELETE USING (
            organization_id = NULLIF(current_setting('app.organization_id', true), '')
            AND NULLIF(current_setting('app.organization_role', true), '') IN ('owner', 'admin')
        )
        """,
        """
        CREATE POLICY agent_investigations_select ON agent_investigations
        FOR SELECT USING (
            EXISTS (
                SELECT 1 FROM organization_memberships m
                WHERE m.organization_id = agent_investigations.organization_id
                  AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
            )
        )
        """,
        """
        CREATE POLICY agent_investigations_insert ON agent_investigations
        FOR INSERT WITH CHECK (
            actor_user_id = NULLIF(current_setting('app.user_id', true), '')
            AND EXISTS (
                SELECT 1 FROM organization_memberships m
                WHERE m.organization_id = agent_investigations.organization_id
                  AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
            )
        )
        """,
        """
        CREATE POLICY agent_investigations_update ON agent_investigations
        FOR UPDATE
        USING (
            actor_user_id = NULLIF(current_setting('app.user_id', true), '')
            AND EXISTS (
                SELECT 1 FROM organization_memberships m
                WHERE m.organization_id = agent_investigations.organization_id
                  AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
            )
        )
        WITH CHECK (
            actor_user_id = NULLIF(current_setting('app.user_id', true), '')
            AND EXISTS (
                SELECT 1 FROM organization_memberships m
                WHERE m.organization_id = agent_investigations.organization_id
                  AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
            )
        )
        """,
        """
        CREATE POLICY investigation_events_select ON investigation_events
        FOR SELECT USING (
            EXISTS (
                SELECT 1
                FROM agent_investigations i
                JOIN organization_memberships m ON m.organization_id = i.organization_id
                WHERE i.id = investigation_events.investigation_id
                  AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
            )
        )
        """,
        """
        CREATE POLICY investigation_events_insert ON investigation_events
        FOR INSERT WITH CHECK (
            EXISTS (
                SELECT 1
                FROM agent_investigations i
                JOIN organization_memberships m ON m.organization_id = i.organization_id
                WHERE i.id = investigation_events.investigation_id
                  AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
            )
        )
        """,
        """
        CREATE POLICY project_scans_select ON project_scans
        FOR SELECT USING (
            EXISTS (
                SELECT 1 FROM organization_memberships m
                WHERE m.organization_id = project_scans.organization_id
                  AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
            )
        )
        """,
        """
        CREATE POLICY project_scans_insert ON project_scans
        FOR INSERT WITH CHECK (
            actor_user_id = NULLIF(current_setting('app.user_id', true), '')
            AND EXISTS (
                SELECT 1 FROM organization_memberships m
                WHERE m.organization_id = project_scans.organization_id
                  AND m.user_id = NULLIF(current_setting('app.user_id', true), '')
            )
        )
        """,
    )
    for policy in policies:
        op.execute(policy)
    for table in _RLS_TABLES:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        op.execute(
            f"""
            CREATE POLICY "{table}_maintenance_access" ON "{table}"
            FOR ALL
            USING (current_setting('app.maintenance', true) = 'true')
            WITH CHECK (current_setting('app.maintenance', true) = 'true')
            """
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for table in reversed(_RLS_TABLES):
            op.execute(f'DROP POLICY IF EXISTS "{table}_maintenance_access" ON "{table}"')
            op.execute(f'ALTER TABLE "{table}" NO FORCE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')
            op.execute(f'DROP POLICY IF EXISTS {table}_select ON "{table}"')
            op.execute(f'DROP POLICY IF EXISTS {table}_insert ON "{table}"')
            op.execute(f'DROP POLICY IF EXISTS {table}_update ON "{table}"')
            op.execute(f'DROP POLICY IF EXISTS {table}_delete ON "{table}"')
        op.execute("DROP POLICY IF EXISTS investigation_events_select ON investigation_events")
        op.execute("DROP POLICY IF EXISTS investigation_events_insert ON investigation_events")
        op.execute("DROP POLICY IF EXISTS organization_memberships_select ON organization_memberships")
        op.execute("DROP POLICY IF EXISTS organization_memberships_insert ON organization_memberships")
        op.execute("DROP POLICY IF EXISTS organization_memberships_update ON organization_memberships")
        op.execute("DROP POLICY IF EXISTS organization_memberships_delete ON organization_memberships")
        op.execute("DROP POLICY IF EXISTS organization_invitations_select ON organization_invitations")
        op.execute("DROP POLICY IF EXISTS organization_invitations_insert ON organization_invitations")
        op.execute("DROP POLICY IF EXISTS organization_invitations_update ON organization_invitations")
        op.execute("DROP POLICY IF EXISTS organization_invitations_delete ON organization_invitations")
    op.drop_index("ix_project_scans_project_created", table_name="project_scans")
    op.drop_table("project_scans")
    op.drop_index("ix_organization_invitations_expires_at", table_name="organization_invitations")
    op.drop_index(
        "ix_organization_invitations_organization_created",
        table_name="organization_invitations",
    )
    op.drop_table("organization_invitations")
    op.drop_column("organizations", "created_by_user_id")
