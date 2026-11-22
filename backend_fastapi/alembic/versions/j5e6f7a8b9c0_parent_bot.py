"""Ota-onalar Telegram boti: suhbatlar, farzand bog'lanishlari, yuborilgan xabarlar

Revision ID: j5e6f7a8b9c0
Revises: i4d5e6f7a8b9
Create Date: 2026-10-22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "j5e6f7a8b9c0"
down_revision: Union[str, None] = "i4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_parentbotchat",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("tg_username", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("tg_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("language", sa.String(length=4), nullable=False, server_default=""),
        sa.Column("state", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("state_data", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("daily_summary", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_blocked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("failed_checks", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("failed_day", sa.Date(), nullable=True),
        sa.Column("last_update_id", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_core_parentbotchat_chat_id", "core_parentbotchat", ["chat_id"], unique=True)

    op.create_table(
        "core_parentbotlink",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("student_id", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("chat_id", "student_id", name="uq_parentbotlink_chat_student"),
    )
    op.create_index("ix_core_parentbotlink_chat_id", "core_parentbotlink", ["chat_id"])
    op.create_index("ix_core_parentbotlink_student_id", "core_parentbotlink", ["student_id"])

    op.create_table(
        "core_parentbotnotice",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("ref", sa.String(length=96), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="claimed"),
        sa.Column("tries", sa.SmallInteger(), nullable=False, server_default="1"),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("chat_id", "kind", "ref", name="uq_parentbotnotice_chat_kind_ref"),
    )
    op.create_index("ix_core_parentbotnotice_chat_id", "core_parentbotnotice", ["chat_id"])


def downgrade() -> None:
    op.drop_index("ix_core_parentbotnotice_chat_id", table_name="core_parentbotnotice")
    op.drop_table("core_parentbotnotice")
    op.drop_index("ix_core_parentbotlink_student_id", table_name="core_parentbotlink")
    op.drop_index("ix_core_parentbotlink_chat_id", table_name="core_parentbotlink")
    op.drop_table("core_parentbotlink")
    op.drop_index("ix_core_parentbotchat_chat_id", table_name="core_parentbotchat")
    op.drop_table("core_parentbotchat")
