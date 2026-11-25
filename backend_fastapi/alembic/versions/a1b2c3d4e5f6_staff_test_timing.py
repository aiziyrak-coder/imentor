"""O'qituvchi jonli test vaqtlarini o'zi sozlaydi: savolni o'qish va javob belgilash (2026-11-25).

Revision ID: a1b2c3d4e5f6
Revises: x9m0n1o2p3q4
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "x9m0n1o2p3q4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("core_staffprofile", sa.Column("test_read_seconds", sa.Integer(), nullable=True))
    op.add_column("core_staffprofile", sa.Column("test_answer_seconds", sa.Integer(), nullable=True))
    op.add_column("core_livetestsession", sa.Column("monitor_read_seconds", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("core_livetestsession", "monitor_read_seconds")
    op.drop_column("core_staffprofile", "test_answer_seconds")
    op.drop_column("core_staffprofile", "test_read_seconds")
