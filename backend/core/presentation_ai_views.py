"""Taqdimot AI — faqat OpenAI (DeepSeek boshqa vazifalar uchun)."""

from __future__ import annotations

from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .openai_client import OPENAI_PRESENTATION_MODEL, OpenAIClientError
from .permissions import HasEducationRole
from .presentation_ai_service import (
    generate_presentation_deck,
    generate_presentation_from_text,
)


class PresentationGenerateSerializer(serializers.Serializer):
    topic = serializers.CharField(max_length=500)
    context = serializers.CharField(required=False, allow_blank=True, default="")
    slide_count = serializers.IntegerField(required=False, default=12, min_value=8, max_value=24)
    language = serializers.ChoiceField(choices=["uz", "ru", "en"], default="uz")


class PresentationFromTextSerializer(serializers.Serializer):
    topic = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    source_text = serializers.CharField(max_length=120_000)
    slide_count = serializers.IntegerField(required=False, default=12, min_value=8, max_value=24)
    language = serializers.ChoiceField(choices=["uz", "ru", "en"], default="uz")


class PresentationGenerateResponseSerializer(serializers.Serializer):
    slides = serializers.ListField(child=serializers.JSONField())
    provider = serializers.CharField()
    model = serializers.CharField()


def _openai_key() -> str:
    return (getattr(settings, "OPENAI_API_KEY", "") or "").strip()


def _presentation_model() -> str:
    return (getattr(settings, "OPENAI_PRESENTATION_MODEL", "") or OPENAI_PRESENTATION_MODEL).strip()


class PresentationAiGenerateView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    @extend_schema(
        request=PresentationGenerateSerializer,
        responses=PresentationGenerateResponseSerializer,
    )
    def post(self, request):
        api_key = _openai_key()
        if not api_key:
            return Response(
                {"detail": "OpenAI API kaliti serverda sozlanmagan (taqdimot uchun)."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        ser = PresentationGenerateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        model = _presentation_model()

        try:
            slides = generate_presentation_deck(
                api_key,
                topic=data["topic"].strip(),
                context=(data.get("context") or "").strip(),
                count=int(data.get("slide_count") or 12),
                language=data.get("language") or "uz",
                model=model,
            )
        except OpenAIClientError as e:
            return Response({"detail": str(e)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response({"slides": slides, "provider": "openai", "model": model})


class PresentationAiFromTextView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    @extend_schema(
        request=PresentationFromTextSerializer,
        responses=PresentationGenerateResponseSerializer,
    )
    def post(self, request):
        api_key = _openai_key()
        if not api_key:
            return Response(
                {"detail": "OpenAI API kaliti serverda sozlanmagan (taqdimot uchun)."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        ser = PresentationFromTextSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        model = _presentation_model()

        try:
            slides = generate_presentation_from_text(
                api_key,
                source_text=data["source_text"],
                topic_hint=(data.get("topic") or "").strip(),
                count=int(data.get("slide_count") or 12),
                language=data.get("language") or "uz",
                model=model,
            )
        except OpenAIClientError as e:
            return Response({"detail": str(e)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response({"slides": slides, "provider": "openai", "model": model})
