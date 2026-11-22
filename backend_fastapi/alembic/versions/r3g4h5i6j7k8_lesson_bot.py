"""Dars nazorati boti: `core_lessonbotpost`, `core_lessonbotsetting` (2026-11-15).

Revision ID: r3g4h5i6j7k8
Revises: q2f3a4b5c6d7
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "r3g4h5i6j7k8"
down_revision: Union[str, None] = "q2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_lessonbotpost",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("slot", sa.String(8), nullable=False, server_default=""),
        sa.Column("chat_id", sa.BigInteger(), nullable=True),
        sa.Column("message_ids", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("state", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("text_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="sent"),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("day", "kind", "slot", name="uq_lessonbotpost_day_kind_slot"),
    )
    op.create_index("ix_core_lessonbotpost_day", "core_lessonbotpost", ["day"])
    op.create_table(
        "core_lessonbotsetting",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("core_lessonbotsetting")
    op.drop_index("ix_core_lessonbotpost_day", table_name="core_lessonbotpost")
    op.drop_table("core_lessonbotpost")
