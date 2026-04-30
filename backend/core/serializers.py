from rest_framework import serializers

from .models import PreparedContent


class LocalLoginSerializer(serializers.Serializer):
    phone_digits = serializers.CharField(max_length=20)
    password = serializers.CharField(min_length=6, max_length=128)
    role = serializers.ChoiceField(choices=["admin", "hodim", "tarjimon"], required=False)
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
