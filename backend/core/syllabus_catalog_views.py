"""Markaziy fan syllabus katalogi (admin) va o'qituvchi tanlovi."""

from __future__ import annotations

import re

from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import CourseSyllabus, StaffCourseSelection
from .permissions import HasEducationRole, IsAdminRole, IsHodimRole
from .serializers import (
    CourseSyllabusSerializer,
    CourseSyllabusUpsertSerializer,
    StaffCourseSelectionSerializer,
)


def _slugify_subject(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"[-\s]+", "-", s).strip("-")
    return (s or "fan")[:64]


class AdminCourseSyllabusListCreateView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]

    @extend_schema(responses=CourseSyllabusSerializer(many=True))
    def get(self, request):
        qs = CourseSyllabus.objects.all().order_by("sort_order", "subject_name")
        return Response(CourseSyllabusSerializer(qs, many=True).data)

    @extend_schema(request=CourseSyllabusUpsertSerializer, responses=CourseSyllabusSerializer)
    def post(self, request):
        ser = CourseSyllabusUpsertSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        code = (data.get("subject_code") or "").strip() or _slugify_subject(data["subject_name"])
        base_code = code
        n = 1
        while CourseSyllabus.objects.filter(subject_code=code).exists():
            code = f"{base_code}-{n}"[:64]
            n += 1
        obj = CourseSyllabus.objects.create(
            subject_name=data["subject_name"].strip(),
            subject_code=code,
            description=(data.get("description") or "").strip()[:512],
            file_name=data["file_name"].strip(),
            topics=data["topics"],
            sort_order=int(data.get("sort_order") or 0),
            is_active=bool(data.get("is_active", True)),
        )
        return Response(CourseSyllabusSerializer(obj).data, status=status.HTTP_201_CREATED)


class AdminCourseSyllabusDetailView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]

    def _get(self, pk: int) -> CourseSyllabus | None:
        return CourseSyllabus.objects.filter(pk=pk).first()

    @extend_schema(responses=CourseSyllabusSerializer)
    def patch(self, request, pk: int):
        obj = self._get(pk)
        if not obj:
            return Response({"detail": "Topilmadi."}, status=404)
        ser = CourseSyllabusUpsertSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        if "subject_name" in data:
            obj.subject_name = data["subject_name"].strip()
        if "description" in data:
            obj.description = (data.get("description") or "").strip()[:512]
        if "file_name" in data:
            obj.file_name = data["file_name"].strip()
        if "topics" in data:
            obj.topics = data["topics"]
        if "sort_order" in data:
            obj.sort_order = int(data["sort_order"])
        if "is_active" in data:
            obj.is_active = bool(data["is_active"])
        if "subject_code" in data and data["subject_code"]:
            new_code = data["subject_code"].strip()[:64]
            if new_code != obj.subject_code and not CourseSyllabus.objects.filter(subject_code=new_code).exclude(pk=pk).exists():
                obj.subject_code = new_code
        obj.save()
        return Response(CourseSyllabusSerializer(obj).data)

    def delete(self, request, pk: int):
        obj = self._get(pk)
        if not obj:
            return Response({"detail": "Topilmadi."}, status=404)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CourseSyllabusCatalogView(APIView):
    """Barcha faol fanlar — o'qituvchi tanlash uchun."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    @extend_schema(responses=CourseSyllabusSerializer(many=True))
    def get(self, request):
        qs = CourseSyllabus.objects.filter(is_active=True).order_by("sort_order", "subject_name")
        return Response(CourseSyllabusSerializer(qs, many=True).data)


class StaffCourseSelectionListView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsHodimRole]

    @extend_schema(responses=StaffCourseSelectionSerializer(many=True))
    def get(self, request):
        qs = (
            StaffCourseSelection.objects.filter(owner_key=request.user.username)
            .select_related("syllabus")
            .order_by("-selected_at")
        )
        return Response(StaffCourseSelectionSerializer(qs, many=True).data)

    @extend_schema(
        request=serializers.Serializer,
        responses=StaffCourseSelectionSerializer,
    )
    def post(self, request):
        syllabus_id = request.data.get("syllabus_id")
        if not syllabus_id:
            return Response({"detail": "syllabus_id kerak."}, status=400)
        syllabus = CourseSyllabus.objects.filter(pk=syllabus_id, is_active=True).first()
        if not syllabus:
            return Response({"detail": "Fan topilmadi yoki faol emas."}, status=404)
        sel, _created = StaffCourseSelection.objects.get_or_create(
            owner_key=request.user.username,
            syllabus=syllabus,
        )
        return Response(
            StaffCourseSelectionSerializer(sel).data,
            status=status.HTTP_201_CREATED if _created else status.HTTP_200_OK,
        )


class StaffCourseSelectionDetailView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsHodimRole]

    def delete(self, request, syllabus_id: int):
        deleted, _ = StaffCourseSelection.objects.filter(
            owner_key=request.user.username,
            syllabus_id=syllabus_id,
        ).delete()
        if not deleted:
            return Response({"detail": "Tanlov topilmadi."}, status=404)
        return Response(status=status.HTTP_204_NO_CONTENT)
