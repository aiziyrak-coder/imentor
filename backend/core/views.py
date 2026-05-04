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

from .permissions import (
    HasEducationRole,
    IsAdminRole,
    IsStartuperOrAdmin,
    resolve_user_role,
)
from .models import (
    LiveTestSession,
    LiveTestSubmission,
    PreparedContent,
    StartupProjectApplication,
    SyllabusDocument,
)
from .serializers import (
    LocalLoginSerializer,
    LiveTestSubmissionCreateSerializer,
    LiveTestUpsertSerializer,
    PreparedContentSerializer,
    StartupProjectApplicationSerializer,
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


class LiveTestUpsertView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    def post(self, request):
        serializer = LiveTestUpsertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        key = d['session_key'].strip()
        owner = request.user.username

        existing = LiveTestSession.objects.filter(session_key=key).first()
        if existing and existing.owner_key != owner:
            return Response({'detail': 'Session key already in use.'}, status=status.HTTP_409_CONFLICT)

        created_ms = d.get('created_at_ms')
        if created_ms is None:
            created_ms = int(timezone.now().timestamp() * 1000)

        payload = {
            'topic': (d['topic'] or '').strip(),
            'questions': d['questions'],
            'createdAt': created_ms,
        }
        LiveTestSession.objects.update_or_create(
            session_key=key,
            defaults={'owner_key': owner, 'payload': payload},
        )
        return Response({'ok': True}, status=status.HTTP_200_OK)


class LiveTestPublicRetrieveView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, session_key: str):
        obj = LiveTestSession.objects.filter(session_key=session_key.strip()).first()
        if not obj:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        p = obj.payload if isinstance(obj.payload, dict) else {}
        created_ms = p.get('createdAt')
        if created_ms is None:
            created_ms = int(obj.created_at.timestamp() * 1000)
        return Response(
            {
                'topic': p.get('topic', ''),
                'questions': p.get('questions', []),
                'created_at_ms': created_ms,
            }
        )


class LiveTestSubmissionView(APIView):
    """
    GET: teacher JWT — list submissions for own session.
    POST: anonymous — student submits answers (QR flow).
    """

    def get_authenticators(self):
        req = getattr(self, 'request', None)
        if req is not None and req.method == 'POST':
            return []
        return [JWTAuthentication()]

    def get_permissions(self):
        if getattr(self, 'request') and self.request.method == 'POST':
            return [AllowAny()]
        return [IsAuthenticated(), HasEducationRole()]

    def get(self, request, session_key: str):
        obj = LiveTestSession.objects.filter(
            session_key=session_key.strip(),
            owner_key=request.user.username,
        ).first()
        if not obj:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        data = [
            {
                'first_name': s.first_name,
                'last_name': s.last_name,
                'answers': s.answers,
                'submitted_at': s.submitted_at.isoformat(),
            }
            for s in obj.submissions.all()
        ]
        return Response(data)

    def post(self, request, session_key: str):
        obj = LiveTestSession.objects.filter(session_key=session_key.strip()).first()
        if not obj:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = LiveTestSubmissionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        LiveTestSubmission.objects.create(
            session=obj,
            first_name=d['first_name'].strip(),
            last_name=d['last_name'].strip(),
            answers=list(d['answers']),
        )
        return Response({'ok': True}, status=status.HTTP_201_CREATED)


class StartupApplicationListCreateView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStartuperOrAdmin]

    def get(self, request):
        qs = StartupProjectApplication.objects.filter(owner_key=request.user.username)
        return Response(StartupProjectApplicationSerializer(qs, many=True).data)

    def post(self, request):
        serializer = StartupProjectApplicationSerializer(
            data=request.data,
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class StartupApplicationDetailView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStartuperOrAdmin]

    def _get(self, pk: int, user):
        obj = StartupProjectApplication.objects.filter(pk=pk).first()
        if not obj:
            return None
        role = resolve_user_role(user)
        if role == 'admin' or obj.owner_key == user.username:
            return obj
        return None

    def get(self, request, pk: int):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(StartupProjectApplicationSerializer(obj).data)

    def patch(self, request, pk: int):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = StartupProjectApplicationSerializer(
            obj,
            data=request.data,
            partial=True,
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(StartupProjectApplicationSerializer(obj).data)

    def delete(self, request, pk: int):
        obj = self._get(pk, request.user)
        if not obj:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if obj.status == StartupProjectApplication.STATUS_SUBMITTED and resolve_user_role(request.user) != 'admin':
            return Response({'detail': 'Yuborilgan arizani o‘chirib bo‘lmaydi.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class StartupApplicationSubmitView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsStartuperOrAdmin]

    def post(self, request, pk: int):
        obj = StartupProjectApplication.objects.filter(pk=pk, owner_key=request.user.username).first()
        if not obj:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if obj.status == StartupProjectApplication.STATUS_SUBMITTED:
            return Response({'detail': 'Allaqachon yuborilgan.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.status = StartupProjectApplication.STATUS_SUBMITTED
        obj.submitted_at = timezone.now()
        obj.save(update_fields=['status', 'submitted_at', 'updated_at'])
        return Response(StartupProjectApplicationSerializer(obj).data)


class StartupApplicationAdminInboxView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        qs = StartupProjectApplication.objects.filter(
            status=StartupProjectApplication.STATUS_SUBMITTED,
        ).order_by('-submitted_at')
        return Response(StartupProjectApplicationSerializer(qs, many=True).data)
