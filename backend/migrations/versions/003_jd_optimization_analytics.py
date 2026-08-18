"""Add pipeline stage, candidate source, and JD recommendation persistence.

Revision ID: 003_jd_optimization_analytics
Revises: 002_multi_dimensional_scoring
Create Date: 2026-08-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "003_jd_optimization_analytics"
down_revision: Union[str, None] = "002_multi_dimensional_scoring"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "evaluations",
        sa.Column("pipeline_stage", sa.String(length=32), nullable=True, server_default="screened"),
    )
    op.add_column(
        "candidates",
        sa.Column("source", sa.String(length=32), nullable=True, server_default="resume_upload"),
    )
    op.create_table(
        "jd_recommendations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("job_postings.id"), nullable=False),
        sa.Column("skill", sa.String(255), nullable=False),
        sa.Column("skill_key", sa.String(255), nullable=False),
        sa.Column("classification", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("suggested_modification", sa.Text()),
        sa.Column("recruiter_note", sa.Text()),
        sa.Column("supporting_data", postgresql.JSONB()),
        sa.Column("decided_at", sa.DateTime()),
        sa.Column("decided_by", sa.String(255)),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_jd_recommendations_job_id", "jd_recommendations", ["job_id"])
    op.create_unique_constraint(
        "uq_jd_recommendation_job_skill",
        "jd_recommendations",
        ["job_id", "skill_key"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_jd_recommendation_job_skill", "jd_recommendations", type_="unique")
    op.drop_index("ix_jd_recommendations_job_id", table_name="jd_recommendations")
    op.drop_table("jd_recommendations")
    op.drop_column("candidates", "source")
    op.drop_column("evaluations", "pipeline_stage")
