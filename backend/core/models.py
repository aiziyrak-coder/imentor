from django.db import models


class PreparedContent(models.Model):
    KIND_LECTURE = 'lecture'
    KIND_PRESENTATION = 'presentation'
    KIND_CASE = 'case'
    KIND_TEST = 'test'
    KIND_CHOICES = (
        (KIND_LECTURE, 'Lecture'),
        (KIND_PRESENTATION, 'Presentation'),
        (KIND_CASE, 'Case'),
        (KIND_TEST, 'Test'),
    )

    owner_key = models.CharField(max_length=128, db_index=True)
    kind = models.CharField(max_length=32, db_index=True, choices=KIND_CHOICES)
    topic = models.CharField(max_length=255)
    topic_norm = models.CharField(max_length=255, db_index=True)
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['owner_key', 'kind', 'topic_norm', '-created_at']),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.kind}:{self.topic}"


class SyllabusDocument(models.Model):
    """
    Syllabus PDF metadata + extracted topic list, scoped per staff user (JWT username = phone digits).
    """

    owner_key = models.CharField(max_length=128, db_index=True)
    external_id = models.CharField(max_length=128)
    file_name = models.CharField(max_length=512)
    topics = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['owner_key', 'external_id'],
                name='core_syllabus_owner_external_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['owner_key', '-created_at']),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.file_name}"


class LiveTestSession(models.Model):
    """
    Teacher-published live quiz for QR access; payload holds topic + questions (JSON).
    Students fetch by session_key without auth; teacher owns via owner_key (JWT username).
    """

    session_key = models.CharField(max_length=160, unique=True, db_index=True)
    owner_key = models.CharField(max_length=128, db_index=True)
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return self.session_key


class LiveTestSubmission(models.Model):
    session = models.ForeignKey(LiveTestSession, on_delete=models.CASCADE, related_name='submissions')
    first_name = models.CharField(max_length=128)
    last_name = models.CharField(max_length=128)
    answers = models.JSONField()
    submitted_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-submitted_at']

    def __str__(self) -> str:
        return f"{self.session.session_key}:{self.last_name}"


class StartupProjectApplication(models.Model):
    """
    Startuper / innovatsiya loyihasi: loyiha tavsifi, AI tahlil, administratorga yuborish.
    """

    STATUS_DRAFT = "draft"
    STATUS_SUBMITTED = "submitted"
    STATUS_CHOICES = (
        (STATUS_DRAFT, "Draft"),
        (STATUS_SUBMITTED, "Submitted"),
    )

    PARTICIPANT_STUDENT = "student"
    PARTICIPANT_EMPLOYEE = "employee"

    owner_key = models.CharField(max_length=128, db_index=True)
    title = models.CharField(max_length=512)
    summary = models.TextField(blank=True)
    description = models.TextField(blank=True)
    participant_kind = models.CharField(max_length=16, default=PARTICIPANT_STUDENT)

    DOMAIN_STARTUP = "startup"
    DOMAIN_RESEARCH = "research"
    DOMAIN_CHOICES = (
        (DOMAIN_STARTUP, "Startup"),
        (DOMAIN_RESEARCH, "Research"),
    )
    project_domain = models.CharField(
        max_length=20,
        default=DOMAIN_STARTUP,
        db_index=True,
    )
    workspace_profile = models.JSONField(default=dict)

    profile_snapshot = models.JSONField(default=dict)
    ai_pack = models.JSONField(default=dict)
    submission_dossier = models.JSONField(default=dict)
    status = models.CharField(max_length=16, default=STATUS_DRAFT, db_index=True)
    submitted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["owner_key", "-updated_at"]),
            models.Index(fields=["status", "-submitted_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.title[:40]}"


class StaffScheduleSlot(models.Model):
    """
    O'qituvchi uchun kutilgan joy va vaqt (admin belgilaydi).
    weekday: 0=Dushanba ... 6=Yakshanba (Python weekday).
    """

    owner_key = models.CharField(max_length=128, db_index=True)
    weekday = models.SmallIntegerField(db_index=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    building_name = models.CharField(max_length=255)
    latitude = models.FloatField()
    longitude = models.FloatField()
    radius_m = models.PositiveIntegerField(default=1000)
    title = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["owner_key", "weekday", "start_time"]
        indexes = [
            models.Index(fields=["owner_key", "weekday", "is_active"]),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.weekday}:{self.start_time}"


class StaffLocationPing(models.Model):
    """O'qituvchi telefonidan kelgan GPS ping."""

    owner_key = models.CharField(max_length=128, db_index=True)
    latitude = models.FloatField()
    longitude = models.FloatField()
    accuracy_m = models.FloatField(null=True, blank=True)
    recorded_at = models.DateTimeField(auto_now_add=True, db_index=True)
    client_ts_ms = models.BigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-recorded_at"]
        indexes = [
            models.Index(fields=["owner_key", "-recorded_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}@{self.recorded_at}"


class StaffLocationAlert(models.Model):
    """
    Dars oynasida radiusdan tashqarida aniqlangan holat (bir slot kuniga cheklangan takror).
    """

    owner_key = models.CharField(max_length=128, db_index=True)
    slot = models.ForeignKey(
        StaffScheduleSlot,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="alerts",
    )
    building_name = models.CharField(max_length=255, blank=True)
    expected_lat = models.FloatField()
    expected_lng = models.FloatField()
    actual_lat = models.FloatField()
    actual_lng = models.FloatField()
    distance_m = models.FloatField()
    radius_m = models.PositiveIntegerField()
    slot_start = models.TimeField(null=True, blank=True)
    slot_end = models.TimeField(null=True, blank=True)
    message = models.CharField(max_length=512, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["owner_key", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:alert@{self.created_at}"
