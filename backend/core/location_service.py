"""GPS ping qabul qilish va dars jadvali bo'yicha radius tekshiruvi."""

from __future__ import annotations

from django.db.models import Q
from django.utils import timezone

from .geo import haversine_m
from .models import StaffLocationAlert, StaffLocationPing, StaffScheduleSlot
from .week_schedule import current_week_phase_code


def record_ping_and_evaluate(
    owner_key: str,
    latitude: float,
    longitude: float,
    accuracy_m: float | None,
    client_ts_ms: int | None,
) -> tuple[StaffLocationPing, list[StaffLocationAlert]]:
    ping = StaffLocationPing.objects.create(
        owner_key=owner_key,
        latitude=latitude,
        longitude=longitude,
        accuracy_m=accuracy_m,
        client_ts_ms=client_ts_ms,
    )
    now_local = timezone.localtime()
    wd = now_local.weekday()
    t = now_local.time()
    phase = current_week_phase_code(now_local)
    alerts: list[StaffLocationAlert] = []

    slots = StaffScheduleSlot.objects.filter(
        owner_key=owner_key,
        weekday=wd,
        is_active=True,
    ).filter(
        Q(week_phase=StaffScheduleSlot.WEEK_EVERY) | Q(week_phase=phase),
    )
    for slot in slots:
        if slot.start_time <= t <= slot.end_time:
            dist = haversine_m(latitude, longitude, slot.latitude, slot.longitude)
            if dist > float(slot.radius_m):
                date_key = now_local.date()
                exists = StaffLocationAlert.objects.filter(
                    owner_key=owner_key,
                    slot_id=slot.id,
                    created_at__date=date_key,
                ).exists()
                if not exists:
                    alerts.append(
                        StaffLocationAlert.objects.create(
                            owner_key=owner_key,
                            slot=slot,
                            building_name=slot.building_name,
                            expected_lat=slot.latitude,
                            expected_lng=slot.longitude,
                            actual_lat=latitude,
                            actual_lng=longitude,
                            distance_m=round(dist, 2),
                            radius_m=slot.radius_m,
                            slot_start=slot.start_time,
                            slot_end=slot.end_time,
                            message=(
                                f"Dars vaqtida kutilgan joydan "
                                f"{dist:.0f} m uzoq ({slot.building_name}). "
                                f"Radius: {slot.radius_m} m."
                            ),
                        )
                    )
    return ping, alerts
