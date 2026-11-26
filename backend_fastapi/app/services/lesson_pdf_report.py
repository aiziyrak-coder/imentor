"""Guruhga PDF hisobot (2026-11-26, foydalanuvchi): kunlik, shanba — haftalik, oy oxiri — oylik.

Raqamlar rektor sahifasidagi bilan AYNAN bir xil: manba `lesson_report_service.lesson_rows` (o'sha baho,
o'sha qoida). Faqat monitorli xonadagi, baholanadigan (amaliy, klinik fan) va tugagan darslar sanaladi.
"""

from __future__ import annotations

import datetime as dt
import io
import logging
from collections import Counter, defaultdict

from sqlalchemy.orm import Session

from app.services import lesson_report_service as lr

log = logging.getLogger(__name__)

MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"]
WEEKDAYS = ["dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba"]
GREEN = ("full", "students", "block")
YELLOW = ("misuse", "short", "group")

_FONT_OK = False


def _fonts() -> tuple[str, str]:
    """DejaVu — o'zbekcha harflar (oʻ, gʻ, ʼ) va kirill to'g'ri chiqadi."""
    global _FONT_OK
    if not _FONT_OK:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

        base = "/usr/share/fonts/truetype/dejavu/"
        pdfmetrics.registerFont(TTFont("DV", base + "DejaVuSans.ttf"))
        pdfmetrics.registerFont(TTFont("DVB", base + "DejaVuSans-Bold.ttf"))
        _FONT_OK = True
    return "DV", "DVB"


def _day(d: dt.date) -> str:
    return f"{d.day}-{MONTHS[d.month - 1]}"


def reason(row: dict) -> str:
    """Nega yashil emas — bitta qisqa jumla (rektor sahifasidagi bilan bir ma'noda)."""
    v = row.get("verdict")
    md = row.get("modules") or {}
    if v == "none":
        return "iMentor ochilmagan"
    if v == "group":
        return "o'qituvchi kirmagan, faqat talabalar faol"
    if v == "short":
        return f"{row.get('minutes') or 0} daqiqa ishlagan (kerak {lr.MIN_LESSON_MINUTES})"
    if v == "misuse":
        parts = []
        for g in md.get("gaps") or []:
            if g == "no_answers":
                parts.append("talabalar test yechmagan")
            elif g == "no_reveal":
                parts.append(f"keys tahlili ochilmagan ({md.get('case_minutes', 0)} daq)")
            elif g == "case_time":
                parts.append(f"keysda {md.get('case_minutes', 0)} daqiqa")
            elif g == "test":
                parts.append("test yo'q")
            elif g == "case":
                parts.append("keys yo'q")
            elif g == "test_time":
                parts.append(f"testda {md.get('test_minutes', 0)} daqiqa")
        return ", ".join(parts) or "test/keys sharti bajarilmagan"
    return ""


def collect(db: Session, start: dt.date, end: dt.date) -> list[dict]:
    rows = lr.lesson_rows(db, start, end, limit=100000)
    return [r for r in rows if r.get("counted") and r.get("monitor_id") and not r.get("pending")]


def summarize(rows: list[dict]) -> dict:
    c = Counter("g" if r["verdict"] in GREEN else "y" if r["verdict"] in YELLOW else "r" for r in rows)
    total = len(rows)
    deps: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        k = "g" if r["verdict"] in GREEN else "y" if r["verdict"] in YELLOW else "r"
        deps[r.get("department") or "—"][k] += 1
    return {"total": total, "g": c["g"], "y": c["y"], "r": c["r"],
            "pct": round(100 * c["g"] / total) if total else 0, "deps": deps}


def caption(kind: str, start: dt.date, end: dt.date, s: dict) -> str:
    title = {"daily": f"📊 Kunlik hisobot — {_day(end)}, {WEEKDAYS[end.weekday()]}",
             "weekly": f"📅 Haftalik hisobot — {_day(start)} – {_day(end)}",
             "monthly": f"🗓 Oylik hisobot — {MONTHS[start.month - 1]} {start.year}"}[kind]
    return (f"<b>{title}</b>\n"
            f"Nazoratdagi darslar: <b>{s['total']}</b>\n"
            f"✅ To'g'ri o'tilgan: <b>{s['g']}</b> ({s['pct']}%)\n"
            f"🟡 Qisman: <b>{s['y']}</b>   🔴 Ochilmagan: <b>{s['r']}</b>\n"
            f"Batafsil — PDF faylda.")


