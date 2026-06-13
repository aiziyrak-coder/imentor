from __future__ import annotations

import os
from pathlib import Path

from .env import env_bool, env_list, load_dotenv

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv(
    "DJANGO_SECRET_KEY",
    "CHANGE_ME_IN_PRODUCTION_very_long_random_secret_key_please_replace",
)

DEBUG = env_bool("DJANGO_DEBUG", default=True)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", default="127.0.0.1,localhost")

# Reverse proxy (nginx / Cloudflare): trust X-Forwarded-* for HTTPS and Host.
_BEHIND_PROXY = env_bool("DJANGO_BEHIND_PROXY", default=False)
USE_X_FORWARDED_HOST = _BEHIND_PROXY
USE_X_FORWARDED_PORT = _BEHIND_PROXY
SECURE_PROXY_SSL_HEADER = (
    ("HTTP_X_FORWARDED_PROTO", "https") if _BEHIND_PROXY else None
)

INSTALLED_APPS = [
    "jazzmin",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "drf_spectacular",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

_sqlite_path = os.getenv("DJANGO_SQLITE_PATH", "").strip()
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": _sqlite_path or (BASE_DIR / "db.sqlite3"),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

MEDIA_URL = os.getenv("DJANGO_MEDIA_URL", "/media/").strip() or "/media/"
if not MEDIA_URL.endswith("/"):
    MEDIA_URL += "/"
_media_root = os.getenv("DJANGO_MEDIA_ROOT", "").strip()
MEDIA_ROOT = Path(_media_root) if _media_root else (BASE_DIR / "media")

HANDOUT_MAX_BYTES = int(os.getenv("DJANGO_HANDOUT_MAX_BYTES", str(20 * 1024 * 1024)))
PRESENTATION_MAX_BYTES = int(os.getenv("DJANGO_PRESENTATION_MAX_BYTES", str(50 * 1024 * 1024)))

# Yuklangan fayllar (tarqatma, syllabus PDF) — productionda ham /media/ orqali.
DJANGO_SERVE_MEDIA = env_bool("DJANGO_SERVE_MEDIA", default=DEBUG)

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.AllowAny",
    ),
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer"
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Salomatlik AI API",
    "DESCRIPTION": "API documentation for Salomatlik AI backend",
    "VERSION": "1.0.0",
}

CORS_ALLOW_ALL_ORIGINS = env_bool("DJANGO_CORS_ALLOW_ALL_ORIGINS", default=DEBUG)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = env_list(
    "DJANGO_CORS_ALLOWED_ORIGINS",
    default="http://localhost:3000,http://127.0.0.1:3000",
)
CSRF_TRUSTED_ORIGINS = env_list(
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    default="http://localhost:3000,http://127.0.0.1:3000",
)

SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", default=not DEBUG)
# Docker / ichki healthcheck HTTP bilan ishlashi uchun
SECURE_REDIRECT_EXEMPT = [r"^/api/health/?$"]
SESSION_COOKIE_SECURE = env_bool("DJANGO_SESSION_COOKIE_SECURE", default=not DEBUG)
CSRF_COOKIE_SECURE = env_bool("DJANGO_CSRF_COOKIE_SECURE", default=not DEBUG)
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_SECURE_HSTS_SECONDS", "0" if DEBUG else "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool(
    "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS",
    default=not DEBUG,
)
SECURE_HSTS_PRELOAD = env_bool("DJANGO_SECURE_HSTS_PRELOAD", default=not DEBUG)
ALLOW_LEGACY_PREPARED_CONTENT_API = env_bool("DJANGO_ALLOW_LEGACY_PREPARED_CONTENT_API", default=DEBUG)

# DeepSeek — test, keys, ma'ruza, tarjima va boshqalar (taqdimot emas). Kalit gitga kirmaydi.
DEEPSEEK_API_KEY = (os.getenv("DEEPSEEK_API_KEY") or "").strip()
# Eski muhit fayllari (bir martalik moslik)
if not DEEPSEEK_API_KEY:
    DEEPSEEK_API_KEY = (os.getenv("ANTHROPIC_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

JAZZMIN_SETTINGS = {
    "site_title": "Salomatlik AI",
    "site_header": "Salomatlik AI",
    "site_brand": "Salomatlik AI",
    "site_logo_classes": "img-circle",
    "welcome_sign": "Boshqaruv paneliga xush kelibsiz",
    "copyright": "Salomatlik AI",
    "search_model": ["auth.User", "auth.Group"],
    "topmenu_links": [
        {"name": "Asosiy sayt", "url": "https://imentor.uz", "new_window": True},
        {"name": "API hujjatlar", "url": "/api/docs/", "new_window": True},
    ],
    "show_sidebar": True,
    "navigation_expanded": True,
    "hide_apps": [],
    "hide_models": [],
    "order_with_respect_to": ["auth", "core"],
    "icons": {
        "auth": "fas fa-users-cog",
        "auth.user": "fas fa-user",
        "auth.group": "fas fa-users",
        "core.PreparedContent": "fas fa-book",
        "core.SyllabusDocument": "fas fa-file-pdf",
        "core.LiveTestSession": "fas fa-clipboard-check",
        "core.LiveTestSubmission": "fas fa-pen",
        "core.StartupProjectApplication": "fas fa-rocket",
        "core.CampusBuilding": "fas fa-building",
        "core.StaffScheduleSlot": "fas fa-calendar-alt",
        "core.StaffLocationPing": "fas fa-map-marker-alt",
        "core.StaffLocationAlert": "fas fa-bell",
    },
    "default_icon_parents": "fas fa-folder",
    "default_icon_children": "fas fa-circle",
    "related_modal_active": True,
    "use_google_fonts_cdn": True,
    "show_ui_builder": False,
    "changeform_format": "horizontal_tabs",
    "changeform_format_overrides": {
        "auth.user": "collapsible",
        "auth.group": "vertical_tabs",
    },
    "language_chooser": False,
}

JAZZMIN_UI_TWEAKS = {
    "theme": "flatly",
    "dark_mode_theme": "darkly",
    "navbar": "navbar-white navbar-light",
    "navbar_fixed": True,
    "footer_fixed": False,
    "sidebar_fixed": True,
    "sidebar": "sidebar-dark-primary",
    "sidebar_nav_small_text": False,
    "sidebar_disable_expand": False,
    "sidebar_nav_child_indent": True,
    "sidebar_nav_compact_style": False,
    "sidebar_nav_legacy_style": False,
    "sidebar_nav_flat_style": False,
    "accent": "accent-primary",
    "brand_colour": "navbar-primary",
    "button_classes": {
        "primary": "btn-primary",
        "secondary": "btn-secondary",
        "info": "btn-info",
        "warning": "btn-warning",
        "danger": "btn-danger",
        "success": "btn-success",
    },
}
