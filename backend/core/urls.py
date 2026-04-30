from django.urls import path

from .views import AuthMeView, HealthView, LocalLoginView, PreparedContentV1View, PreparedContentView

urlpatterns = [
    path('health/', HealthView.as_view(), name='health'),
    path('prepared-content/', PreparedContentView.as_view(), name='prepared-content'),
    path('v1/prepared-content/', PreparedContentV1View.as_view(), name='prepared-content-v1'),
    path('v1/auth/me/', AuthMeView.as_view(), name='auth-me'),
    path('v1/auth/local-login/', LocalLoginView.as_view(), name='auth-local-login'),
]
