"""Level 1 preliminary screening sessions.

Revision ID: 002_screening
Revises: 001_initial
Create Date: 2026-08-15
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002_screening"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "screening_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        # Plain string: screening also runs on client-side/demo candidates.
        sa.Column("candidate_id", sa.String(255), nullable=False),
        sa.Column("candidate_name", sa.String(255), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=True)),
        sa.Column("job_title", sa.String(255)),
        sa.Column("evaluation_id", postgresql.UUID(as_uuid=True)),
        sa.Column("recruiter_email", sa.String(255)),
        sa.Column("status", sa.String(20), server_default="in_progress"),
        sa.Column("plan", postgresql.JSONB()),
        sa.Column("turns", postgresql.JSONB()),
        sa.Column("current_index", sa.Integer(), server_default="0"),
        sa.Column("context", postgresql.JSONB()),
        sa.Column("scorecard", postgresql.JSONB()),
        sa.Column("briefing", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("completed_at", sa.DateTime()),
    )

    op.create_index("idx_screening_sessions_candidate", "screening_sessions", ["candidate_id"])
    op.create_index("idx_screening_sessions_job", "screening_sessions", ["job_id"])
    op.create_index("idx_screening_sessions_status", "screening_sessions", ["status"])
    op.create_index("idx_screening_sessions_recruiter", "screening_sessions", ["recruiter_email"])


def downgrade() -> None:
    op.drop_index("idx_screening_sessions_recruiter", table_name="screening_sessions")
    op.drop_index("idx_screening_sessions_status", table_name="screening_sessions")
    op.drop_index("idx_screening_sessions_job", table_name="screening_sessions")
    op.drop_index("idx_screening_sessions_candidate", table_name="screening_sessions")
    op.drop_table("screening_sessions")
