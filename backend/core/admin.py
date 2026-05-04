from django.contrib import admin

from .models import (
    LiveTestSession,
    LiveTestSubmission,
    PreparedContent,
    StaffLocationAlert,
    StaffLocationPing,
    StaffScheduleSlot,
    StartupProjectApplication,
    SyllabusDocument,
)


@admin.register(PreparedContent)
class PreparedContentAdmin(admin.ModelAdmin):
    list_display = ('id', 'owner_key', 'kind', 'topic', 'created_at')
    list_filter = ('kind',)
    search_fields = ('owner_key', 'topic', 'topic_norm')


@admin.register(SyllabusDocument)
class SyllabusDocumentAdmin(admin.ModelAdmin):
    list_display = ('id', 'owner_key', 'file_name', 'external_id', 'created_at')
    search_fields = ('owner_key', 'file_name', 'external_id')


@admin.register(LiveTestSession)
class LiveTestSessionAdmin(admin.ModelAdmin):
    list_display = ('id', 'session_key', 'owner_key', 'created_at')
    search_fields = ('session_key', 'owner_key')


@admin.register(LiveTestSubmission)
class LiveTestSubmissionAdmin(admin.ModelAdmin):
    list_display = ('id', 'session', 'last_name', 'first_name', 'submitted_at')
    search_fields = ('first_name', 'last_name', 'session__session_key')


@admin.register(StartupProjectApplication)
class StartupProjectApplicationAdmin(admin.ModelAdmin):
    list_display = ('id', 'owner_key', 'title', 'status', 'submitted_at', 'updated_at')
    list_filter = ('status',)
    search_fields = ('owner_key', 'title')


@admin.register(StaffScheduleSlot)
class StaffScheduleSlotAdmin(admin.ModelAdmin):
    list_display = ('id', 'owner_key', 'weekday', 'start_time', 'end_time', 'building_name', 'is_active')
    list_filter = ('weekday', 'is_active')
    search_fields = ('owner_key', 'building_name', 'title')


@admin.register(StaffLocationPing)
class StaffLocationPingAdmin(admin.ModelAdmin):
    list_display = ('id', 'owner_key', 'latitude', 'longitude', 'recorded_at')
    search_fields = ('owner_key',)


@admin.register(StaffLocationAlert)
class StaffLocationAlertAdmin(admin.ModelAdmin):
    list_display = ('id', 'owner_key', 'building_name', 'distance_m', 'created_at')
    search_fields = ('owner_key', 'building_name', 'message')
