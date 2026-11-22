"""Monitorli xonalar admin paneldan: `core_monitordepartment`, `core_monitorroom` (2026-11-16).

Jadvallar `app/data/interactive_boards.json` dagi hozirgi inventar bilan to'ldiriladi — monitor ID'lari
aynan hozirgidek (ketma-ket `rooms` + aniq ID'li `extra_rooms`), shuning uchun hech bir dars boshqa
monitorga o'tib ketmaydi. Bundan keyin manba — shu jadvallar.

Revision ID: s4h5i6j7k8l9
Revises: r3g4h5i6j7k8
"""

import json
import re
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "s4h5i6j7k8l9"
down_revision: Union[str, None] = "r3g4h5i6j7k8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INVENTORY = Path(__file__).resolve().parents[2] / "app" / "data" / "interactive_boards.json"


def _clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip()


def upgrade() -> None:
    op.create_table(
        "core_monitordepartment",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("row", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("aliases", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("group_rooms", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "core_monitorroom",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("monitor_id", sa.String(16), nullable=False),
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("core_monitordepartment.id", ondelete="CASCADE"), nullable=False),
        sa.Column("room_full", sa.String(255), nullable=False),
        sa.Column("hemis_codes", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active_from", sa.Date(), nullable=True),
        sa.Column("active_to", sa.Date(), nullable=True),
        sa.Column("note", sa.String(255), nullable=False, server_default=""),
        sa.Column("updated_by", sa.String(128), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_core_monitorroom_monitor_id", "core_monitorroom", ["monitor_id"], unique=True)
    op.create_index("ix_core_monitorroom_department_id", "core_monitorroom", ["department_id"])

    if not INVENTORY.exists():
        return
    data = json.loads(INVENTORY.read_text(encoding="utf-8"))
    bind = op.get_bind()
    dep_t = sa.table("core_monitordepartment", sa.column("id"), sa.column("row"), sa.column("name"),
                     sa.column("aliases", postgresql.JSONB), sa.column("group_rooms", postgresql.JSONB))
    room_t = sa.table("core_monitorroom", sa.column("monitor_id"), sa.column("department_id"), sa.column("room_full"),
                      sa.column("sort"), sa.column("hemis_codes", postgresql.JSONB))
    n = 1
    dep_ids = []
    for dep in data.get("departments", []):
        dep_id = bind.execute(dep_t.insert().values(
            row=int(dep.get("row") or 0), name=_clean(dep.get("department")),
            aliases=[_clean(a) for a in dep.get("aliases", []) or [] if _clean(a)],
            group_rooms=dep.get("group_rooms", []) or [],
        ).returning(dep_t.c.id)).scalar()
        dep_ids.append((dep, dep_id))
        for i, room in enumerate(dep.get("rooms", []) or []):
            text = _clean(room)
            if not text:
                continue
            # `monitor_schedule_service.monitors()` bilan aynan bir xil raqamlash.
            bind.execute(room_t.insert().values(monitor_id=f"MON-{n:03d}", department_id=dep_id, room_full=text,
                                                sort=i, hemis_codes=[]))
            n += 1
    for dep, dep_id in dep_ids:
        for j, extra in enumerate(dep.get("extra_rooms", []) or []):
            text = _clean(extra.get("room"))
            if text and extra.get("monitor_id"):
                bind.execute(room_t.insert().values(monitor_id=_clean(extra["monitor_id"]), department_id=dep_id,
                                                    room_full=text, sort=100 + j, hemis_codes=[]))


def downgrade() -> None:
    op.drop_index("ix_core_monitorroom_department_id", table_name="core_monitorroom")
    op.drop_index("ix_core_monitorroom_monitor_id", table_name="core_monitorroom")
    op.drop_table("core_monitorroom")
    op.drop_table("core_monitordepartment")
