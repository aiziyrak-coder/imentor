"""GPS ping qabul qilish va dars jadvali bo'yicha hudud tekshiruvi."""

from __future__ import annotations

from django.db.models import Q
from django.utils import timezone

from .geo import haversine_m
from .models import StaffLocationAlert, StaffLocationPing, StaffScheduleSlot
from .week_schedule import current_week_phase_code


def _slot_contains_point(slot: StaffScheduleSlot, lat: float, lng: float) -> bool:
    if slot.building_id:
        return slot.building.contains_point(lat, lng)
    return haversine_m(lat, lng, slot.latitude, slot.longitude) <= float(slot.radius_m)


def _slot_expected_center(slot: StaffScheduleSlot) -> tuple[float, float, str]:
    if slot.building_id:
        b = slot.building
        return b.latitude, b.longitude, b.name
    return slot.latitude, slot.longitude, slot.building_name


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

    slots = (
        StaffScheduleSlot.objects.filter(
            owner_key=owner_key,
            weekday=wd,
            is_active=True,
        )
        .filter(
            Q(week_phase=StaffScheduleSlot.WEEK_EVERY) | Q(week_phase=phase),
        )
        .select_related('building')
    )
    for slot in slots:
        if slot.start_time <= t <= slot.end_time:
            elat, elng, bname = _slot_expected_center(slot)
            inside = _slot_contains_point(slot, latitude, longitude)
            if not inside:
                dist = haversine_m(latitude, longitude, elat, elng)
                has_polygon = bool(
                    slot.building_id and len(slot.building.boundary_ring()) >= 3
                )
                zone_label = 'hudud' if has_polygon else f'radius {slot.building.radius_m if slot.building_id else slot.radius_m} m'
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
                            building_name=bname,
                            expected_lat=elat,
                            expected_lng=elng,
                            actual_lat=latitude,
                            actual_lng=longitude,
                            distance_m=round(dist, 2),
                            radius_m=int(slot.building.radius_m if slot.building_id else slot.radius_m),
                            slot_start=slot.start_time,
                            slot_end=slot.end_time,
                            message=(
                                f"Dars vaqtida {bname} {zone_label}idan tashqarida "
                                f"({dist:.0f} m uzoqda)."
                            ),
                        )
                    )
    return ping, alerts