def build_pdf(kind: str, start: dt.date, end: dt.date, rows: list[dict]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    f, fb = _fonts()
    s = summarize(rows)
    ink, muted = colors.HexColor("#0f172a"), colors.HexColor("#64748b")
    green, amber, red = colors.HexColor("#059669"), colors.HexColor("#d97706"), colors.HexColor("#dc2626")
    line = colors.HexColor("#e2e8f0")
    st = {
        "h1": ParagraphStyle("h1", fontName=fb, fontSize=17, leading=21, textColor=ink),
        "sub": ParagraphStyle("sub", fontName=f, fontSize=9.5, leading=13, textColor=muted),
        "h2": ParagraphStyle("h2", fontName=fb, fontSize=12, leading=16, textColor=ink, spaceBefore=8, spaceAfter=4),
        "cell": ParagraphStyle("cell", fontName=f, fontSize=8.5, leading=11, textColor=ink),
        "cellb": ParagraphStyle("cellb", fontName=fb, fontSize=8.5, leading=11, textColor=ink),
        "kpi": ParagraphStyle("kpi", fontName=fb, fontSize=18, leading=22, alignment=1),
        "kpil": ParagraphStyle("kpil", fontName=f, fontSize=8, leading=10, alignment=1, textColor=muted),
        "note": ParagraphStyle("note", fontName=f, fontSize=8, leading=11, textColor=muted),
    }
    P = Paragraph
    title = {"daily": f"Kunlik hisobot — {_day(end)} {end.year}, {WEEKDAYS[end.weekday()]}",
             "weekly": f"Haftalik hisobot — {_day(start)} – {_day(end)} {end.year}",
             "monthly": f"Oylik hisobot — {MONTHS[start.month - 1]} {start.year}"}[kind]
    rule = ("o'qituvchi iMentor'da ishlagan, talabalar testni yechgan va keys tahlili ochilgan"
            if end >= lr.REAL_USE_SINCE else "o'qituvchi iMentor'da ishlagan, test va keys bo'limlarida yetarli vaqt ishlangan")
    story = [P("iMentor — darslar nazorati", st["sub"]), P(title, st["h1"]), Spacer(1, 3 * mm),
             P(f"Faqat monitorli xonadagi amaliy darslar (klinik fanlar). Dars to'g'ri o'tilgan: {rule}.", st["sub"]),
             Spacer(1, 5 * mm)]

    def kpi(value, label, color):
        return [P(f'<font color="{color.hexval()}">{value}</font>', st["kpi"]), P(label, st["kpil"])]
    tiles = Table([[kpi(s["total"], "Nazoratdagi darslar", ink), kpi(f"{s['pct']}%", "To'g'ri o'tilgan", green),
                    kpi(s["y"], "Qisman (sariq)", amber), kpi(s["r"], "Ochilmagan (qizil)", red)]],
                  colWidths=[45 * mm] * 4)
    tiles.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, line), ("INNERGRID", (0, 0), (-1, -1), 0.6, line),
                               ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                               ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story += [tiles, Spacer(1, 6 * mm)]

    def table(data, widths, head_bg="#0f172a"):
        t = Table(data, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(head_bg)), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), fb), ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, line), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
        return t

    # Kafedralar — eng past foizdan.
    story.append(P("Kafedralar kesimida", st["h2"]))
    data = [["Kafedra", "Darslar", "To'g'ri", "Sariq", "Qizil", "%"]]
    for dep, c in sorted(s["deps"].items(), key=lambda kv: (kv[1]["g"] / max(1, sum(kv[1].values())), kv[0])):
        tot = sum(c.values()); pct = round(100 * c["g"] / tot) if tot else 0
        col = green if pct >= 70 else amber if pct >= 40 else red
        data.append([P(dep, st["cell"]), tot, c["g"], c["y"], c["r"],
                     P(f'<font color="{col.hexval()}"><b>{pct}%</b></font>', st["cell"])])
    story.append(table(data, [86 * mm, 18 * mm, 18 * mm, 16 * mm, 16 * mm, 16 * mm]))

    if kind != "daily":
        # Kunlar bo'yicha dinamika.
        by_day: dict[str, Counter] = defaultdict(Counter)
        for r in rows:
            by_day[r["date"]]["g" if r["verdict"] in GREEN else "x"] += 1
        story.append(P("Kunlar bo'yicha", st["h2"]))
        data = [["Kun", "Darslar", "To'g'ri", "%"]]
        for d in sorted(by_day):
            c = by_day[d]; tot = c["g"] + c["x"]; dd = dt.date.fromisoformat(d)
            data.append([f"{_day(dd)}, {WEEKDAYS[dd.weekday()]}", tot, c["g"], f"{round(100 * c['g'] / tot) if tot else 0}%"])
        story.append(table(data, [70 * mm, 30 * mm, 30 * mm, 30 * mm]))

    # Muammoli darslar: kunlik — har dars alohida; haftalik/oylik — o'qituvchi bo'yicha jamlangan.
    bad = [r for r in rows if r["verdict"] not in GREEN]
    if kind == "daily":
        story.append(P(f"To'g'ri o'tilmagan darslar ({len(bad)})", st["h2"]))
        data = [["Kafedra / o'qituvchi", "Para", "Guruh", "Holat"]]
        for r in sorted(bad, key=lambda r: (r.get("department") or "", r.get("teacher_name") or "", r.get("para") or "")):
            col = red if r["verdict"] == "none" else amber
            data.append([P(f"<b>{r.get('teacher_name') or '—'}</b><br/>{r.get('department') or ''}", st["cell"]),
                         P(str(r.get("para") or ""), st["cell"]), P(str(r.get("group") or "")[:40], st["cell"]),
                         P(f'<font color="{col.hexval()}">{reason(r)}</font>', st["cell"])])
        if len(data) > 1:
            story.append(table(data, [62 * mm, 18 * mm, 38 * mm, 62 * mm], head_bg="#7f1d1d"))
        else:
            story.append(P("Hamma darslar to'g'ri o'tilgan.", st["cell"]))
    else:
        per: dict[tuple, Counter] = defaultdict(Counter)
        total_t: Counter = Counter()
        for r in rows:
            k = (r.get("teacher_name") or "—", r.get("department") or "")
            total_t[k] += 1
            if r["verdict"] not in GREEN:
                per[k]["r" if r["verdict"] == "none" else "y"] += 1
        worst = sorted(per.items(), key=lambda kv: (-(kv[1]["r"] + kv[1]["y"]), kv[0]))[:40]
        story.append(P("Eng ko'p muammoli darsi bo'lgan o'qituvchilar", st["h2"]))
        data = [["O'qituvchi", "Kafedra", "Darslar", "Qizil", "Sariq"]]
        for (name, dep), c in worst:
            data.append([P(f"<b>{name}</b>", st["cell"]), P(dep, st["cell"]), total_t[(name, dep)], c["r"], c["y"]])
        story.append(table(data, [52 * mm, 78 * mm, 18 * mm, 16 * mm, 16 * mm], head_bg="#7f1d1d"))

    story += [Spacer(1, 6 * mm), P(
        f"Manba: HEMIS jadvali va iMentor faolligi. Tuzilgan: {dt.datetime.now(lr.ms.TASHKENT):%d.%m.%Y %H:%M}. "
        "Monitorsiz joyda dars beradigan va hisobotdan chiqarilgan o'qituvchilar sanalmaydi.", st["note"])]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=12 * mm,
                            bottomMargin=12 * mm, title=title, author="iMentor")
    doc.build(story)
    return buf.getvalue()


