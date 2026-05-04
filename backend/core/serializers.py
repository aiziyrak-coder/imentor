from collections import defaultdict

from django.utils import timezone
from rest_framework import serializers

from .models import (
    PreparedContent,
    StaffLocationAlert,
    StaffLocationPing,
    StaffScheduleSlot,
    StartupProjectApplication,
    SyllabusDocument,
)
from .week_schedule import current_week_phase_code


class LocalLoginSerializer(serializers.Serializer):
    phone_digits = serializers.CharField(max_length=20)
    password = serializers.CharField(min_length=6, max_length=128)
    role = serializers.ChoiceField(choices=["admin", "hodim", "tarjimon", "startuper"], required=False)
    first_name = serializers.CharField(max_length=128, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=128, required=False, allow_blank=True)
    display_name = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate_phone_digits(self, value: str) -> str:
        digits = "".join(ch for ch in value if ch.isdigit())
        if len(digits) != 12 or not digits.startswith("998"):
            raise serializers.ValidationError("phone_digits must be Uzbekistan 12-digit number.")
        return digits


class PreparedContentSerializer(serializers.ModelSerializer):
    def validate_owner_key(self, value: str) -> str:
        v = value.strip()
        if len(v) < 3:
            raise serializers.ValidationError('owner_key is too short.')
        return v

    def validate_topic(self, value: str) -> str:
        v = value.strip()
        if len(v) < 2:
            raise serializers.ValidationError('topic is too short.')
        return v

    def validate(self, attrs):
        topic = (attrs.get('topic') or '').strip()
        topic_norm = (attrs.get('topic_norm') or '').strip().lower()
        if not topic_norm:
            topic_norm = topic.lower()
        attrs['topic'] = topic
        attrs['topic_norm'] = topic_norm
        return attrs

    class Meta:
        model = PreparedContent
        fields = [
            'id',
            'owner_key',
            'kind',
            'topic',
            'topic_norm',
            'payload',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class SyllabusDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyllabusDocument
        fields = ['id', 'external_id', 'file_name', 'topics', 'created_at']
        read_only_fields = ['id', 'created_at']


class SyllabusUpsertSerializer(serializers.Serializer):
    external_id = serializers.CharField(max_length=128)
    file_name = serializers.CharField(max_length=512)
    topics = serializers.ListField(child=serializers.DictField(), allow_empty=True)

    def validate_external_id(self, value: str) -> str:
        v = value.strip()
        if len(v) < 4:
            raise serializers.ValidationError('external_id is too short.')
        return v

    def validate_file_name(self, value: str) -> str:
        v = value.strip()
        if len(v) < 2:
            raise serializers.ValidationError('file_name is too short.')
        return v


class LiveTestUpsertSerializer(serializers.Serializer):
    session_key = serializers.CharField(max_length=160)
    topic = serializers.CharField(max_length=1024)
    questions = serializers.ListField(child=serializers.DictField(), allow_empty=False)
    created_at_ms = serializers.IntegerField(required=False, min_value=0)


class LiveTestSubmissionCreateSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=128)
    last_name = serializers.CharField(max_length=128)
    answers = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)


