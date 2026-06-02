"""Authenticated education AI proxy — DeepSeek kaliti faqat serverda."""

from __future__ import annotations

from typing import Any

from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .deepseek_client import (
    DEEPSEEK_CHAT,
    DEEPSEEK_REASONER,
    DeepseekClientError,
    _extract_text,
    _http_post,
)
from .permissions import HasEducationRole

_ALLOWED_MODELS = {DEEPSEEK_CHAT, DEEPSEEK_REASONER}
_MAX_MESSAGES = 32
_MAX_MESSAGE_CHARS = 120_000


class EducationAiCompletionSerializer(serializers.Serializer):
    model = serializers.CharField(required=False, default=DEEPSEEK_CHAT)
    messages = serializers.ListField(child=serializers.JSONField(), allow_empty=False)
    max_tokens = serializers.IntegerField(required=False, default=4096, min_value=256, max_value=16384)
    temperature = serializers.FloatField(required=False, default=0.35, min_value=0.0, max_value=1.5)


class EducationAiCompletionResponseSerializer(serializers.Serializer):
    content = serializers.CharField()


def _clip_messages(messages: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in messages[:_MAX_MESSAGES]:
        if not isinstance(raw, dict):
            continue
        role = str(raw.get("role") or "").strip().lower()
        if role not in ("system", "user", "assistant"):
            continue
        content = raw.get("content")
        if isinstance(content, str):
            content = content[:_MAX_MESSAGE_CHARS]
        elif isinstance(content, list):
            clipped: list[Any] = []
            for part in content[:24]:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text" and isinstance(part.get("text"), str):
                    clipped.append(
                        {"type": "text", "text": part["text"][:_MAX_MESSAGE_CHARS]}
                    )
                elif part.get("type") == "image_url":
                    img = part.get("image_url")
                    if isinstance(img, dict) and isinstance(img.get("url"), str):
                        url = img["url"]
                        if url.startswith("data:image/") and len(url) <= 6_000_000:
                            clipped.append(part)
            content = clipped
        else:
            continue
        out.append({"role": role, "content": content})
    return out


class EducationAiCompletionView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    @extend_schema(
        request=EducationAiCompletionSerializer,
        responses=EducationAiCompletionResponseSerializer,
    )
    def post(self, request):
        serializer = EducationAiCompletionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        api_key = getattr(settings, "DEEPSEEK_API_KEY", "") or ""
        if not api_key.strip():
            return Response(
                {"detail": "DeepSeek API kaliti serverda sozlanmagan."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        model = (data.get("model") or DEEPSEEK_CHAT).strip()
        if model not in _ALLOWED_MODELS:
            model = DEEPSEEK_CHAT

        messages = _clip_messages(data["messages"])
        if not messages:
            return Response({"detail": "Xabarlar bo‘sh."}, status=status.HTTP_400_BAD_REQUEST)

        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": int(data.get("max_tokens") or 4096),
            "temperature": float(data.get("temperature") if data.get("temperature") is not None else 0.35),
            "stream": False,
        }

        try:
            resp = _http_post(api_key.strip(), payload, timeout_sec=180)
            content = _extract_text(resp)
        except DeepseekClientError as e:
            return Response({"detail": str(e)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response({"content": content})
