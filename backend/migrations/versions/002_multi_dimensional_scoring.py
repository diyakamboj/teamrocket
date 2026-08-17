"""Add multi-dimensional candidate scoring columns.

Revision ID: 002_multi_dimensional_scoring
Revises: 001_initial
Create Date: 2026-08-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002_multi_dimensional_scoring"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("evaluations", sa.Column("technical_skills_score", sa.Numeric(5, 2), nullable=True))
    op.add_column("evaluations", sa.Column("communication_score", sa.Numeric(5, 2), nullable=True))
    op.add_column("evaluations", sa.Column("role_alignment_score", sa.Numeric(5, 2), nullable=True))
    op.add_column("evidence", sa.Column("dimension", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("evidence", "dimension")
    op.drop_column("evaluations", "role_alignment_score")
    op.drop_column("evaluations", "communication_score")
    op.drop_column("evaluations", "technical_skills_score")