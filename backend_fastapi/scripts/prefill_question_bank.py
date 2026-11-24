"""Test bankini oldindan to'ldirish (2026-11-24).

    python scripts/prefill_question_bank.py --dry-run            # ertangi darslar: nima yoziladi
    python scripts/prefill_question_bank.py --day today --limit 5 # bugungi darslar, 5 ta mavzu
    python scripts/prefill_question_bank.py                       # ertangi darslar, hammasi
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys

sys.path.insert(0, "/app")

from app.core.config import get_settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.services import bank_prefill  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", default="tomorrow", help="today | tomorrow | YYYY-MM-DD")
    ap.add_argument("--per-course", type=int, default=2)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=5))).date()
    day = {"today": today, "tomorrow": today + dt.timedelta(days=1)}.get(args.day) or dt.date.fromisoformat(args.day)
    api_key = (get_settings().openai_api_key or "").strip()
    if not api_key:
        print("OpenAI kaliti yo'q")
        return 2
    db = SessionLocal()
    try:
        stats = bank_prefill.run(db, api_key, day, per_course=args.per_course, limit=args.limit, dry_run=args.dry_run)
    finally:
        db.close()
    print(f"kun: {day}")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
