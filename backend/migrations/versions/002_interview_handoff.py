"""Interview Handoff & Historical Data: candidate history log + briefing handoffs.

Revision ID: 002_interview_handoff
Revises: 001_initial
Create Date: 2026-08-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002_interview_handoff"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "candidate_history_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("candidate_id", sa.String(255), nullable=False),
        sa.Column("candidate_name", sa.String(255)),
        sa.Column("job_id", sa.String(255)),
        sa.Column("job_title", sa.String(255)),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("actor_email", sa.String(255)),
        sa.Column("summary", sa.Text()),
        sa.Column("details", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.create_table(
        "interview_handoffs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("candidate_id", sa.String(255), nullable=False),
        sa.Column("candidate_name", sa.String(255), nullable=False),
        sa.Column("candidate_email", sa.String(255)),
        sa.Column("job_id", sa.String(255)),
        sa.Column("job_title", sa.String(255)),
        sa.Column("interviewer_name", sa.String(255), nullable=False),
        sa.Column("interviewer_email", sa.String(255), nullable=False),
        sa.Column("created_by", sa.String(255)),
        sa.Column("briefing", postgresql.JSONB()),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("interviewer_notes", sa.Text()),
        sa.Column("email_sent", sa.Boolean(), server_default=sa.text("FALSE")),
        sa.Column("email_source", sa.String(20)),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("viewed_at", sa.DateTime()),
        sa.Column("acknowledged_at", sa.DateTime()),
    )

    op.create_index("idx_history_events_candidate", "candidate_history_events", ["candidate_id"])
    op.create_index("idx_history_events_job", "candidate_history_events", ["job_id"])
    op.create_index("idx_history_events_type", "candidate_history_events", ["event_type"])
    op.create_index("idx_history_events_created_at", "candidate_history_events", ["created_at"])

    op.create_index("idx_handoffs_candidate", "interview_handoffs", ["candidate_id"])
    op.create_index("idx_handoffs_job", "interview_handoffs", ["job_id"])
    op.create_index("idx_handoffs_interviewer_email", "interview_handoffs", ["interviewer_email"])
    op.create_index("idx_handoffs_created_by", "interview_handoffs", ["created_by"])
    op.create_index("idx_handoffs_status", "interview_handoffs", ["status"])
    op.create_index("idx_handoffs_created_at", "interview_handoffs", ["created_at"])


def downgrade() -> None:
    op.drop_index("idx_handoffs_created_at", table_name="interview_handoffs")
    op.drop_index("idx_handoffs_status", table_name="interview_handoffs")
    op.drop_index("idx_handoffs_created_by", table_name="interview_handoffs")
    op.drop_index("idx_handoffs_interviewer_email", table_name="interview_handoffs")
    op.drop_index("idx_handoffs_job", table_name="interview_handoffs")
    op.drop_index("idx_handoffs_candidate", table_name="interview_handoffs")

    op.drop_index("idx_history_events_created_at", table_name="candidate_history_events")
    op.drop_index("idx_history_events_type", table_name="candidate_history_events")
    op.drop_index("idx_history_events_job", table_name="candidate_history_events")
    op.drop_index("idx_history_events_candidate", table_name="candidate_history_events")

    op.drop_table("interview_handoffs")
    op.drop_table("candidate_history_events")
