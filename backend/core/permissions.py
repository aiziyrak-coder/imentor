from __future__ import annotations

from rest_framework.permissions import BasePermission

ALLOWED_ROLES = ("admin", "hodim", "tarjimon", "startuper")


def resolve_user_role(user) -> str | None:
    if not user or not user.is_authenticated:
        return None
    if getattr(user, "is_superuser", False):
        return "admin"

    group_names = {group.name.lower() for group in user.groups.all()}
    for role in ALLOWED_ROLES:
        if role in group_names:
            return role
    return None


class HasEducationRole(BasePermission):
    """
    Allow only users with one of project roles:
    admin, hodim, tarjimon, startuper.
    """

    message = "You do not have a permitted role for this endpoint."

    def has_permission(self, request, view) -> bool:
        return resolve_user_role(request.user) is not None


class IsAdminRole(BasePermission):
    message = "Administrator huquqi kerak."

    def has_permission(self, request, view) -> bool:
        return resolve_user_role(request.user) == "admin"


class IsStartuperOrAdmin(BasePermission):
    message = "Startuper yoki administrator huquqi kerak."

    def has_permission(self, request, view) -> bool:
        return resolve_user_role(request.user) in ("startuper", "admin")
