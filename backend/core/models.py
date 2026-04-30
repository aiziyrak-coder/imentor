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
