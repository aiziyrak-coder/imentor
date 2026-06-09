from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403,F401

DEBUG = False

# Docker volume + nginx proxy: backend /media/ fayllarni beradi.
DJANGO_SERVE_MEDIA = env_bool("DJANGO_SERVE_MEDIA", default=True)  # noqa: F405

def _secret_key_is_insecure(key: str) -> bool:
    k = (key or "").strip()
    if len(k) < 40:
        return True
    low = k.lower()
    insecure_starts = (
        "change_me",
        "change-me",
        "changeme",
        "django-insecure",
        "please_replace",
        "replace_with",
        "your-secret",
    )
    return any(low.startswith(p) for p in insecure_starts)


if _secret_key_is_insecure(SECRET_KEY):  # noqa: F405
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY in deploy/.env.production must be at least 40 random characters "
        "(not the example placeholder). Generate: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    )
