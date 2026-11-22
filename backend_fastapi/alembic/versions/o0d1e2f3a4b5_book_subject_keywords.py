"""Kitobni fanga bog'lash: `core_subjectbook.subject_keywords` (2026-11-03).

Bo'sh ro'yxat — kitob kafedraning hamma fanlari uchun (oldingi xatti-harakat).

Revision ID: o0d1e2f3a4b5
Revises: n9c0d1e2f3a4
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "o0d1e2f3a4b5"
down_revision: Union[str, None] = "n9c0d1e2f3a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "core_subjectbook",
        sa.Column("subject_keywords", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("core_subjectbook", "subject_keywords")
