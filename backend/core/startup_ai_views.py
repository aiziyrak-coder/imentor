"""Authenticated REST endpoints: startup Gemini calls run on the server."""

from __future__ import annotations

import json
import re
from typing import Any

from django.conf import settings
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .gemini_client import GeminiClientError, generate_content_with_model_fallback
from .permissions import IsStartuperOrAdmin
from .startup_ai_prompts import (
    QUESTIONNAIRE_RESPONSE_SCHEMA,
    TWENTY_CRITERIA_RESPONSE_SCHEMA,
    coach_user_prompt,
    innovation_pack_user_prompt,
    language_name,
    questionnaire_user_prompt,
    twenty_criteria_user_prompt,
)

_MAX_TEXT_FIELD = 120_000


def _clip(s: str, max_len: int = _MAX_TEXT_FIELD) -> str:
    t = (s or "").strip()
    return t[:max_len]


def _parse_json_loose(text: str) -> Any:
    if not text or not str(text).strip():
        raise ValueError("Empty response from AI")
    json_string = str(text).strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", json_string)
    if m:
        json_string = m.group(1).strip()
    try:
        return json.loads(json_string)
    except json.JSONDecodeError:
        obj_start = json_string.find("{")
        arr_start = json_string.find("[")
        if obj_start == -1:
            start = arr_start
        elif arr_start == -1:
            start = obj_start
        else:
            start = min(obj_start, arr_start)
        obj_end = json_string.rfind("}")
        arr_end = json_string.rfind("]")
        end = max(obj_end, arr_end)
        if start >= 0 and end > start:
            sliced = json_string[start : end + 1]
            return json.loads(sliced)
        raise


def _gemini_key() -> str:
    return getattr(settings, "GEMINI_API_KEY", "") or ""


