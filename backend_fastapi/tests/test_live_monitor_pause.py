"""Monitor aloqasi uzilsa test to'xtab turadi, qaytgach o'sha savol boshidan (2026-11-25).

Hodisa: Nevrologiya, 1-xona — 3-savolda monitor interneti uzildi, telefonlar keyingi savollarga o'taverdi va
talabalar qolgan 7 savolni ko'rmasdan belgiladi.
"""

import datetime as dt
from types import SimpleNamespace

from app.services import live_monitor as mon

mon.PAUSE_ENABLED = True  # ishlab chiqarishda o'chiq (IMENTOR_MONITOR_HOST_PAUSE) — bu yerda mantiq tekshiriladi

T0 = dt.datetime(2026, 11, 25, 4, 0, tzinfo=dt.timezone.utc)
TOTAL = 10
QUESTIONS = [{"question": f"q{i}", "options": ["a", "b", "c", "d"]} for i in range(TOTAL)]


def sec(n: float) -> dt.datetime:
    return T0 + dt.timedelta(seconds=n)


def session(seen_at: float | None, *, index: int = 0, closed: bool = False):
    return SimpleNamespace(
        monitor_phase=mon.RUNNING, is_closed=closed, monitor_index=index, monitor_started_at=T0,
        seconds_per_question=90, monitor_host_seen_at=None if seen_at is None else sec(seen_at),
    )


def test_untracked_session_runs_on_the_clock():
    st = mon.state(session(None), TOTAL, sec(200))
    assert (st["index"], st["stage"], st["paused"]) == (2, mon.READ, False)


def test_monitor_polling_normally_is_not_paused():
    st = mon.state(session(198), TOTAL, sec(200))
    assert (st["index"], st["paused"]) == (2, False)


def test_time_freezes_when_monitor_disappears():
    # Monitor 3-savol (indeks 2) o'qilayotganda, 200-soniyada oxirgi marta ko'rindi; 5 daqiqa o'tdi.
    s = session(200)
    st = mon.state(s, TOTAL, sec(500))
    assert st["paused"] is True
    assert st["index"] == 2  # telefonlar 6-savolga o'tib ketmaydi
    assert mon.can_answer(s, TOTAL, 2, sec(500)) is False
    assert mon.can_answer(s, TOTAL, 5, sec(500)) is False
    assert mon.resume_index(s, TOTAL, sec(500)) == 2


def test_paused_phone_gets_no_options_and_future_deadlines():
    now = sec(500)
    view = mon.student_view(mon.state(session(260), TOTAL, now), QUESTIONS, now)
    assert view["paused"] is True
    assert view["options"] == [] and "next_options" not in view
    assert view["stage"] == mon.READ
    # Eski sahifali telefon tugagan muddatni ko'rib tez-tez so'ramasin.
    assert view["read_ends_at_ms"] > int(now.timestamp() * 1000)
    assert view["ends_at_ms"] > view["read_ends_at_ms"]


def test_resume_restarts_the_interrupted_question():
    s = session(200)
    now = sec(500)
    index = mon.resume_index(s, TOTAL, now)
    s.monitor_index, s.monitor_started_at, s.monitor_host_seen_at = index, now, now
    st = mon.state(s, TOTAL, now + dt.timedelta(seconds=1))
    assert (st["index"], st["stage"], st["paused"]) == (2, mon.READ, False)
    assert st["read_ends_at"] == now + dt.timedelta(seconds=45)


def test_question_finished_within_grace_moves_on():
    # Monitor 2-savol belgilanayotganda (175-soniya) yo'qoldi; savol 180 da tugadi — u to'liq ko'rsatilgan.
    # Qaytganda ko'rsatilmagan 3-savol boshlanadi, 2-savol takrorlanmaydi.
    assert mon.resume_index(session(175), TOTAL, sec(600)) == 2


def test_last_question_finished_within_grace_ends_the_test():
    st = mon.state(session(895), TOTAL, sec(2000))
    assert (st["phase"], st["paused"]) == (mon.DONE, False)


def test_abandoned_test_ends_after_max_pause():
    late = sec(200) + mon.HOST_MAX_PAUSE + dt.timedelta(seconds=1)
    st = mon.state(session(200), TOTAL, late)
    assert (st["phase"], st["paused"]) == (mon.DONE, False)


def test_no_early_advance_while_paused():
    s = session(260)  # 3-savol belgilash bosqichi (225–270) ichida yo'qoldi
    drafts = [SimpleNamespace(student_id="1", participant_key="p", ready_at=T0, answers=[0, 1, 2])]
    assert mon.should_advance(s, TOTAL, 2, drafts, sec(264)) is True  # hali zaxira ichida
    assert mon.should_advance(s, TOTAL, 2, drafts, sec(400)) is False


def test_closed_or_lobby_session_is_never_paused():
    assert mon.host_gone(session(0, closed=True), sec(500)) is False
    lobby = session(0)
    lobby.monitor_phase = mon.LOBBY
    assert mon.host_gone(lobby, sec(500)) is False
