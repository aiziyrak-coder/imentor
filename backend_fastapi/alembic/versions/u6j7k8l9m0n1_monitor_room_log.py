"""Monitorli xonalar o'zgarishlari tarixi (`core_monitorroomlog`, 2026-11-16).

Revision ID: u6j7k8l9m0n1
Revises: t5i6j7k8l9m0
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "u6j7k8l9m0n1"
down_revision: Union[str, None] = "t5i6j7k8l9m0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_monitorroomlog",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("by", sa.String(128), nullable=False, server_default=""),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("monitor_id", sa.String(16), nullable=False, server_default=""),
        sa.Column("hemis_code", sa.String(32), nullable=False, server_default=""),
        sa.Column("room", sa.String(255), nullable=False, server_default=""),
        sa.Column("detail", sa.String(255), nullable=False, server_default=""),
        sa.Column("undone", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_core_monitorroomlog_at", "core_monitorroomlog", ["at"])


def downgrade() -> None:
    op.drop_index("ix_core_monitorroomlog_at", table_name="core_monitorroomlog")
    op.drop_table("core_monitorroomlog")