def report(db: Session, kind: str, day: dt.date) -> tuple[bytes, str, str] | None:
    """(pdf, caption, fayl nomi) — `day` hisobot kuni (kunlik), hafta yoki oyning oxirgi kuni."""
    if kind == "daily":
        start = end = day
    elif kind == "weekly":
        start, end = day - dt.timedelta(days=day.weekday()), day
    else:
        start, end = day.replace(day=1), day
    rows = collect(db, start, end)
    if not rows:
        return None
    pdf = build_pdf(kind, start, end, rows)
    name = {"daily": f"iMentor-kunlik-{end:%Y-%m-%d}.pdf", "weekly": f"iMentor-haftalik-{start:%m%d}-{end:%m%d}.pdf",
            "monthly": f"iMentor-oylik-{start:%Y-%m}.pdf"}[kind]
    return pdf, caption(kind, start, end, summarize(rows)), name


def kinds_for(day: dt.date) -> list[str]:
    """Shu kuni qaysi hisobotlar: har kuni kunlik; shanba — haftalik; oyning oxirgi o'quv kuni — oylik."""
    out = ["daily"]
    if day.weekday() == 5:
        out.append("weekly")
    nxt = day + dt.timedelta(days=1)
    while nxt.weekday() == 6:  # yakshanba dars yo'q
        nxt += dt.timedelta(days=1)
    if nxt.month != day.month:
        out.append("monthly")
    return out
