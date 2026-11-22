from __future__ import annotations

from pydantic import BaseModel, Field


class EducationAiCompletionRequest(BaseModel):
    model: str = ""
    messages: list[dict] = Field(min_length=1)
    max_tokens: int = Field(default=4096, ge=256, le=16384)
    temperature: float = Field(default=0.35, ge=0.0, le=1.5)
    subject_code: str = ""
    topic_query: str = ""
    # OpenAI chat completions `response_format` (masalan json_schema) — ixtiyoriy.
    response_format: dict | None = None
    # Qaysi funksiya chaqiryapti ("test_generate", "case_generate" ...) —
    # sarf jadvalida funksiya bo'yicha ko'rinishi uchun. Javobga ta'sir qilmaydi.
    purpose: str = Field(default="", max_length=64)
    cache_bypass: bool = False


class EducationAiCompletionResponse(BaseModel):
    content: str
    book_references: list[dict] = []
    #: Test (2026-11-18): raqamlangan parchalar [{id: "P3", title, pages, kind}] — savoldagi `source` shu raqam.
    book_fragments: list[dict] = []


class EducationAiImageSafetyRequest(BaseModel):
    # data:image/...;base64 — brauzer 512px gacha kichraytirib yuboradi.
    images: list[str] = Field(min_length=1, max_length=8)
    # Qaysi slayd uchun (faqat jurnal uchun).
    context: str = Field(default="", max_length=200)
    # Berilsa — rasm shu mavzuni ko'rsatadimi, ham tekshiriladi (`relevant`).
    topic: str = Field(default="", max_length=300)
    # Moslik tekshiruvi uchun 256px nusxalar (`images` bilan bir tartibda) — token tejash.
    thumbs: list[str] = Field(default_factory=list, max_length=8)


class EducationAiImageSafetyResponse(BaseModel):
    # Har rasm uchun {safe, sexual, relevant?}; tartib so'rovdagidek.
    results: list[dict]


class EducationAiBookReferencesRequest(BaseModel):
    subject_code: str = Field(min_length=1, max_length=200)
    queries: list[str] = Field(min_length=1, max_length=40)
    top_k: int = Field(default=3, ge=1, le=8)


class EducationAiBookReferencesResponse(BaseModel):
    subject_code: str
    results: list[list[dict]]


class EducationAiCaseContextRequest(BaseModel):
    """Klinik keys (vaziyatli masala) uchun RAG kontekst so'rovi — kitob
    chunk'lari + PubMed/Semantic Scholar maqolalarini bitta raqamlangan
    "manba to'plami"ga yig'adi, LLM shu asosda yozadi."""

    topic: str = Field(min_length=2, max_length=500)
    subject_code: str = ""
    language: str = "uz"
    #: Bemorsiz tibbiy-nazariy fanlar (gigiyena, fiziologiya...): fan kitoblari yetarli topilsa PubMed /
    #: Semantic Scholar qo'shilmaydi. Umumiy jurnal maqolasi keysni mavzudan chetga olib chiqardi
    #: (gigiyena keysida tish emali va ftor haqida PubMed konsensusi, 2026-10-21).
    prefer_books: bool = False


class EducationAiLectureContextRequest(BaseModel):
    """Ma'ruza (2026-10-21): avval reja, keyin HAR reja bandi uchun alohida manba."""

    topic: str = Field(min_length=2, max_length=500)
    subject_code: str = ""
    plan: list[str] = Field(default_factory=list, max_length=14)
    journals: bool = True


class EducationAiLectureContextResponse(BaseModel):
    # [{"title": reja bandi, "sources": [{"id": "K1", "type": "book", "title", "page", "text"}]}]
    sections: list[dict] = []
    # [{"id": "P1", "title", "text"}] — kafedra protokollari (majburiy manba).
    protocols: list[dict] = []
    # [{"id": "J1", "title", "journal", "year", "url", "text"}] — xalqaro jurnallar.
    journals: list[dict] = []


class EducationAiCaseContextResponse(BaseModel):
    # Har biri: {index, type: "book"|"pubmed"|"scholar", title, meta, url?, text}
    sources: list[dict] = []
    # LLM promptiga tayyor, raqamlangan manba matni (bo'sh bo'lishi mumkin).
    context_text: str = ""
