"""Tarqatma materiallar: mavzu bo‘yicha PDF va rasm yuklash va ko‘rish."""

from __future__ import annotations

import mimetypes
import os

from django.conf import settings
from django.db.models import Max
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import TopicHandout
from .permissions import HasEducationRole, resolve_user_role
from .serializers import TopicHandoutSerializer

_ALLOWED_EXTENSIONS = frozenset(
    {
        ".pdf",
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".bmp",
        ".tif",
        ".tiff",
        ".svg",
        ".heic",
        ".heif",
    }
)
_BLOCKED_CONTENT_TYPES = frozenset(
    {
        "application/zip",
        "application/x-zip-compressed",
        "application/x-msdownload",
        "text/html",
        "application/javascript",
    }
)


def _norm_topic(topic: str) -> str:
    return (topic or "").strip().lower()


def _detect_kind(name: str, content_type: str) -> str:
    lower = name.lower()
    if lower.endswith(".pdf") or content_type == "application/pdf":
        return TopicHandout.KIND_PDF
    return TopicHandout.KIND_IMAGE


def _mime_for_handout(filename: str, kind: str) -> str:
    guessed, _ = mimetypes.guess_type(filename or "")
    if guessed:
        return guessed
    if kind == TopicHandout.KIND_PDF:
        return "application/pdf"
    return "image/jpeg"


def _validate_uploaded_file(uploaded) -> None:
    if not uploaded:
        raise serializers.ValidationError({"file": "Fayl tanlanmadi."})
    ext = os.path.splitext(uploaded.name or "")[1].lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise serializers.ValidationError(
            {"file": "Faqat PDF yoki rasm (JPG, PNG, WEBP, GIF va boshqalar) yuklash mumkin."}
        )
    ctype = (getattr(uploaded, "content_type", None) or "").split(";")[0].strip().lower()
    if ctype in _BLOCKED_CONTENT_TYPES:
        raise serializers.ValidationError({"file": "Ruxsat etilmagan fayl turi."})
    if ctype == "application/pdf" and ext != ".pdf":
        raise serializers.ValidationError({"file": "PDF kengaytmasi mos kelmadi."})
    if ctype.startswith("image/") and ext == ".pdf":
        raise serializers.ValidationError({"file": "Fayl turi va kengaytma mos kelmadi."})
    size = int(getattr(uploaded, "size", 0) or 0)
    max_bytes = int(getattr(settings, "HANDOUT_MAX_BYTES", 20 * 1024 * 1024))
    if size > max_bytes:
        raise serializers.ValidationError(
            {"file": f"Fayl hajmi {max_bytes // (1024 * 1024)} MB dan oshmasligi kerak."}
        )


class TopicHandoutUploadSerializer(serializers.Serializer):
    topic = serializers.CharField(max_length=255)
    topic_norm = serializers.CharField(max_length=255, required=False, allow_blank=True)
    title = serializers.CharField(max_length=255, required=False, allow_blank=True)
    file = serializers.FileField()

    def validate(self, attrs):
        topic = (attrs.get("topic") or "").strip()
        if len(topic) < 2:
            raise serializers.ValidationError({"topic": "Mavzu nomi juda qisqa."})
        topic_norm = (attrs.get("topic_norm") or "").strip() or _norm_topic(topic)
        if not topic_norm:
            raise serializers.ValidationError({"topic_norm": "Mavzu normallashtirilmadi."})
        attrs["topic"] = topic
        attrs["topic_norm"] = topic_norm
        _validate_uploaded_file(attrs.get("file"))
        return attrs


class TopicHandoutListCreateView(APIView):
    """GET: mavzu bo‘yicha barcha tarqatma; POST: yangi fayl."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(responses=TopicHandoutSerializer(many=True))
    def get(self, request):
        topic_norm = _norm_topic(request.query_params.get("topic_norm", ""))
        if not topic_norm:
            return Response({"detail": "topic_norm parametri kerak."}, status=400)
        qs = TopicHandout.objects.filter(topic_norm=topic_norm)
        ser = TopicHandoutSerializer(qs, many=True, context={"request": request})
        return Response(ser.data)

    @extend_schema(request=TopicHandoutUploadSerializer, responses=TopicHandoutSerializer)
    def post(self, request):
        ser = TopicHandoutUploadSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        uploaded = data["file"]
        topic_norm = data["topic_norm"]
        owner = request.user.username
        display = (
            f"{request.user.first_name} {request.user.last_name}".strip()
            or request.user.username
        )
        max_order = (
            TopicHandout.objects.filter(topic_norm=topic_norm).aggregate(m=Max("sort_order"))["m"]
            or 0
        )
        obj = TopicHandout.objects.create(
            owner_key=owner,
            author_name=display[:255],
            topic=data["topic"],
            topic_norm=topic_norm,
            title=(data.get("title") or uploaded.name or "")[:255],
            kind=_detect_kind(uploaded.name or "", getattr(uploaded, "content_type", "") or ""),
            file=uploaded,
            file_name=(uploaded.name or "file")[:512],
            file_size=int(uploaded.size or 0),
            sort_order=int(max_order) + 1,
        )
        return Response(
            TopicHandoutSerializer(obj, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class TopicHandoutFileView(APIView):
    """Autentifikatsiyali fayl oqimi — img/iframe uchun zaxira yo‘l."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    def get(self, request, pk: int):
        obj = TopicHandout.objects.filter(pk=pk).first()
        if not obj or not obj.file:
            return Response({"detail": "Topilmadi."}, status=404)
        try:
            f = obj.file.open("rb")
        except OSError:
            return Response({"detail": "Fayl diskda topilmadi."}, status=404)
        from django.http import FileResponse

        name = obj.file_name or obj.file.name
        ctype = _mime_for_handout(name, obj.kind)
        return FileResponse(f, as_attachment=False, filename=name, content_type=ctype)


class TopicHandoutDetailView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    def delete(self, request, pk: int):
        obj = TopicHandout.objects.filter(pk=pk).first()
        if not obj:
            return Response({"detail": "Topilmadi."}, status=404)
        role = resolve_user_role(request.user, request)
        if obj.owner_key != request.user.username and role != "admin":
            return Response({"detail": "Faqat yuklagan o‘qituvchi yoki admin o‘chira oladi."}, status=403)
        try:
            obj.file.delete(save=False)
        except Exception:
            pass
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
