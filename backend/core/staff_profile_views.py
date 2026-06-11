"""Profil rasmi: serverda saqlash va qurilmalar o‘rtasida sinxron."""

from __future__ import annotations

import os

from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import StaffProfile
from .permissions import HasEducationRole

_ALLOWED_IMAGE_EXT = frozenset({".jpg", ".jpeg", ".png", ".gif", ".webp"})
_BLOCKED_CONTENT_TYPES = frozenset(
    {
        "application/zip",
        "application/x-zip-compressed",
        "application/x-msdownload",
        "text/html",
        "application/javascript",
    }
)


def _append_cache_bust(url: str, version: int) -> str:
    if not url or version <= 0:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}v={version}"


def staff_photo_url_for_user(request, owner_key: str) -> str:
    profile = StaffProfile.objects.filter(owner_key=owner_key).first()
    if not profile or not profile.photo:
        return ""
    url = profile.photo.url
    version = int(profile.updated_at.timestamp()) if profile.updated_at else 0
    url = _append_cache_bust(url, version)
    if request:
        return request.build_absolute_uri(url)
    return url


def delete_staff_profile_for_owner(owner_key: str) -> None:
    profile = StaffProfile.objects.filter(owner_key=owner_key).first()
    if not profile:
        return
    if profile.photo:
        profile.photo.delete(save=False)
    profile.delete()


def _verify_image_magic(uploaded) -> None:
    pos = uploaded.tell() if hasattr(uploaded, "tell") else 0
    try:
        if hasattr(uploaded, "seek"):
            uploaded.seek(0)
        head = uploaded.read(16)
    finally:
        if hasattr(uploaded, "seek"):
            uploaded.seek(pos)
    if len(head) < 3:
        raise serializers.ValidationError({"file": "Fayl bo‘sh yoki buzilgan."})
    if head[:3] == b"\xff\xd8\xff":
        return
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return
    raise serializers.ValidationError({"file": "Fayl haqiqiy rasm emas."})


def _validate_avatar_file(uploaded) -> None:
    if not uploaded:
        raise serializers.ValidationError({"file": "Rasm tanlanmadi."})
    _verify_image_magic(uploaded)
    ext = os.path.splitext(uploaded.name or "")[1].lower()
    if ext not in _ALLOWED_IMAGE_EXT:
        raise serializers.ValidationError(
            {"file": "Faqat rasm (JPG, PNG, WEBP, GIF) yuklash mumkin."}
        )
    ctype = (getattr(uploaded, "content_type", None) or "").split(";")[0].strip().lower()
    if ctype in _BLOCKED_CONTENT_TYPES:
        raise serializers.ValidationError({"file": "Ruxsat etilmagan fayl turi."})
    if ctype and not ctype.startswith("image/"):
        raise serializers.ValidationError({"file": "Faqat rasm fayli qabul qilinadi."})
    max_bytes = int(getattr(settings, "STAFF_AVATAR_MAX_BYTES", 2 * 1024 * 1024))
    size = int(getattr(uploaded, "size", 0) or 0)
    if size > max_bytes:
        raise serializers.ValidationError(
            {"file": f"Rasm hajmi {max_bytes // (1024 * 1024)} MB dan oshmasligi kerak."}
        )


class StaffAvatarUploadSerializer(serializers.Serializer):
    file = serializers.FileField()


class StaffAvatarResponseSerializer(serializers.Serializer):
    photo_url = serializers.CharField(allow_blank=True)


class StaffAvatarView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request=StaffAvatarUploadSerializer, responses=StaffAvatarResponseSerializer)
    def post(self, request):
        uploaded = request.FILES.get("file")
        _validate_avatar_file(uploaded)
        owner_key = request.user.username
        profile, _ = StaffProfile.objects.get_or_create(owner_key=owner_key)
        if profile.photo:
            profile.photo.delete(save=False)
        ext = os.path.splitext(uploaded.name or "")[1].lower()
        if ext not in _ALLOWED_IMAGE_EXT:
            ext = ".jpg"
        profile.photo.save(f"{owner_key}{ext}", uploaded, save=True)
        return Response({"photo_url": staff_photo_url_for_user(request, owner_key)})

    @extend_schema(responses={204: None})
    def delete(self, request):
        profile = StaffProfile.objects.filter(owner_key=request.user.username).first()
        if profile and profile.photo:
            profile.photo.delete(save=True)
        return Response(status=status.HTTP_204_NO_CONTENT)
