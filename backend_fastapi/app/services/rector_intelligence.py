"""Ism bo'yicha qidiruv uchun normallashtirish (kirill → lotin, apostroflarsiz).

`rector_report_service` (o'qituvchi qidiruvi) va `interactive_board_service` (kafedra nomlari)
ishlatadi. Avvalgi "AI tahlil" hisoboti (2026-11-17 da olib tashlangan) ham shu faylda edi.
"""
from __future__ import annotations

import re
import unicodedata

CYRILLIC = dict(zip(
    'абвгдеёзийклмнопрстуфхцчэюяқғҳў',
    ['a','b','v','g','d','e','yo','z','i','y','k','l','m','n','o','p','r','s','t','u','f','x','ts','ch','e','yu','ya','q','g','h','o'],
))
CYRILLIC.update({'ж': 'j', 'ш': 'sh', 'щ': 'sh', 'ы': 'i', 'ь': '', 'ъ': ''})


def normalize_name(value: str) -> str:
    text = unicodedata.normalize('NFKC', value or '').casefold()
    text = ''.join(CYRILLIC.get(c, c) for c in text)
    text = re.sub(r"['‘’ʻʼ`´ʹ]", '', text)
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


def matches_name(row: dict, query: str, mode: str = 'contains') -> bool:
    tokens = normalize_name(query).split()
    hay = normalize_name(' '.join(str(row.get(k) or '') for k in ('display_name', 'first_name', 'last_name', 'owner_key')))
    words = hay.split()
    return all((token in words) if mode == 'exact' else (token in hay) for token in tokens)