class StartupProjectApplicationSerializer(serializers.ModelSerializer):
    project_domain = serializers.ChoiceField(choices=['startup', 'research'], default='startup')
    workspace_profile = serializers.JSONField(required=False, default=dict)

    class Meta:
        model = StartupProjectApplication
        fields = [
            'id',
            'owner_key',
            'title',
            'summary',
            'description',
            'participant_kind',
            'project_domain',
            'workspace_profile',
            'profile_snapshot',
            'ai_pack',
            'submission_dossier',
            'status',
            'submitted_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'owner_key', 'status', 'submitted_at', 'created_at', 'updated_at']

    def create(self, validated_data):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            raise serializers.ValidationError('Authentication required.')
        validated_data['owner_key'] = request.user.username
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if instance.status == StartupProjectApplication.STATUS_SUBMITTED and validated_data:
            raise serializers.ValidationError('Yuborilgan arizani tahrirlash mumkin emas.')
        return super().update(instance, validated_data)


class StaffScheduleSlotSerializer(serializers.ModelSerializer):
    applies_this_calendar_week = serializers.SerializerMethodField()
    week_phase_label = serializers.SerializerMethodField()

    class Meta:
        model = StaffScheduleSlot
        fields = [
            'id',
            'owner_key',
            'week_phase',
            'week_phase_label',
            'weekday',
            'start_time',
            'end_time',
            'building_name',
            'latitude',
            'longitude',
            'radius_m',
            'title',
            'is_active',
            'applies_this_calendar_week',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'week_phase_label',
            'applies_this_calendar_week',
            'created_at',
            'updated_at',
        ]

    def get_week_phase_label(self, obj: StaffScheduleSlot) -> str:
        return dict(StaffScheduleSlot.WEEK_PHASE_CHOICES).get(obj.week_phase, obj.week_phase)

    def get_applies_this_calendar_week(self, obj: StaffScheduleSlot) -> bool:
        if obj.week_phase == StaffScheduleSlot.WEEK_EVERY:
            return True
        return obj.week_phase == current_week_phase_code(timezone.localtime())


class StaffScheduleBulkRowSerializer(serializers.Serializer):
    weekday = serializers.IntegerField(min_value=0, max_value=6)
    start_time = serializers.TimeField()
    end_time = serializers.TimeField()
    building_name = serializers.CharField(max_length=255)
    latitude = serializers.FloatField()
    longitude = serializers.FloatField()
    radius_m = serializers.IntegerField(min_value=30, max_value=50_000, default=1000)
    title = serializers.CharField(max_length=255, allow_blank=True, default='')

    def validate(self, attrs):
        if attrs['start_time'] >= attrs['end_time']:
            raise serializers.ValidationError({'end_time': 'Tugash vaqti boshlanishdan keyin bo‘lishi kerak.'})
        return attrs


class StaffScheduleBulkSerializer(serializers.Serializer):
    """Bir o‘qituvchi uchun bitta hafta bosqichini to‘liq almashtirish."""

    owner_key = serializers.CharField(max_length=128)
    week_phase = serializers.ChoiceField(
        choices=[
            StaffScheduleSlot.WEEK_EVERY,
            StaffScheduleSlot.WEEK_UPPER,
            StaffScheduleSlot.WEEK_LOWER,
        ]
    )
    replace_existing = serializers.BooleanField(default=True)
    slots = StaffScheduleBulkRowSerializer(many=True)

    def validate_owner_key(self, value: str) -> str:
        digits = ''.join(ch for ch in value if ch.isdigit())
        if len(digits) != 12 or not digits.startswith('998'):
            raise serializers.ValidationError("Telefon 998 bilan 12 raqam bo‘lishi kerak.")
        return digits

    def validate_slots(self, rows):
        by_day: defaultdict[int, list] = defaultdict(list)
        for row in rows:
            by_day[row['weekday']].append((row['start_time'], row['end_time']))
        for wd, intervals in by_day.items():
            intervals.sort(key=lambda x: x[0])
            for i in range(len(intervals) - 1):
                if intervals[i][1] > intervals[i + 1][0]:
                    names = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya']
                    raise serializers.ValidationError(
                        f"{names[wd]} kunida dars vaqtlari ustma-ust tushmasligi kerak."
                    )
        return rows


class StaffLocationPingSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffLocationPing
        fields = [
            'id',
            'owner_key',
            'latitude',
            'longitude',
            'accuracy_m',
            'recorded_at',
            'client_ts_ms',
        ]
        read_only_fields = fields


class StaffLocationPingCreateSerializer(serializers.Serializer):
    latitude = serializers.FloatField()
    longitude = serializers.FloatField()
    accuracy_m = serializers.FloatField(required=False, allow_null=True)
    client_ts_ms = serializers.IntegerField(required=False, allow_null=True)


class StaffLocationAlertSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffLocationAlert
        fields = [
            'id',
            'owner_key',
            'slot',
            'building_name',
            'expected_lat',
            'expected_lng',
            'actual_lat',
            'actual_lng',
            'distance_m',
            'radius_m',
            'slot_start',
            'slot_end',
            'message',
            'created_at',
        ]
        read_only_fields = fields
