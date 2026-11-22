"""Jonli test monitor rejimi: sessiya holati va talaba "Tayyorman" (2026-11-12).

Revision ID: q2f3a4b5c6d7
Revises: p1e2f3a4b5c6
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "q2f3a4b5c6d7"
down_revision: Union[str, None] = "p1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("core_livetestsession", sa.Column("mode", sa.String(16), nullable=False, server_default=""))
    op.add_column("core_livetestsession", sa.Column("monitor_phase", sa.String(16), nullable=False, server_default=""))
    op.add_column("core_livetestsession", sa.Column("monitor_index", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("core_livetestsession", sa.Column("monitor_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("core_livetestsession",
                  sa.Column("seconds_per_question", sa.Integer(), nullable=False, server_default="60"))
    op.add_column("core_livetestdraft", sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("core_livetestdraft", "ready_at")
    for col in ("seconds_per_question", "monitor_started_at", "monitor_index", "monitor_phase", "mode"):
        op.drop_column("core_livetestsession", col)
