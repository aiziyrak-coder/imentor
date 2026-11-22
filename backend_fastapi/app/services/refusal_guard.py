"""AI rad javobi material bo'lib saqlanmasin (2026-10-21).

21-oktabrda 26 ta "ma'ruza" aslida modelning "darslik parchalarini yuboring"
degan javobi edi va 10 ta taqdimot shu matndan yasaldi. Brauzer tomoni
(`isLectureRefusal`) yangi versiyada buni to'xtatadi, lekin sahifani
yangilamagan o'qituvchining eski kodi baribir saqlardi — shuning uchun server
ham tekshiradi. Faqat aniq belgilar: qisqa, lekin haqiqiy ma'ruza rad etilmaydi.
"""

from __future__ import annotations

import json
import re

REFUSAL = re.compile(
    r"yuborilmadi|iltimos.{0,40}yubor|kechirasiz|bajarib bo.?lmay|aniqlashtirish savol|sizdan kerak|"
    r"kerak bo.?ladigan .{0,20}ma.?lumot|пришлите|не были предоставлены|к сожалению|извините|не могу|"
    r"please (?:send|provide)|were not provided|i cannot|i can['’]t|i(?: am|['’]m) unable|missing the|lack the",
    re.I,
)
# Taqdimot ichida rad javobining izi: ikkitasi bo'lsa — rad matnidan yasalgan.
DECK_REFUSAL = re.compile(
    r"parcha\w{0,6} yubor|yuborsangiz|manba\w{0,6} yubor|darslik parchalari|kitob nomi va sahif|"
    r"kechirasiz|пришлите|извините|please (?:send|provide)|\[object Object\]",
    re.I,
)


def lecture_is_refusal(content: str) -> bool:
    s = (content or "").strip()
    if not s:
        return True
    if "[object Object]" in s:
        return True
    return not s.startswith("# ") and bool(REFUSAL.search(s[:1500]))


def deck_is_refusal(payload: object) -> bool:
    try:
        text = json.dumps(payload, ensure_ascii=False)
    except (TypeError, ValueError):
        return False
    return len(DECK_REFUSAL.findall(text)) >= 2