class StartupAiQuestionnaireView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStartuperOrAdmin]

    def post(self, request):
        key = _gemini_key()
        if not key:
            return Response(
                {"detail": "GEMINI_API_KEY serverda sozlanmagan."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        d = request.data if isinstance(request.data, dict) else {}
        lang = str(d.get("language") or "uz").strip().lower() or "uz"
        out_lang = language_name(lang)
        project_title = _clip(str(d.get("project_title") or ""), 500)
        summary = _clip(str(d.get("summary") or ""))
        full_description = _clip(str(d.get("full_description") or ""))
        structured_context_note = _clip(str(d.get("structured_context_note") or ""))
        if not project_title and not full_description:
            return Response({"detail": "project_title yoki full_description kerak."}, status=400)

        user_text = questionnaire_user_prompt(
            project_title=project_title or "Loyiha",
            summary=summary,
            full_description=full_description,
            structured_context_note=structured_context_note,
            out_lang=out_lang,
        )
        gen_cfg: dict[str, Any] = {
            "responseMimeType": "application/json",
            "maxOutputTokens": 8192,
            "temperature": 0.35,
            "responseSchema": QUESTIONNAIRE_RESPONSE_SCHEMA,
        }
        try:
            raw_text = generate_content_with_model_fallback(
                key,
                models=["gemini-1.5-flash", "gemini-2.0-flash", "gemini-3-flash-preview"],
                user_text=user_text,
                system_instruction=None,
                generation_config=gen_cfg,
            )
            parsed = _parse_json_loose(raw_text)
        except (GeminiClientError, ValueError, json.JSONDecodeError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        if not isinstance(parsed, dict):
            return Response({"detail": "Model javobi JSON obyekt emas."}, status=502)
        return Response(parsed)


class StartupAiTwentyCriteriaView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStartuperOrAdmin]

    def post(self, request):
        key = _gemini_key()
        if not key:
            return Response(
                {"detail": "GEMINI_API_KEY serverda sozlanmagan."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        d = request.data if isinstance(request.data, dict) else {}
        lang = str(d.get("language") or "uz").strip().lower() or "uz"
        out_lang = language_name(lang)
        project_title = _clip(str(d.get("project_title") or ""), 500)
        summary = _clip(str(d.get("summary") or ""))
        full_description = _clip(str(d.get("full_description") or ""))
        structured_context_note = _clip(str(d.get("structured_context_note") or ""))
        questionnaire_qa_block = _clip(str(d.get("questionnaire_qa_block") or ""))
        if not project_title and not full_description:
            return Response({"detail": "project_title yoki full_description kerak."}, status=400)

        user_text = twenty_criteria_user_prompt(
            project_title=project_title or "Loyiha",
            summary=summary,
            full_description=full_description,
            structured_context_note=structured_context_note,
            questionnaire_qa_block=questionnaire_qa_block,
            out_lang=out_lang,
        )
        gen_cfg: dict[str, Any] = {
            "responseMimeType": "application/json",
            "maxOutputTokens": 8192,
            "temperature": 0.28,
            "responseSchema": TWENTY_CRITERIA_RESPONSE_SCHEMA,
        }
        try:
            raw_text = generate_content_with_model_fallback(
                key,
                models=[
                    "gemini-1.5-pro",
                    "gemini-1.5-flash",
                    "gemini-2.0-flash",
                    "gemini-3.1-pro-preview",
                ],
                user_text=user_text,
                system_instruction=None,
                generation_config=gen_cfg,
            )
            parsed = _parse_json_loose(raw_text)
        except (GeminiClientError, ValueError, json.JSONDecodeError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        if not isinstance(parsed, dict):
            return Response({"detail": "Model javobi JSON obyekt emas."}, status=502)
        return Response(parsed)


class StartupAiInnovationPackView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStartuperOrAdmin]

    def post(self, request):
        key = _gemini_key()
        if not key:
            return Response(
                {"detail": "GEMINI_API_KEY serverda sozlanmagan."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        d = request.data if isinstance(request.data, dict) else {}
        lang = str(d.get("language") or "uz").strip().lower() or "uz"
        out_lang = language_name(lang)
        project_domain = str(d.get("project_domain") or "startup").strip().lower()
        if project_domain not in ("startup", "research"):
            project_domain = "startup"
        project_title = _clip(str(d.get("project_title") or ""), 500)
        summary = _clip(str(d.get("summary") or ""))
        full_description = _clip(str(d.get("full_description") or ""))
        profile_note = _clip(str(d.get("profile_note") or ""), 4000)
        workspace_extra_note = _clip(str(d.get("workspace_extra_note") or ""))
        if not project_title and not full_description:
            return Response({"detail": "project_title yoki full_description kerak."}, status=400)

        user_text = innovation_pack_user_prompt(
            project_title=project_title or "Loyiha",
            summary=summary,
            full_description=full_description,
            profile_note=profile_note,
            workspace_extra_note=workspace_extra_note,
            out_lang=out_lang,
            project_domain=project_domain,
        )
        gen_cfg: dict[str, Any] = {
            "responseMimeType": "application/json",
            "maxOutputTokens": 16384,
            "temperature": 0.36 if project_domain == "startup" else 0.42,
        }
        try:
            raw_text = generate_content_with_model_fallback(
                key,
                models=["gemini-3.1-pro-preview", "gemini-1.5-pro", "gemini-2.0-flash"],
                user_text=user_text,
                system_instruction=None,
                generation_config=gen_cfg,
            )
            parsed = _parse_json_loose(raw_text)
        except (GeminiClientError, ValueError, json.JSONDecodeError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        if not isinstance(parsed, dict):
            return Response({"detail": "Model javobi JSON obyekt emas."}, status=502)
        return Response(parsed)


class StartupAiCoachReplyView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStartuperOrAdmin]

    def post(self, request):
        key = _gemini_key()
        if not key:
            return Response(
                {"detail": "GEMINI_API_KEY serverda sozlanmagan."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        d = request.data if isinstance(request.data, dict) else {}
        lang = str(d.get("language") or "uz").strip().lower() or "uz"
        out_lang = language_name(lang)
        messages = d.get("messages")
        if not isinstance(messages, list) or not messages:
            return Response({"detail": "messages (ro'yxat) kerak."}, status=400)
        clean_messages: list[dict[str, str]] = []
        for m in messages[-40:]:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role") or "").strip().lower()
            content = _clip(str(m.get("content") or ""), 32000)
            if role not in ("user", "assistant") or not content:
                continue
            clean_messages.append({"role": role, "content": content})
        if not clean_messages:
            return Response({"detail": "Yaroqli messages topilmadi."}, status=400)

        ctx = d.get("ctx") if isinstance(d.get("ctx"), dict) else {}
        project_domain = str(ctx.get("project_domain") or "startup").strip().lower()
        if project_domain not in ("startup", "research"):
            project_domain = "startup"
        title = _clip(str(ctx.get("title") or ""), 500)
        summary = _clip(str(ctx.get("summary") or ""))
        description = _clip(str(ctx.get("description") or ""))
        workspace_profile_json = _clip(str(ctx.get("workspace_profile_json") or ""), 80000)
        analysis_json_excerpt = _clip(str(ctx.get("analysis_json_excerpt") or ""), 24000)

        user_text = coach_user_prompt(
            messages=clean_messages,
            project_domain=project_domain,
            title=title or "Loyiha",
            summary=summary,
            description=description,
            workspace_profile_json=workspace_profile_json or "{}",
            analysis_json_excerpt=analysis_json_excerpt,
            out_lang=out_lang,
        )
        gen_cfg: dict[str, Any] = {
            "maxOutputTokens": 4096,
            "temperature": 0.45,
        }
        try:
            raw_text = generate_content_with_model_fallback(
                key,
                models=["gemini-3-flash-preview", "gemini-2.0-flash", "gemini-1.5-flash"],
                user_text=user_text,
                system_instruction=None,
                generation_config=gen_cfg,
            )
        except GeminiClientError as e:
            return Response({"detail": str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        reply = (raw_text or "").strip()
        if not reply:
            return Response({"detail": "Empty coach reply"}, status=502)
        return Response({"reply": reply})
