from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class LiveTestSession(Base):
    __tablename__ = "core_livetestsession"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_key: Mapped[str] = mapped_column(String(160), unique=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    payload: Mapped[dict] = mapped_column(JSONB)
    # Fan kesimida natijalar/statistika uchun — bo'sh bo'lishi mumkin (eski yozuvlar).
    subject_code: Mapped[str] = mapped_column(String(200), default="")
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False)
    closed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    # --- Monitor rejimi (2026-11-12): savol monitorda, telefonda faqat variantlar, hamma birga.
    #: "monitor" — yangi sessiyalar; "" — eski (hamma savol telefonda) sessiyalar.
    mode: Mapped[str] = mapped_column(String(16), default="", server_default="")
    #: lobby → running → done. Joriy savol `monitor_index` + o'tgan vaqtdan HISOBLANADI (so'rovlarda yozilmaydi).
    monitor_phase: Mapped[str] = mapped_column(String(16), default="", server_default="")
    monitor_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    monitor_started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    seconds_per_question: Mapped[int] = mapped_column(Integer, default=60, server_default="60")

    submissions: Mapped[list["LiveTestSubmission"]] = relationship(
        back_populates="session", lazy="selectin"
    )
    drafts: Mapped[list["LiveTestDraft"]] = relationship(back_populates="session", lazy="selectin")


class LiveTestSubmission(Base):
    __tablename__ = "core_livetestsubmission"
    __table_args__ = (
        # Bitta talaba bitta sessiyada bir marta (2026-11-17, G14; migratsiya v7k8l9m0n1o2).
        # Bazada takrorlar bo'lsa migratsiya bu indeks o'rniga oddiy indeks qo'yadi.
        Index(
            "uq_livetestsubmission_session_student",
            "session_id",
            "student_id",
            unique=True,
            postgresql_where=text("student_id <> ''"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("core_livetestsession.id", ondelete="CASCADE"))
    participant_key: Mapped[str] = mapped_column(String(64), default="")
    student_id: Mapped[str] = mapped_column(String(64), default="")
    first_name: Mapped[str] = mapped_column(String(128))
    last_name: Mapped[str] = mapped_column(String(128))
    answers: Mapped[list] = mapped_column(JSONB)
    submitted_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    session: Mapped[LiveTestSession] = relationship(back_populates="submissions")


class LiveTestDraft(Base):
    __tablename__ = "core_livetestdraft"
    __table_args__ = (
        UniqueConstraint("session_id", "participant_key", name="uniq_live_test_draft_participant"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("core_livetestsession.id", ondelete="CASCADE"))
    participant_key: Mapped[str] = mapped_column(String(64))
    # Qoralama KIMNIKI: test yopilganda topshiriq shu talabaga yoziladi.
    student_id: Mapped[str] = mapped_column(String(64), default="", server_default="")
    first_name: Mapped[str] = mapped_column(String(128), default="")
    last_name: Mapped[str] = mapped_column(String(128), default="")
    answers: Mapped[list] = mapped_column(JSONB, default=list)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    #: Talaba testni ochgan payt — vaqt chegarasi shundan sanaladi (2026-10-22).
    #: Sahifani yangilash yoki boshqa qurilmadan kirish vaqtni qaytadan boshlamaydi.
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Monitor rejimi: talaba "Tayyorman" bosgan payt (o'qituvchi hamma tayyor bo'lgach boshlaydi).
    ready_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    session: Mapped[LiveTestSession] = relationship(back_populates="drafts")
