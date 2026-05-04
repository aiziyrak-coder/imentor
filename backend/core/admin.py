from django.contrib import admin

from .models import PreparedContent, SyllabusDocument


@admin.register(PreparedContent)
class PreparedContentAdmin(admin.ModelAdmin):
    list_display = ('id', 'owner_key', 'kind', 'topic', 'created_at')
    list_filter = ('kind',)
    search_fields = ('owner_key', 'topic', 'topic_norm')


@admin.register(SyllabusDocument)
class SyllabusDocumentAdmin(admin.ModelAdmin):
    list_display = ('id', 'owner_key', 'file_name', 'external_id', 'created_at')
    search_fields = ('owner_key', 'file_name', 'external_id')
