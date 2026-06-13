#!/usr/bin/env python3
"""Parse Mart 2026 staff PDF into JSON roster with sequential phones."""
from __future__ import annotations

import json
import re
from pathlib import Path

PDF_PATH = Path(r"c:\Users\alocomputers\Desktop\Mart 2026.pdf")
OUT_PATH = Path(__file__).resolve().parent / "data" / "staff_mart2026_asosiy.json"
PHONE_PREFIX = "998990000"

DATE_RE = re.compile(
    r"(\d{1,2}[\.,/]\d{1,2}[\.,/]?\d{0,4}[KБk]?|\d{4}[KБk]?)$",
    re.IGNORECASE,
)
ENTRY_RE = re.compile(r"^(\d{1,4})\.\s+(.+)$")
PAGE_BREAK_RE = re.compile(r"^--\s+\d+\s+of\s+\d+\s+--$")
PATRONYMIC_TAIL_RE = re.compile(r"^(o[''`]?g[''`]?li|qizi|o‘g‘li|o'g'li)$", re.IGNORECASE)
POSITION_STARTERS = {
    "rektor", "prorektor", "dekan", "assistent", "assistant", "mudir", "tyutor",
    "kafedra", "dotsent", "professor", "muxandis", "hisobchi", "devonxona", "arxivarus",
    "mutaxassis", "menejer", "direktor", "kutubxonachi", "laborant", "tarbiyachi",
    "qorovul", "farrosh", "supuruvchi", "komendant", "elektrik", "santexnik", "duradgor",
    "vivariy", "yoquvchi", "audit", "iqtisodchi", "uslubchi", "psixolog", "xaydovchi",
    "kotiba", "dasturchi", "magistr", "stajyor", "stajor", "katta", "bosh", "ish",
    "bo'lim", "bolimi", "boshqarma", "sektor", "labor", "lab.", "o'qituvchi",
    "oqituvchi", "doktarant", "doktorant", "navbatchi", "o't", "ins", "daktarant",
    "assist", "assistent", "stajyor-o'qituvchi", "stajyor-o‘qituvchi",
}


def extract_pdf_text(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def is_patronymic_token(token: str) -> bool:
    low = token.lower().strip(".,/")
    if PATRONYMIC_TAIL_RE.match(low):
        return True
    return low.endswith(
        ("ovich", "ovna", "evich", "evna", "ugli", "qizi", "o'g'li", "o‘g‘li", "og'li")
    )


def split_name_and_rest(body: str) -> tuple[str, str, str, str]:
    body = re.sub(r"\s+", " ", body).strip()
    if not body:
        return "", "", "", ""

    birth_date = ""
    date_match = DATE_RE.search(body)
    if date_match:
        birth_date = date_match.group(1).strip()
        body = body[: date_match.start()].strip()

    tokens = body.split()
    if len(tokens) < 2:
        return body, "", "", birth_date

    last_name = tokens[0]
    first_name = tokens[1]
    idx = 2
    patronymic_parts: list[str] = []

    while idx < len(tokens):
        tok = tokens[idx]
        low = tok.lower().strip(".,/")
        if low in POSITION_STARTERS:
            break
        if idx >= 3 and not is_patronymic_token(tok) and not PATRONYMIC_TAIL_RE.match(low):
            break
        patronymic_parts.append(tok)
        if PATRONYMIC_TAIL_RE.match(low) or is_patronymic_token(tok):
            idx += 1
            break
        idx += 1

    patronymic = " ".join(patronymic_parts).strip()
    position = " ".join(tokens[idx:]).strip()
    if birth_date:
        position = f"{position} ({birth_date})".strip() if position else birth_date
    return last_name, first_name, patronymic, position


def parse_entries(text: str) -> list[dict]:
    lines = [ln.strip() for ln in text.splitlines()]
    merged_lines: list[str] = []
    buffer = ""

    for line in lines:
        if not line or PAGE_BREAK_RE.match(line):
            continue
        if ENTRY_RE.match(line):
            if buffer:
                merged_lines.append(buffer)
            buffer = line
            continue
        if buffer:
            buffer = f"{buffer} {line}"

    if buffer:
        merged_lines.append(buffer)

    rows: list[dict] = []
    seen_nums: set[int] = set()

    for line in merged_lines:
        m = ENTRY_RE.match(line)
        if not m:
            continue
        num = int(m.group(1))
        if num in seen_nums:
            continue
        seen_nums.add(num)

        body = m.group(2).strip()
        last_name, first_name, patronymic, position = split_name_and_rest(body)
        if not last_name or not first_name:
            continue

        rows.append(
            {
                "list_no": num,
                "last_name": last_name.title() if last_name.isupper() else last_name,
                "first_name": first_name.title() if first_name.isupper() else first_name,
                "patronymic": patronymic,
                "position": position,
                "full_name": " ".join(p for p in (last_name, first_name, patronymic) if p),
            }
        )

    rows.sort(key=lambda r: r["list_no"])
    return rows


def assign_phones(rows: list[dict], start: int = 1) -> list[dict]:
    out: list[dict] = []
    for i, row in enumerate(rows, start=start):
        phone_digits = f"{PHONE_PREFIX}{i:03d}"
        out.append(
            {
                **row,
                "phone_digits": phone_digits,
                "phone_display": f"+{phone_digits}",
                "role": "hodim",
            }
        )
    return out


def main() -> None:
    text = extract_pdf_text(PDF_PATH)
    rows = assign_phones(parse_entries(text))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Parsed {len(rows)} staff -> {OUT_PATH}")
    print(f"Phones: {rows[0]['phone_display']} .. {rows[-1]['phone_display']}")


if __name__ == "__main__":
    main()
