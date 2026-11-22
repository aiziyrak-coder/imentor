"""Hisob xavfsizligi: tokenlarni bekor qilish va "faqat parol bilan kirish" (`core_usersecurity`, 2026-11-17).

Revision ID: tk1a2b3c4d5e
Revises: u6j7k8l9m0n1
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "tk1a2b3c4d5e"
down_revision: Union[str, None] = "u6j7k8l9m0n1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_usersecurity",
        sa.Column("user_id", sa.Integer(), primary_key=True),
        sa.Column("tokens_valid_after", sa.DateTime(timezone=True), nullable=True),
        sa.Column("password_only", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("core_usersecurity")
