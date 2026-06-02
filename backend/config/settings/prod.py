from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403,F401

DEBUG = False

_INSECURE_SECRET_PREFIXES = (
    "CHANGE_ME",
    "django-insecure",
    "please_replace",
)
if not SECRET_KEY or len(SECRET_KEY) < 50:  # noqa: F405
    raise ImproperlyConfigured(
        "Production requires DJANGO_SECRET_KEY (min 50 chars). Set in deploy/.env.production."
    )
if any(SECRET_KEY.startswith(p) for p in _INSECURE_SECRET_PREFIXES):  # noqa: F405
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY is still a placeholder. Generate a unique secret for production."
    )
