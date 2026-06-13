from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as DjangoGroupAdmin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.models import Group, User
from django.utils.translation import gettext_lazy as _

from .forms import PhoneAdminLoginForm
from .models import (
    CampusBuilding,
    CourseSyllabus,
    DevicePairingSession,
    LiveTestSession,
    LiveTestSubmission,
    PreparedContent,
    StaffCourseSelection,
    StaffLocationAlert,
    StaffLocationPing,
    StaffProfile,
    StaffScheduleSlot,
    StartupProjectApplication,
    SyllabusDocument,
    TopicHandout,
    TopicPresentation,
)

admin.site.site_header = "Salomatlik AI — boshqaruv paneli"
admin.site.site_title = "Salomatlik AI admin"
admin.site.index_title = "Boshqaruv paneli"
admin.site.login_form = PhoneAdminLoginForm


class ReadOnlyTimestampAdmin(admin.ModelAdmin):
    readonly_fields = ("created_at", "updated_at", "recorded_at", "submitted_at", "selected_at")


@admin.register(PreparedContent)
class PreparedContentAdmin(ReadOnlyTimestampAdmin):
    list_display = ("id", "owner_key", "kind", "topic", "created_at")
    list_filter = ("kind",)
    search_fields = ("owner_key", "topic", "topic_norm")
    readonly_fields = ("created_at",)


@admin.register(SyllabusDocument)
class SyllabusDocumentAdmin(ReadOnlyTimestampAdmin):
    list_display = ("id", "owner_key", "file_name", "external_id", "created_at")
    search_fields = ("owner_key", "file_name", "external_id")
    readonly_fields = ("created_at",)


@admin.register(CourseSyllabus)
class CourseSyllabusAdmin(ReadOnlyTimestampAdmin):
    list_display = (
        "subject_name",
        "subject_code",
        "instruction_language",
        "is_active",
        "sort_order",
        "updated_at",
    )
    list_filter = ("is_active", "instruction_language")
    search_fields = ("subject_name", "subject_code", "file_name")
    readonly_fields = ("created_at", "updated_at")


@admin.register(StaffCourseSelection)
class StaffCourseSelectionAdmin(ReadOnlyTimestampAdmin):
    list_display = ("owner_key", "syllabus", "selected_at")
    search_fields = ("owner_key", "syllabus__subject_name", "syllabus__subject_code")
    list_filter = ("syllabus",)
    readonly_fields = ("selected_at",)


@admin.register(LiveTestSession)
class LiveTestSessionAdmin(ReadOnlyTimestampAdmin):
    list_display = ("id", "session_key", "owner_key", "created_at")
    search_fields = ("session_key", "owner_key")
    readonly_fields = ("created_at",)


@admin.register(LiveTestSubmission)
class LiveTestSubmissionAdmin(ReadOnlyTimestampAdmin):
    list_display = ("id", "session", "last_name", "first_name", "submitted_at")
    search_fields = ("first_name", "last_name", "session__session_key")
    readonly_fields = ("submitted_at",)


@admin.register(StartupProjectApplication)
class StartupProjectApplicationAdmin(ReadOnlyTimestampAdmin):
    list_display = ("id", "owner_key", "title", "status", "project_domain", "submitted_at", "updated_at")
    list_filter = ("status", "project_domain", "participant_kind")
    search_fields = ("owner_key", "title")
    readonly_fields = ("created_at", "updated_at", "submitted_at")


@admin.register(CampusBuilding)
class CampusBuildingAdmin(ReadOnlyTimestampAdmin):
    list_display = ("id", "name", "short_code", "is_active", "sort_order", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "short_code", "notes")
    readonly_fields = ("created_at", "updated_at")


@admin.register(StaffScheduleSlot)
class StaffScheduleSlotAdmin(ReadOnlyTimestampAdmin):
    list_display = (
        "id",
        "owner_key",
        "week_phase",
        "weekday",
        "start_time",
        "end_time",
        "building_name",
        "is_active",
    )
    list_filter = ("weekday", "week_phase", "is_active")
    search_fields = ("owner_key", "building_name", "title")
    readonly_fields = ("created_at", "updated_at")


@admin.register(StaffLocationPing)
class StaffLocationPingAdmin(ReadOnlyTimestampAdmin):
    list_display = ("id", "owner_key", "latitude", "longitude", "recorded_at")
    search_fields = ("owner_key",)
    readonly_fields = ("recorded_at",)


@admin.register(StaffLocationAlert)
class StaffLocationAlertAdmin(ReadOnlyTimestampAdmin):
    list_display = ("id", "owner_key", "building_name", "distance_m", "created_at")
    search_fields = ("owner_key", "building_name", "message")
    readonly_fields = ("created_at",)


@admin.register(TopicHandout)
class TopicHandoutAdmin(ReadOnlyTimestampAdmin):
    list_display = ("id", "topic", "owner_key", "kind", "file_name", "created_at")
    list_filter = ("kind",)
    search_fields = ("topic", "topic_norm", "owner_key", "file_name", "title")
    readonly_fields = ("created_at",)


@admin.register(TopicPresentation)
class TopicPresentationAdmin(ReadOnlyTimestampAdmin):
    list_display = ("id", "topic", "owner_key", "kind", "file_name", "created_at")
    list_filter = ("kind",)
    search_fields = ("topic", "topic_norm", "owner_key", "file_name", "title")
    readonly_fields = ("created_at",)


@admin.register(DevicePairingSession)
class DevicePairingSessionAdmin(ReadOnlyTimestampAdmin):
    list_display = ("pairing_token", "owner_key", "role", "status", "created_at", "expires_at")
    list_filter = ("status", "role")
    search_fields = ("pairing_token", "owner_key")
    readonly_fields = ("created_at",)


@admin.register(StaffProfile)
class StaffProfileAdmin(ReadOnlyTimestampAdmin):
    list_display = ("owner_key", "updated_at")
    search_fields = ("owner_key",)
    readonly_fields = ("updated_at",)


class CustomUserAdmin(DjangoUserAdmin):
    list_display = ("username", "first_name", "last_name", "email", "is_staff", "is_superuser", "last_login")
    search_fields = ("username", "first_name", "last_name", "email")


class CustomGroupAdmin(DjangoGroupAdmin):
    search_fields = ("name",)


admin.site.unregister(User)
admin.site.unregister(Group)
admin.site.register(User, CustomUserAdmin)
admin.site.register(Group, CustomGroupAdmin)

# Jazzmin qidiruv uchun
User._meta.verbose_name = _("Foydalanuvchi")
User._meta.verbose_name_plural = _("Foydalanuvchilar")
Group._meta.verbose_name = _("Guruh")
Group._meta.verbose_name_plural = _("Guruhlar")
