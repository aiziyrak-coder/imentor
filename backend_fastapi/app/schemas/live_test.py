from __future__ import annotations

from pydantic import BaseModel, Field


class LiveTestUpsertRequest(BaseModel):
    session_key: str = ""
    topic: str = Field(max_length=1024)
    questions: list[dict] = Field(min_length=1, max_length=200)
    created_at_ms: int | None = None
    subject_code: str = ""


class LiveTestPublicOut(BaseModel):
    topic: str
    questions: list[dict]
    created_at_ms: int
    is_closed: bool
    closed_at_ms: int | None = None
    #: Testga ajratilgan vaqt soniyada (0 — chegarasiz). Sahifadagi izoh shundan yoziladi.
    time_limit_sec: int = 0
    #: Test tili ("ru" | "en" | "uz" | "") — talaba sahifasi yozuvlari shu tilda (2026-11-12).
    language: str = ""
    #: Mavzu nomi test tilida (tarjima bo'lmasa — asl `topic`).
    topic_display: str = ""
    #: "monitor" — savollar monitorda, telefonda faqat variantlar (`questions` bo'sh keladi) (2026-11-12).
    mode: str = ""
    question_count: int = 0


class LiveTestSubmissionCreateRequest(BaseModel):
    participant_key: str = ""
    first_name: str
    last_name: str
    answers: list[int] = Field(min_length=1, max_length=200)
    started_at_ms: int | None = None
    duration_sec: int | None = None


class LiveTestDraftUpsertRequest(BaseModel):
    participant_key: str
    first_name: str = ""
    last_name: str = ""
    # Qoralama ham topshiriqdek cheklanadi (2026-10-23): ilgari istalgan hajm saqlanardi.
    answers: list[int] = Field(default_factory=list, max_length=200)
