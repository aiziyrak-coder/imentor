from django.db import models


class PreparedContent(models.Model):
    KIND_LECTURE = 'lecture'
    KIND_PRESENTATION = 'presentation'
    KIND_CASE = 'case'
    KIND_TEST = 'test'
    KIND_CHOICES = (
        (KIND_LECTURE, 'Ma\'ruza'),
        (KIND_PRESENTATION, 'Taqdimot'),
        (KIND_CASE, 'Klinik holat'),
        (KIND_TEST, 'Test'),
    )

    owner_key = models.CharField(max_length=128, db_index=True)
    kind = models.CharField(max_length=32, db_index=True, choices=KIND_CHOICES)
    topic = models.CharField(max_length=255)
    topic_norm = models.CharField(max_length=255, db_index=True)
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Tayyor kontent"
        verbose_name_plural = "Tayyor kontentlar"
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['owner_key', 'kind', 'topic_norm', '-created_at']),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.kind}:{self.topic}"


class SyllabusDocument(models.Model):
    """
    Legacy: per-user syllabus (deprecated). Yangi katalog — CourseSyllabus.
    """

    owner_key = models.CharField(max_length=128, db_index=True)
    external_id = models.CharField(max_length=128)
    file_name = models.CharField(max_length=512)
    topics = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Eski syllabus hujjati"
        verbose_name_plural = "Eski syllabus hujjatlari"
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


