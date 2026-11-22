"""Talabalar natijalari arxivi (o'chmaydigan, sessiyaga bog'lanmagan)

Revision ID: l7a8b9c0d1e2
Revises: k6f7a8b9c0d1
Create Date: 2026-10-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "l7a8b9c0d1e2"
down_revision: Union[str, None] = "k6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_studentresult",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("attempt_id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("student_id", sa.String(length=64), nullable=False),
        sa.Column("student_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("group_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("faculty_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("course", sa.SmallInteger(), nullable=True),
        sa.Column("lesson_date", sa.Date(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("para", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("subject_code", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("subject_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("department", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("teacher_username", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("teacher_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("topic", sa.Text(), nullable=False, server_default=""),
        sa.Column("topic_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("percent", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("grade", sa.SmallInteger(), nullable=False, server_default="2"),
        sa.Column("duration_sec", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("in_scope", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_core_studentresult_attempt_id", "core_studentresult", ["attempt_id"], unique=True)
    op.create_index("ix_core_studentresult_student_id", "core_studentresult", ["student_id"])
    op.create_index("ix_core_studentresult_group_name", "core_studentresult", ["group_name"])
    op.create_index("ix_core_studentresult_lesson_date", "core_studentresult", ["lesson_date"])
    op.create_index("ix_core_studentresult_in_scope", "core_studentresult", ["in_scope"])


def downgrade() -> None:
    op.drop_table("core_studentresult")
