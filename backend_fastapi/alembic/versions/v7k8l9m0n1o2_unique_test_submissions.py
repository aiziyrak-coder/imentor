"""Bitta talaba bitta testda ikki marta yozilmasin (2026-11-17 auditi, G14).

- `core_livetestsubmission`: (session_id, student_id) bo'yicha noyob qisman indeks
  (`student_id <> ''` — ID'siz eski topshiriqlar cheklanmaydi). Django migratsiyasi
  bir paytlar shunday cheklov qo'shib, keyin olib tashlagan edi.
- `malaka_test_attempt`: (student_id, syllabus_id, topic_code, kind, attempt_no) noyob —
  parallel so'rovlar bir urinish raqamini ikki marta yoza olmasin.

Migratsiya MA'LUMOT O'CHIRMAYDI. Jadvalda takrorlar allaqachon bo'lsa butun jadvalga noyob
indeks qo'yib bo'lmaydi — shuning uchun avval tekshiriladi. Takror bor bo'lsa (prod'da 2026-11-17:
117 229 topshiriqdan 4 ta eski takror): qidiruv uchun ODDIY indeks + faqat SHU PAYTDAN KEYINGI
yozuvlarga (`id > <hozirgi eng katta id>`) noyob indeks. Eski takrorlar tegilmaydi, yangilari
baza darajasida taqiqlanadi.

Revision ID: v7k8l9m0n1o2
Revises: tk1a2b3c4d5e
"""

import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v7k8l9m0n1o2"
down_revision: Union[str, None] = "tk1a2b3c4d5e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

#: (jadval, noyob indeks, zaxira oddiy indeks, ustunlar, qisman shart)
INDEXES = (
    (
        "core_livetestsubmission",
        "uq_livetestsubmission_session_student",
        "ix_livetestsubmission_session_student",
        ("session_id", "student_id"),
        "student_id <> ''",
    ),
    (
        "malaka_test_attempt",
        "uq_malaka_test_attempt_no",
        "ix_malaka_test_attempt_no",
        ("student_id", "syllabus_id", "topic_code", "kind", "attempt_no"),
        "",
    ),
)


def _has_duplicates(bind, table: str, columns: tuple[str, ...], where: str) -> int:
    cols = ", ".join(columns)
    cond = f"WHERE {where} " if where else ""
    sql = (
        f"SELECT count(*) FROM (SELECT 1 FROM {table} {cond}"
        f"GROUP BY {cols} HAVING count(*) > 1) AS d"
    )
    return int(bind.execute(sa.text(sql)).scalar() or 0)


def upgrade() -> None:
    bind = op.get_bind()
    for table, unique_name, plain_name, columns, where in INDEXES:
        cols = ", ".join(columns)
        cond = f" WHERE {where}" if where else ""
        groups = _has_duplicates(bind, table, columns, where)
        if groups:
            # Deploy yiqilmasin: takrorlar o'chirilmaydi. Qidiruv indeksi + yangi yozuvlarga noyob indeks.
            max_id = int(bind.execute(sa.text(f"SELECT coalesce(max(id), 0) FROM {table}")).scalar() or 0)
            logger.warning(
                "%s: %d ta eski takror guruh (%s) bor — noyob indeks %s faqat id > %d yozuvlarga.",
                table, groups, cols, unique_name, max_id,
            )
            op.execute(f"CREATE INDEX IF NOT EXISTS {plain_name} ON {table} ({cols}){cond}")
            new_cond = f" WHERE {where} AND id > {max_id}" if where else f" WHERE id > {max_id}"
            op.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS {unique_name} ON {table} ({cols}){new_cond}")
        else:
            op.execute(f"DROP INDEX IF EXISTS {plain_name}")
            op.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS {unique_name} ON {table} ({cols}){cond}")


def downgrade() -> None:
    for _table, unique_name, plain_name, _columns, _where in INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {unique_name}")
        op.execute(f"DROP INDEX IF EXISTS {plain_name}")
