"""ATS Benchmark Baseline Scoring: keyword baseline vs LLM semantic dual score.

Revision ID: 004_ats_benchmark
Revises: 003_job_listings_dashboard
Create Date: 2026-08-09
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "004_ats_benchmark"
down_revision: Union[str, None] = "003_job_listings_dashboard"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ats_benchmark_scores",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "evaluation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("evaluations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("candidate_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("candidates.id"), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("job_postings.id"), nullable=False),
        sa.Column("keyword_score", sa.Numeric(5, 2)),
        sa.Column("matched_keywords", postgresql.JSONB()),
        sa.Column("missing_keywords", postgresql.JSONB()),
        sa.Column("semantic_score", sa.Numeric(5, 2)),
        sa.Column("semantic_rationale", sa.Text()),
        sa.Column("equivalent_terms", postgresql.JSONB()),
        sa.Column("score_delta", sa.Numeric(5, 2)),
        sa.Column("verdict", sa.String(30)),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("evaluation_id", name="uq_ats_benchmark_evaluation"),
    )

    op.create_index("idx_ats_benchmark_candidate", "ats_benchmark_scores", ["candidate_id"])
    op.create_index("idx_ats_benchmark_job", "ats_benchmark_scores", ["job_id"])


def downgrade() -> None:
    op.drop_index("idx_ats_benchmark_job", table_name="ats_benchmark_scores")
    op.drop_index("idx_ats_benchmark_candidate", table_name="ats_benchmark_scores")
    op.drop_table("ats_benchmark_scores")
