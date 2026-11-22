"""Talabalar natijalari arxivini to'ldirish (2026-10-23): mavjud yakunlangan urinishlar.

    python scripts/archive_student_results.py                    # hammasi, 4000 talik bo'laklarda
    python scripts/archive_student_results.py --refresh-days 60  # + oxirgi 60 kun qamrovini qayta hisoblash

Takror ishga tushsa ham xavfsiz — arxivda bor urinish qayta yozilmaydi. `--refresh-days`
faqat qamrov, para, fan, kafedra va kunni yangilaydi (ball va baho o'zgarmaydi).
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.db import SessionLocal  # noqa: E402
from app.services import results_archive  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument("--refresh-days", type=int, default=0)
args = parser.parse_args()

total = 0
with SessionLocal() as db:
    while True:
        n = results_archive.archive_pending(db)
        total += n
        print(f"  +{n} (jami {total})", flush=True)
        if n == 0:
            break
    print("tayyor:", total)
    if args.refresh_days > 0:
        print("qayta hisoblandi:", results_archive.refresh_recent(db, args.refresh_days))