class CourseSyllabus(models.Model):
    """
    Administrator yuklaydigan markaziy fan syllabus (barcha o'qituvchilar uchun katalog).
    """

    LANG_UZ = "uz"
    LANG_EN = "en"
    LANG_RU = "ru"
    INSTRUCTION_LANGUAGE_CHOICES = (
        (LANG_UZ, "O'zbek"),
        (LANG_EN, "Ingliz"),
        (LANG_RU, "Rus"),
    )

    subject_name = models.CharField(max_length=255, db_index=True)
    subject_code = models.CharField(max_length=64, unique=True, db_index=True)
    description = models.CharField(max_length=512, blank=True)
    instruction_language = models.CharField(
        max_length=8,
        choices=INSTRUCTION_LANGUAGE_CHOICES,
        default=LANG_UZ,
        db_index=True,
    )
    file_name = models.CharField(max_length=512)
    topics = models.JSONField(default=list)
    # Bir fan ichida bir nechta yo'nalish PDF (masalan: PI, DI, TPI)
    variants = models.JSONField(default=list, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Fan syllabus katalogi"
        verbose_name_plural = "Fan syllabus katalogi"
        ordering = ['sort_order', 'subject_name']
        indexes = [
            models.Index(fields=['is_active', 'sort_order', 'subject_name']),
        ]

    def __str__(self) -> str:
        return self.subject_name


class StaffCourseSelection(models.Model):
    """O'qituvchi tanlagan fan(lar) — shu fan mavzulari ko'rinadi."""

    owner_key = models.CharField(max_length=128, db_index=True)
    syllabus = models.ForeignKey(
        CourseSyllabus,
        on_delete=models.CASCADE,
        related_name='selections',
    )
    selected_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "O'qituvchi fan tanlovi"
        verbose_name_plural = "O'qituvchi fan tanlovlari"
        ordering = ['-selected_at']
        constraints = [
            models.UniqueConstraint(
                fields=['owner_key', 'syllabus'],
                name='core_staff_course_selection_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['owner_key', '-selected_at']),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.syllabus.subject_code}"


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
        verbose_name = "Jonli test sessiyasi"
        verbose_name_plural = "Jonli test sessiyalari"
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
        verbose_name = "Test javobi"
        verbose_name_plural = "Test javoblari"
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
        (STATUS_DRAFT, "Qoralama"),
        (STATUS_SUBMITTED, "Yuborilgan"),
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
        (DOMAIN_STARTUP, "Startap"),
        (DOMAIN_RESEARCH, "Ilmiy tadqiqot"),
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
        verbose_name = "Startap arizasi"
        verbose_name_plural = "Startap arizalari"
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["owner_key", "-updated_at"]),
            models.Index(fields=["status", "-submitted_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.title[:40]}"


class CampusBuilding(models.Model):
    """
    Universitet kampusidagi bino (oldindan kiritiladi, jadvalda tanlanadi).
    """

    name = models.CharField(max_length=255, db_index=True)
    short_code = models.CharField(max_length=64, blank=True)
    latitude = models.FloatField()
    longitude = models.FloatField()
    radius_m = models.PositiveIntegerField(default=100)
    boundary = models.JSONField(
        default=list,
        blank=True,
        help_text="Bino chegarasi: [[lat, lng], ...] kamida 3 nuqta.",
    )
    sort_order = models.PositiveSmallIntegerField(default=0)
    notes = models.CharField(max_length=512, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Kampus binosi"
        verbose_name_plural = "Kampus binolari"
        ordering = ["sort_order", "name"]
        indexes = [
            models.Index(fields=["is_active", "sort_order", "name"]),
        ]

    def __str__(self) -> str:
        return self.name

    def boundary_ring(self) -> list[tuple[float, float]]:
        from .geo import normalize_boundary

        return normalize_boundary(self.boundary)

    def contains_point(self, lat: float, lng: float) -> bool:
        from .geo import haversine_m

        return haversine_m(lat, lng, self.latitude, self.longitude) <= float(self.radius_m)


class StaffScheduleSlot(models.Model):
    """
    O'qituvchi uchun kutilgan joy va vaqt (admin belgilaydi).
    weekday: 0=Dushanba ... 6=Yakshanba (Python weekday).
    week_phase: every=har hafta; upper/lower=ISO hafta toq/juft (yuqori/pastki).
    """

    WEEK_EVERY = "every"
    WEEK_UPPER = "upper"
    WEEK_LOWER = "lower"
    WEEK_PHASE_CHOICES = [
        (WEEK_EVERY, "Har hafta"),
        (WEEK_UPPER, "Yuqori hafta (ISO toq)"),
        (WEEK_LOWER, "Pastki hafta (ISO juft)"),
    ]

    owner_key = models.CharField(max_length=128, db_index=True)
    week_phase = models.CharField(
        max_length=16,
        choices=WEEK_PHASE_CHOICES,
        default=WEEK_EVERY,
        db_index=True,
    )
    weekday = models.SmallIntegerField(db_index=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    building = models.ForeignKey(
        CampusBuilding,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="schedule_slots",
    )
    building_name = models.CharField(max_length=255)
    latitude = models.FloatField()
    longitude = models.FloatField()
    radius_m = models.PositiveIntegerField(default=100)
    title = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Xodim jadval sloti"
        verbose_name_plural = "Xodim jadval slotlari"
        ordering = ["owner_key", "week_phase", "weekday", "start_time"]
        indexes = [
            models.Index(fields=["owner_key", "weekday", "is_active"]),
            models.Index(fields=["owner_key", "week_phase", "weekday", "is_active"]),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:{self.week_phase}:{self.weekday}:{self.start_time}"

    def get_expected_point(self) -> tuple[float, float, int, str]:
        """Kutilgan nuqta: bog'langan bino (yangilanadi) yoki slotdagi snapshot."""
        if self.building_id:
            b = self.building
            return b.latitude, b.longitude, int(b.radius_m), b.name
        return self.latitude, self.longitude, int(self.radius_m), self.building_name


class StaffLocationPing(models.Model):
    """O'qituvchi telefonidan kelgan GPS ping."""

    owner_key = models.CharField(max_length=128, db_index=True)
    latitude = models.FloatField()
    longitude = models.FloatField()
    accuracy_m = models.FloatField(null=True, blank=True)
    recorded_at = models.DateTimeField(auto_now_add=True, db_index=True)
    client_ts_ms = models.BigIntegerField(null=True, blank=True)

    class Meta:
        verbose_name = "Joylashuv pingi"
        verbose_name_plural = "Joylashuv pinglari"
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
        verbose_name = "Joylashuv ogohlantirishi"
        verbose_name_plural = "Joylashuv ogohlantirishlari"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["owner_key", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.owner_key}:alert@{self.created_at}"


def _handout_topic_dir(topic_norm: str) -> str:
    import re

    slug = re.sub(r"[^\w.\-]+", "_", (topic_norm or "").strip().lower())[:80]
    return slug.strip("_") or "topic"


def handout_upload_to(instance: "TopicHandout", filename: str) -> str:
    import re

    safe = re.sub(r"[^\w.\-]", "_", filename)[:180]
    return f"handouts/{_handout_topic_dir(instance.topic_norm)}/{instance.owner_key}_{safe}"


class TopicHandout(models.Model):
    """
    Syllabus mavzusiga bog‘langan tarqatma (PDF / rasm).
    Barcha hodimlar bir mavzu bo‘yicha yuklangan materiallarni ko‘radi.
    """

    KIND_PDF = "pdf"
    KIND_IMAGE = "image"
    KIND_CHOICES = (
        (KIND_PDF, "PDF"),
        (KIND_IMAGE, "Rasm"),
    )

    owner_key = models.CharField(max_length=128, db_index=True)
    author_name = models.CharField(max_length=255, blank=True)
    topic = models.CharField(max_length=255)
    topic_norm = models.CharField(max_length=255, db_index=True)
    title = models.CharField(max_length=255, blank=True)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default=KIND_PDF)
    file = models.FileField(upload_to=handout_upload_to, max_length=512)
    file_name = models.CharField(max_length=512)
    file_size = models.PositiveIntegerField(default=0)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Mavzu tarqatmasi"
        verbose_name_plural = "Mavzu tarqatmalari"
        ordering = ["sort_order", "created_at"]
        indexes = [
            models.Index(fields=["topic_norm", "sort_order", "created_at"]),
            models.Index(fields=["owner_key", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.topic_norm}:{self.file_name}"


def presentation_upload_to(instance: "TopicPresentation", filename: str) -> str:
    import re

    safe = re.sub(r"[^\w.\-]", "_", filename)[:180]
    return f"presentations/{_handout_topic_dir(instance.topic_norm)}/{instance.owner_key}_{safe}"


class TopicPresentation(models.Model):
    """Syllabus mavzusiga bog‘langan taqdimot (PDF / PPT / PPTX)."""

    KIND_PDF = "pdf"
    KIND_PPT = "ppt"
    KIND_PPTX = "pptx"
    KIND_CHOICES = (
        (KIND_PDF, "PDF"),
        (KIND_PPT, "PPT"),
        (KIND_PPTX, "PPTX"),
    )

    owner_key = models.CharField(max_length=128, db_index=True)
    author_name = models.CharField(max_length=255, blank=True)
    topic = models.CharField(max_length=255)
    topic_norm = models.CharField(max_length=255, db_index=True)
    title = models.CharField(max_length=255, blank=True)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default=KIND_PDF)
    file = models.FileField(upload_to=presentation_upload_to, max_length=512)
    file_name = models.CharField(max_length=512)
    file_size = models.PositiveIntegerField(default=0)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Mavzu taqdimoti"
        verbose_name_plural = "Mavzu taqdimotlari"
        ordering = ["sort_order", "created_at"]
        indexes = [
            models.Index(fields=["topic_norm", "sort_order", "created_at"]),
            models.Index(fields=["owner_key", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.topic_norm}:{self.file_name}"


class DevicePairingSession(models.Model):
    """
    Hodim: kompyuter QR ↔ telefon login. GPS faqat telefondan.
    """

    STATUS_PENDING = "pending"
    STATUS_CONFIRMED = "confirmed"
    STATUS_PICKED_UP = "picked_up"
    STATUS_EXPIRED = "expired"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Kutilmoqda"),
        (STATUS_CONFIRMED, "Tasdiqlangan"),
        (STATUS_PICKED_UP, "Ulangan"),
        (STATUS_EXPIRED, "Muddati tugagan"),
    ]

    pairing_token = models.CharField(max_length=64, unique=True, db_index=True)
    desktop_secret = models.CharField(max_length=64, blank=True, db_index=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    owner_key = models.CharField(max_length=128, blank=True, db_index=True)
    role = models.CharField(max_length=16, default="hodim")
    profile_snapshot = models.JSONField(default=dict)
    access_token = models.TextField(blank=True)
    refresh_token = models.TextField(blank=True)
    expires_at = models.DateTimeField(db_index=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    picked_up_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Qurilma ulanishi"
        verbose_name_plural = "Qurilma ulanishlari"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "expires_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.pairing_token[:8]}…:{self.status}"


def staff_avatar_upload_to(instance: "StaffProfile", filename: str) -> str:
    import re

    safe = re.sub(r"[^\w.\-]", "_", filename)[:180]
    return f"avatars/{instance.owner_key}_{safe}"


class StaffProfile(models.Model):
    """Xodim profil rasmi — qurilmalar o‘rtasida sinxron."""

    owner_key = models.CharField(max_length=128, unique=True, db_index=True)
    photo = models.FileField(upload_to=staff_avatar_upload_to, max_length=512, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Xodim profili"
        verbose_name_plural = "Xodim profillari"
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return self.owner_key
