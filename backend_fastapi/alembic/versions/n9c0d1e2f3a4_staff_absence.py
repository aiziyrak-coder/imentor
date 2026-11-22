"""Xodimning ishda bo'lmagan kunlari: kasallik varaqasi, ta'til, xizmat safari (2026-10-28).

Revision ID: n9c0d1e2f3a4
Revises: m8b9c0d1e2f3
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "n9c0d1e2f3a4"
down_revision: Union[str, None] = "m8b9c0d1e2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_staffabsence",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_key", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("note", sa.String(500), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("doc_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("doc_type", sa.String(64), nullable=False, server_default=""),
        sa.Column("doc_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("doc_data", sa.LargeBinary(), nullable=True),
        sa.Column("decided_by", sa.String(128), nullable=False, server_default=""),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.String(255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_core_staffabsence_owner_dates", "core_staffabsence", ["owner_key", "start_date", "end_date"])
    op.create_index("ix_core_staffabsence_status", "core_staffabsence", ["status"])


def downgrade() -> None:
    op.drop_index("ix_core_staffabsence_status", table_name="core_staffabsence")
    op.drop_index("ix_core_staffabsence_owner_dates", table_name="core_staffabsence")
    op.drop_table("core_staffabsence")
