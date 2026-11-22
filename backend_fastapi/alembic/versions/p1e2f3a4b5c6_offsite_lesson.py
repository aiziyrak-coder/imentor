"""Darsni sababli boshqa joyda o'tish qaydi: `core_offsitelesson` (2026-11-12).

Revision ID: p1e2f3a4b5c6
Revises: o0d1e2f3a4b5
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p1e2f3a4b5c6"
down_revision: Union[str, None] = "o0d1e2f3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_offsitelesson",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_key", sa.String(128), nullable=False),
        sa.Column("lesson_id", sa.Integer(), nullable=False),
        sa.Column("lesson_date", sa.Date(), nullable=False),
        sa.Column("para", sa.String(16), nullable=False, server_default=""),
        sa.Column("start_time", sa.String(8), nullable=False, server_default=""),
        sa.Column("end_time", sa.String(8), nullable=False, server_default=""),
        sa.Column("subject_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("group_name", sa.String(128), nullable=False, server_default=""),
        sa.Column("scheduled_room", sa.String(255), nullable=False, server_default=""),
        sa.Column("reason", sa.String(16), nullable=False, server_default="boshqa"),
        sa.Column("note", sa.String(500), nullable=False, server_default=""),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column("photo_type", sa.String(64), nullable=False, server_default=""),
        sa.Column("photo_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("photo_data", sa.LargeBinary(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("owner_key", "lesson_id", name="uq_core_offsitelesson_owner_lesson"),
    )
    op.create_index("ix_core_offsitelesson_owner_key", "core_offsitelesson", ["owner_key"])
    op.create_index("ix_core_offsitelesson_lesson_id", "core_offsitelesson", ["lesson_id"])
    op.create_index("ix_core_offsitelesson_date", "core_offsitelesson", ["lesson_date"])


def downgrade() -> None:
    op.drop_table("core_offsitelesson")
