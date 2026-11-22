"""Nazoratdagi fanlar — admin qarori (`core_subjectscope`, 2026-11-16).

Bo'sh jadval: avtomatik qoida (`clinical_subjects.auto_verdict`) ishlaydi, admin faqat
o'zgartirgan fanlar shu yerga yoziladi. Hech qanday mavjud ma'lumot o'zgarmaydi.

Revision ID: t5i6j7k8l9m0
Revises: s4h5i6j7k8l9
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "t5i6j7k8l9m0"
down_revision: Union[str, None] = "s4h5i6j7k8l9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_subjectscope",
        sa.Column("subject_key", sa.String(300), primary_key=True),
        sa.Column("subject_name", sa.String(300), nullable=False, server_default=""),
        sa.Column("clinical", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_by", sa.String(150), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("core_subjectscope")
