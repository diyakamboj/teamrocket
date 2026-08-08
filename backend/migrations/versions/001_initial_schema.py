"""Initial schema for resume screening assistant.

Revision ID: 001_initial
Revises:
Create Date: 2026-08-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.create_table(
        "candidates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("phone", sa.String(20)),
        sa.Column("resume_file_id", sa.String(500)),
        sa.Column("resume_text", sa.Text()),
        sa.Column("skills", postgresql.JSONB()),
        sa.Column("experience", postgresql.JSONB()),
        sa.Column("education", postgresql.JSONB()),
        sa.Column("certifications", postgresql.JSONB()),
        sa.Column("projects", postgresql.JSONB()),
        sa.Column("github_url", sa.String(255)),
        sa.Column("linkedin_url", sa.String(255)),
        sa.Column("portfolio_url", sa.String(255)),
        sa.Column("enriched_profile", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.create_table(
        "job_postings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("required_skills", postgresql.JSONB()),
        sa.Column("required_experience_years", sa.Integer()),
        sa.Column("education_requirements", sa.String(255)),
        sa.Column("nice_to_have_skills", postgresql.JSONB()),
        sa.Column("created_by", sa.String(255)),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.create_table(
        "evaluations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("candidate_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("candidates.id"), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("job_postings.id"), nullable=False),
        sa.Column("overall_score", sa.Numeric(5, 2)),
        sa.Column("skill_match_score", sa.Numeric(5, 2)),
        sa.Column("experience_match_score", sa.Numeric(5, 2)),
        sa.Column("education_match_score", sa.Numeric(5, 2)),
        sa.Column("certification_match_score", sa.Numeric(5, 2)),
        sa.Column("project_match_score", sa.Numeric(5, 2)),
        sa.Column("matched_skills", postgresql.JSONB()),
        sa.Column("missing_skills", postgresql.JSONB()),
        sa.Column("strengths", sa.Text()),
        sa.Column("weaknesses", sa.Text()),
        sa.Column("transferable_skills", sa.Text()),
        sa.Column("blind_review_mode", sa.Boolean(), server_default=sa.text("FALSE")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("candidate_id", "job_id", name="uq_evaluation_candidate_job"),
    )

    op.create_table(
        "evidence",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "evaluation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("evaluations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("skill_name", sa.String(255)),
        sa.Column("resume_text_snippet", sa.Text()),
        sa.Column("source_section", sa.String(100)),
        sa.Column("confidence_score", sa.Numeric(3, 2)),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("recruiter_email", sa.String(255)),
        sa.Column("action", sa.String(100)),
        sa.Column("resource_type", sa.String(100)),
        sa.Column("resource_id", postgresql.UUID(as_uuid=True)),
        sa.Column("details", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.create_table(
        "agent_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("recruiter_email", sa.String(255)),
        sa.Column("job_id", postgresql.UUID(as_uuid=True)),
        sa.Column("messages", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.create_table(
        "resume_uploads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("filename", sa.String(500), nullable=False),
        sa.Column("blob_path", sa.String(500)),
        sa.Column("status", sa.String(50), server_default="queued"),
        sa.Column("progress", sa.Integer(), server_default="0"),
        sa.Column("error", sa.Text()),
        sa.Column("candidate_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("candidates.id")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.create_index("idx_candidates_email", "candidates", ["email"])
    op.create_index("idx_job_postings_created_by", "job_postings", ["created_by"])
    op.create_index("idx_evaluations_job_id", "evaluations", ["job_id"])
    op.create_index("idx_evaluations_candidate_id", "evaluations", ["candidate_id"])
    op.create_index("idx_evidence_evaluation_id", "evidence", ["evaluation_id"])
    op.create_index("idx_resume_uploads_status", "resume_uploads", ["status"])
    op.create_index("idx_agent_sessions_recruiter", "agent_sessions", ["recruiter_email"])


def downgrade() -> None:
    op.drop_index("idx_agent_sessions_recruiter", table_name="agent_sessions")
    op.drop_index("idx_resume_uploads_status", table_name="resume_uploads")
    op.drop_index("idx_evidence_evaluation_id", table_name="evidence")
    op.drop_index("idx_evaluations_candidate_id", table_name="evaluations")
    op.drop_index("idx_evaluations_job_id", table_name="evaluations")
    op.drop_index("idx_job_postings_created_by", table_name="job_postings")
    op.drop_index("idx_candidates_email", table_name="candidates")
    op.drop_table("resume_uploads")
    op.drop_table("agent_sessions")
    op.drop_table("audit_logs")
    op.drop_table("evidence")
    op.drop_table("evaluations")
    op.drop_table("job_postings")
    op.drop_table("candidates")
