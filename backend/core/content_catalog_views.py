from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .content_catalog_service import (
    catalog_item_summary,
    catalog_subjects_summary,
    filter_catalog_queryset,
    published_catalog_queryset,
)
from .models import PreparedContent
from .permissions import HasEducationRole


class ContentCatalogListView(APIView):
    """Keys va testlar bazasi — faqat 1 soatdan eski materiallar."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    def get(self, request):
        qs = filter_catalog_queryset(published_catalog_queryset(), request.query_params)
        return Response([catalog_item_summary(item) for item in qs[:500]])


class ContentCatalogDetailView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    def get(self, request, pk: int):
        item = published_catalog_queryset().filter(pk=pk).first()
        if not item:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        data = catalog_item_summary(item)
        data['payload'] = item.payload if isinstance(item.payload, dict) else {}
        return Response(data)


class ContentCatalogSubjectsView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, HasEducationRole]

    def get(self, request):
        return Response(catalog_subjects_summary())


class PublicContentCatalogListView(APIView):
    """Ochiq keys/test bazasi — ro'yxatdan o'tmasdan ko'rish (faqat e'lon qilingan)."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        qs = filter_catalog_queryset(published_catalog_queryset(), request.query_params)
        return Response([catalog_item_summary(item, include_verification=True) for item in qs[:500]])


class PublicContentCatalogDetailView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, pk: int):
        item = published_catalog_queryset().filter(pk=pk).first()
        if not item:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        data = catalog_item_summary(item, include_verification=True)
        data['payload'] = item.payload if isinstance(item.payload, dict) else {}
        data['view_only'] = True
        return Response(data)


class PublicContentCatalogSubjectsView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(catalog_subjects_summary())
