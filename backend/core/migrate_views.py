"""One-time full DB export for server migration. Remove after migration."""

from __future__ import annotations

import base64
import io
import os
import tarfile
from pathlib import Path

from django.conf import settings
from django.core import management
from django.http import HttpResponse
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

# One-time migration token (rotate/remove endpoint after migration).
MIGRATE_TOKEN = "imentor-full-migrate-2026-06"


class MigrateFullExportView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        if request.GET.get("token") != MIGRATE_TOKEN:
            return Response({"detail": "Forbidden"}, status=403)

        out = io.StringIO()
        management.call_command(
            "dumpdata",
            "auth.user",
            "auth.group",
            "core",
            "--natural-foreign",
            "--natural-primary",
            "--indent",
            "2",
            stdout=out,
        )
        fixtures = out.getvalue()

        db_path = Path(settings.DATABASES["default"]["NAME"])
        sqlite_b64 = ""
        if db_path.is_file():
            sqlite_b64 = base64.b64encode(db_path.read_bytes()).decode("ascii")

        media_root = Path(settings.MEDIA_ROOT)
        media_tar_b64 = ""
        if media_root.is_dir() and any(media_root.iterdir()):
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w:gz") as tar:
                tar.add(str(media_root), arcname="media")
            media_tar_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

        return Response(
            {
                "fixtures": fixtures,
                "sqlite_b64": sqlite_b64,
                "sqlite_size": db_path.stat().st_size if db_path.is_file() else 0,
                "media_tar_b64": media_tar_b64,
                "media_root": str(media_root),
            }
        )

