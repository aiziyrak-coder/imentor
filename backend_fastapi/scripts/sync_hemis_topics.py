"""HEMIS mavzularini iMentor sillabuslariga sinxronlash (2026-11-23).

    python scripts/sync_hemis_topics.py --dry-run
    python scripts/sync_hemis_topics.py --year 2026
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys

sys.path.insert(0, "/app")

from app.core.db import SessionLocal  # noqa: E402
from app.services import hemis_client, hemis_topics  # noqa: E402
from app.services.hemis_client import HemisError  # noqa: E402


def main() -> int:
    today = dt.date.today()
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--year", default=str(today.year if today.month >= 8 else today.year - 1))
    args, _ = ap.parse_known_args()
    if not hemis_client.configured():
        print("HEMIS_API_URL / HEMIS_API_TOKEN sozlanmagan (.env) — to'xtatildi")
        return 2
    db = SessionLocal()
    try:
        stats = hemis_topics.sync(db, education_year=args.year, dry_run=args.dry_run)
        for key, value in stats.items():
            print(f"  {key}: {value}")
        print("SINOV (saqlanmadi)" if args.dry_run else "SAQLANDI")
        return 0
    except HemisError as exc:
        db.rollback()
        print(f"HEMIS xatosi: {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
