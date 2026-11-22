"""Ota-onalar boti: talaba bo'yicha noto'g'ri tasdiqlashlar; xabarlar jurnali indeksi (2026-10-23).

Revision ID: m8b9c0d1e2f3
Revises: l7a8b9c0d1e2
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "m8b9c0d1e2f3"
down_revision: Union[str, None] = "l7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_parentbotverifyfail",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("student_id", sa.String(64), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("fails", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.UniqueConstraint("student_id", "day", name="uq_parentbotverifyfail_student_day"),
    )
    # Qayta yuborish har daqiqada shu jadvalni ko'radi.
    op.create_index("ix_core_parentbotnotice_status_created", "core_parentbotnotice", ["status", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_core_parentbotnotice_status_created", table_name="core_parentbotnotice")
    op.drop_table("core_parentbotverifyfail")
