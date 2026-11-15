"""Anonymous public site metrics (visits and aggregate audit counters)."""

from alembic import op
import sqlalchemy as sa

revision = "0004_site_metrics"
down_revision = "0003_project_inventory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # No tenant data lives here (random browser IDs and global totals), so no RLS policies.
    op.create_table(
        "site_visits",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("visitor_id", sa.String(length=36), nullable=False),
        sa.Column("views", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("first_seen", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("day", "visitor_id"),
    )
    op.create_index("ix_site_visits_last_seen", "site_visits", ["last_seen"])
    op.create_index("ix_site_visits_visitor_id", "site_visits", ["visitor_id"])
    op.create_table(
        "site_counters",
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("value", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("name"),
    )


def downgrade() -> None:
    op.drop_table("site_counters")
    op.drop_index("ix_site_visits_visitor_id", table_name="site_visits")
    op.drop_index("ix_site_visits_last_seen", table_name="site_visits")
    op.drop_table("site_visits")
