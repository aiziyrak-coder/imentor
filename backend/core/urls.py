from django.urls import path

from .views import (
    AuthMeView,
    HealthView,
    LiveTestPublicRetrieveView,
    LiveTestSubmissionView,
    LiveTestUpsertView,
    LocalLoginView,
    PreparedContentV1View,
    PreparedContentView,
    SyllabusDocumentDestroyView,
    SyllabusDocumentListCreateView,
)

urlpatterns = [
    path('health/', HealthView.as_view(), name='health'),
    path('prepared-content/', PreparedContentView.as_view(), name='prepared-content'),
    path('v1/prepared-content/', PreparedContentV1View.as_view(), name='prepared-content-v1'),
    path('v1/syllabuses/', SyllabusDocumentListCreateView.as_view(), name='syllabuses'),
    path('v1/syllabuses/<int:pk>/', SyllabusDocumentDestroyView.as_view(), name='syllabus-detail'),
    path('v1/live-tests/', LiveTestUpsertView.as_view(), name='live-tests-upsert'),
    path('v1/live-tests/<str:session_key>/', LiveTestPublicRetrieveView.as_view(), name='live-tests-public'),
    path('v1/live-tests/<str:session_key>/submissions/', LiveTestSubmissionView.as_view(), name='live-tests-submissions'),
    path('v1/auth/me/', AuthMeView.as_view(), name='auth-me'),
    path('v1/auth/local-login/', LocalLoginView.as_view(), name='auth-local-login'),
]
