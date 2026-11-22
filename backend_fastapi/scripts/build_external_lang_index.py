"""Tashqi API (fermi.uz) uchun til indeksi va statistikasini yangilaydi — cron, har 10 daqiqada.

    docker exec -w /app -e PYTHONPATH=. imentor-backend_fastapi-1 nice -n 10 \
        python scripts/build_external_lang_index.py [--report /app/media/diag/lang-gaps.csv] [--no-store]

* indeks: har hujjat uchun asl til, mavjud tillar va har tilda yaroqli savollar (`external_lang.analyse`);
  mazmuni o'zgarmagan hujjat qayta hisoblanmaydi (xesh bo'yicha), birinchi to'liq yurish ~1,5 daqiqa;
* statistika: `/external/tests/stats/` va `/external/keys/stats/` javoblari tayyorlab qo'yiladi — endpoint
  ularni keshdan beradi (ilgari har so'rov ~15 soniya);
* `--report`: fan bo'yicha qaysi tilda nechta hujjat/savol borligi va qaysi tilda yo'qligi (CSV) — mualliflar
  tarjima qo'shishi uchun (avval o'zbekcha).

Veb ishchilardan ALOHIDA jarayon: og'ir hisob sayt so'rovlariga xalaqit bermaydi.
"""

from __future__ import annotations

import argparse
import csv
import logging
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import SessionLocal  # noqa: E402
from app.models.prepared_content import PreparedContent  # noqa: E402
from app.services import content_catalog as cc  # noqa: E402
from app.services import external_lang as el  # noqa: E402

log = logging.getLogger("external-lang-index")


def _report_rows(items_by_kind: dict[str, list], infos: dict[int, dict]) -> list[dict]:
    rows: dict[tuple[str, str], dict] = {}
    for kind, items in items_by_kind.items():
        for item in items:
            info = infos.get(int(item.id)) or {}
            code = cc.effective_subject_code(item) or ""
            name = cc.effective_subject_name(item) or item.subject_name or ""
            row = rows.setdefault((kind, code), {
                "kind": "test" if kind == "test" else "case", "subject_code": code, "subject_name": name,
                "documents": 0, "questions": 0,
                **{f"docs_{c}": 0 for c in el.FILTER_LANGS},
                **{f"questions_{c}": 0 for c in el.FILTER_LANGS},
            })
            row["documents"] += 1
            row["questions"] += int(info.get("n") or 0)
            for lang in el.FILTER_LANGS:
                if el.has_language(info, lang):
                    row[f"docs_{lang}"] += 1
                    row[f"questions_{lang}"] += len((info.get("q") or {}).get(lang, []))
    out = []
    for row in rows.values():
        for lang in el.LANGS:
            row[f"docs_missing_{lang}"] = row["documents"] - row[f"docs_{lang}"]
        out.append(row)
    # Avval o'zbekchasi eng ko'p yetishmaydiganlar.
    out.sort(key=lambda r: (-r["docs_missing_uz"], r["kind"], r["subject_name"]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", default="")
    ap.add_argument("--no-store", action="store_true", help="Redis'ga yozmaydi (sinov)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    started = time.time()
    db = SessionLocal()
    try:
        items_by_kind: dict[str, list] = {}
        infos: dict[int, dict] = {}
        for kind in ("test", "case"):
            items = list(db.execute(
                cc.published_catalog_stmt().where(PreparedContent.kind == kind)
            ).scalars().all())
            items_by_kind[kind] = items
            for start in range(0, len(items), 500):
                infos.update(el.infos_for(db, items[start:start + 500], store=not args.no_store))
            log.info("%s: %d hujjat, %.0f s", kind, len(items), time.time() - started)
            if not args.no_store:
                body = cc.build_catalog_stats(db, published_only=True, kind=kind)
                el.store_stats(kind, el.add_language_counts(body, items, infos, kind))
        totals = defaultdict(int)
        for kind, items in items_by_kind.items():
            for item in items:
                info = infos.get(int(item.id)) or {}
                totals[f"{kind}:primary:{info.get('p')}"] += 1
                for lang in info.get("a") or []:
                    totals[f"{kind}:available:{lang}"] += 1
        log.info("tillar: %s", dict(sorted(totals.items())))
        if args.report:
            rows = _report_rows(items_by_kind, infos)
            path = Path(args.report)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("w", encoding="utf-8-sig", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else ["kind"])
                writer.writeheader()
                writer.writerows(rows)
            log.info("hisobot: %s (%d qator)", path, len(rows))
        log.info("tayyor, %.0f s", time.time() - started)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
