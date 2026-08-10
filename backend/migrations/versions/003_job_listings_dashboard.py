"""Top-level recruiter dashboard: candidate source (internal/external) + job status.

Revision ID: 003_job_listings_dashboard
Revises: 002_interview_handoff
Create Date: 2026-08-09
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003_job_listings_dashboard"
down_revision: Union[str, None] = "002_interview_handoff"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "candidates",
        sa.Column("source", sa.String(20), nullable=False, server_default="external"),
    )
    op.add_column(
        "job_postings",
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
    )
    op.create_index("idx_job_postings_status", "job_postings", ["status"])


def downgrade() -> None:
    op.drop_index("idx_job_postings_status", table_name="job_postings")
    op.drop_column("job_postings", "status")
    op.drop_column("candidates", "source")
