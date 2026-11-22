"""Startap modulining qoldiqlarini olib tashlash (2026-11-17).

Startap moduli 2026-08 da olib tashlangan; endi jadval va `startuper` guruhi ham kerak emas:
- `core_startupprojectapplication` jadvali (prod'da 0 qator);
- `auth_group` dagi `startuper` guruhi va uning `auth_user_groups` /
  `auth_group_permissions` bog'lanishlari (yagona a'zo — nofaol demo hisob).

Revision ID: w8l9m0n1o2p3
Revises: v7k8l9m0n1o2
"""

from typing import Sequence, Union

from alembic import op

revision: str = "w8l9m0n1o2p3"
down_revision: Union[str, None] = "v7k8l9m0n1o2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS core_startupprojectapplication CASCADE")
    # auth_group_permissions Django'dan qolgan; har muhitda bo'lmasligi mumkin.
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('auth_group_permissions') IS NOT NULL THEN
                DELETE FROM auth_group_permissions
                WHERE group_id IN (SELECT id FROM auth_group WHERE name = 'startuper');
            END IF;
        END $$;
        """
    )
    op.execute(
        "DELETE FROM auth_user_groups "
        "WHERE group_id IN (SELECT id FROM auth_group WHERE name = 'startuper')"
    )
    op.execute("DELETE FROM auth_group WHERE name = 'startuper'")


def downgrade() -> None:
    # Qaytarib bo'lmaydi: jadval bo'sh edi, guruh yozuvi zaxira nusxalarda bor.
    pass
