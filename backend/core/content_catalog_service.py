"""Keys va testlar umumiy bazasi — darsdan 1 soat keyin e'lon qilinadi."""

from __future__ import annotations

from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone

from .models import PreparedContent

CATALOG_KINDS = (PreparedContent.KIND_CASE, PreparedContent.KIND_TEST)
PUBLISH_DELAY = timedelta(hours=1)


def published_catalog_queryset():
    cutoff = timezone.now() - PUBLISH_DELAY
    return PreparedContent.objects.filter(
        kind__in=CATALOG_KINDS,
        created_at__lte=cutoff,
    )


def question_count(item: PreparedContent) -> int:
    payload = item.payload if isinstance(item.payload, dict) else {}
    questions = payload.get('questions')
    return len(questions) if isinstance(questions, list) else 0


def catalog_item_summary(item: PreparedContent) -> dict:
    return {
        'id': item.id,
        'kind': item.kind,
        'topic': item.topic,
        'topic_norm': item.topic_norm,
        'subject_name': item.subject_name or '',
        'subject_code': item.subject_code or '',
        'author_display_name': item.author_display_name or item.owner_key,
        'created_at': item.created_at.isoformat(),
        'question_count': question_count(item),
    }


def filter_catalog_queryset(qs, params) -> object:
    kind = (params.get('kind') or '').strip()
    if kind in CATALOG_KINDS:
        qs = qs.filter(kind=kind)

    subject_code = (params.get('subject_code') or '').strip()
    if subject_code:
        qs = qs.filter(subject_code=subject_code)

    q = (params.get('q') or '').strip()
    if q:
        qs = qs.filter(
            Q(topic__icontains=q)
            | Q(subject_name__icontains=q)
            | Q(author_display_name__icontains=q)
            | Q(topic_norm__icontains=q)
        )

    author = (params.get('author') or '').strip()
    if author:
        qs = qs.filter(author_display_name__icontains=author)

    sort = (params.get('sort') or 'subject').strip()
    if sort == 'newest':
        return qs.order_by('-created_at')
    if sort == 'topic':
        return qs.order_by('subject_name', 'topic', '-created_at')
    return qs.order_by('subject_name', 'topic_norm', '-created_at')


def catalog_subjects_summary():
    cutoff = timezone.now() - PUBLISH_DELAY
    rows = (
        PreparedContent.objects.filter(
            kind__in=CATALOG_KINDS,
            created_at__lte=cutoff,
        )
        .exclude(subject_name='')
        .values('subject_code', 'subject_name')
        .annotate(
            case_count=Count('id', filter=Q(kind=PreparedContent.KIND_CASE)),
            test_count=Count('id', filter=Q(kind=PreparedContent.KIND_TEST)),
        )
        .order_by('subject_name')
    )
    return [
        {
            'subject_code': r['subject_code'] or '',
            'subject_name': r['subject_name'] or '',
            'case_count': r['case_count'],
            'test_count': r['test_count'],
            'total_count': r['case_count'] + r['test_count'],
        }
        for r in rows
    ]
