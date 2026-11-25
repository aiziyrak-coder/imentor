"""Jonli test: monitor oxirgi ko'ringan payt — aloqasi uzilsa test to'xtab turadi (2026-11-25).

Revision ID: x9m0n1o2p3q4
Revises: w8l9m0n1o2p3
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "x9m0n1o2p3q4"
down_revision: Union[str, None] = "w8l9m0n1o2p3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("core_livetestsession",
                  sa.Column("monitor_host_seen_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("core_livetestsession", "monitor_host_seen_at")
