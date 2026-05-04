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
