from django.conf import settings
from django.contrib.auth.models import Group, User
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework import serializers
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.views import APIView

from .permissions import resolve_user_role, HasEducationRole
from .models import PreparedContent, SyllabusDocument
from .serializers import (
    LocalLoginSerializer,
    PreparedContentSerializer,
    SyllabusDocumentSerializer,
    SyllabusUpsertSerializer,
)


class HealthResponseSerializer(serializers.Serializer):
    status = serializers.CharField()
    time = serializers.DateTimeField()


class AuthMeResponseSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    role = serializers.CharField(allow_null=True)


class LocalLoginResponseSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField()
    role = serializers.CharField()
    username = serializers.CharField()


class PreparedContentEmptyResponseSerializer(serializers.Serializer):
    payload = serializers.JSONField(allow_null=True)


class HealthView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses=HealthResponseSerializer)
    def get(self, request):
        return Response({'status': 'ok', 'time': timezone.now()})


class PreparedContentView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses={200: PreparedContentSerializer})
    def get(self, request):
        if not settings.ALLOW_LEGACY_PREPARED_CONTENT_API:
            return Response(
                {"detail": "Legacy prepared-content API is disabled. Use /api/v1/prepared-content/."},
                status=status.HTTP_403_FORBIDDEN,
            )
        owner_key = request.query_params.get('owner_key', '').strip()
        kind = request.query_params.get('kind', '').strip()
        topic_norm = request.query_params.get('topic_norm', '').strip()
        if not owner_key or not kind or not topic_norm:
            return Response(
                {'detail': 'owner_key, kind, topic_norm are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        item = (
            PreparedContent.objects.filter(
                owner_key=owner_key,
                kind=kind,
                topic_norm=topic_norm,
            )
            .order_by('-created_at')
            .first()
        )
        if not item:
            return Response({"payload": None}, status=status.HTTP_200_OK)
        return Response(PreparedContentSerializer(item).data)

    @extend_schema(request=PreparedContentSerializer, responses={201: PreparedContentSerializer})
    def post(self, request):
        if not settings.ALLOW_LEGACY_PREPARED_CONTENT_API:
            return Response(
                {"detail": "Legacy prepared-content API is disabled. Use /api/v1/prepared-content/."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = PreparedContentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = serializer.save()
        return Response(PreparedContentSerializer(item).data, status=status.HTTP_201_CREATED)


class PreparedContentV1View(PreparedContentView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    @extend_schema(responses={200: PreparedContentSerializer})
    def get(self, request):
        kind = request.query_params.get('kind', '').strip()
        topic_norm = request.query_params.get('topic_norm', '').strip()
        if not kind or not topic_norm:
            return Response(
                {'detail': 'kind, topic_norm are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        item = (
            PreparedContent.objects.filter(
                owner_key=request.user.username,
                kind=kind,
                topic_norm=topic_norm,
            )
            .order_by('-created_at')
            .first()
        )
        if not item:
            return Response({"payload": None}, status=status.HTTP_200_OK)
        return Response(PreparedContentSerializer(item).data)

    @extend_schema(request=PreparedContentSerializer, responses={201: PreparedContentSerializer})
    def post(self, request):
        payload = dict(request.data)
        payload["owner_key"] = request.user.username
        serializer = PreparedContentSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        item = serializer.save()
        return Response(PreparedContentSerializer(item).data, status=status.HTTP_201_CREATED)


class AuthMeView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    @extend_schema(responses=AuthMeResponseSerializer)
    def get(self, request):
        role = resolve_user_role(request.user)
        return Response(
            {
                "id": request.user.id,
                "username": request.user.username,
                "role": role,
            }
        )


class LocalLoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=LocalLoginSerializer, responses=LocalLoginResponseSerializer)
    def post(self, request):
        serializer = LocalLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        username = data["phone_digits"]
        password = data["password"]
        role = data.get("role") or "hodim"

        defaults = {
            "first_name": (data.get("first_name") or "").strip(),
            "last_name": (data.get("last_name") or "").strip(),
        }
        user, created = User.objects.get_or_create(username=username, defaults=defaults)
        if created:
            user.set_password(password)
            user.save(update_fields=["password"])
        elif not user.check_password(password):
            user.set_password(password)
            user.save(update_fields=["password"])

        group, _ = Group.objects.get_or_create(name=role)
        user.groups.clear()
        user.groups.add(group)

        refresh = RefreshToken.for_user(user)
        refresh["role"] = role
        access = refresh.access_token
        access["role"] = role

        return Response(
            {
                "access": str(access),
                "refresh": str(refresh),
                "role": role,
                "username": username,
            }
        )


class SyllabusDocumentListCreateView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    @extend_schema(responses={200: SyllabusDocumentSerializer(many=True)})
    def get(self, request):
        qs = SyllabusDocument.objects.filter(owner_key=request.user.username)
        return Response(SyllabusDocumentSerializer(qs, many=True).data)

    @extend_schema(request=SyllabusUpsertSerializer, responses={201: SyllabusDocumentSerializer})
    def post(self, request):
        serializer = SyllabusUpsertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        obj, _created = SyllabusDocument.objects.update_or_create(
            owner_key=request.user.username,
            external_id=data['external_id'],
            defaults={
                'file_name': data['file_name'],
                'topics': data['topics'],
            },
        )
        return Response(SyllabusDocumentSerializer(obj).data, status=status.HTTP_201_CREATED)


class SyllabusDocumentDestroyView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    def delete(self, request, pk: int):
        try:
            obj = SyllabusDocument.objects.get(pk=pk, owner_key=request.user.username)
        except SyllabusDocument.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
