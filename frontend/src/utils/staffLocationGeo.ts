import { postStaffLocationPing } from './staffLocationApi';

/** Hodim joylashuvi yangilanganda (xarita va UI uchun) */
export const STAFF_GEO_UPDATE_EVENT = 'app:staff-geo-update';

export type StaffGeoDetail = {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  recordedAt: number;
};

export function dispatchStaffGeoUpdate(detail: StaffGeoDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STAFF_GEO_UPDATE_EVENT, { detail }));
}

/** WGS84 — masofa metrlarda (backend haversine bilan mos). */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export type NearestBuildingMatch = {
  building: { id: number; name: string; latitude: number; longitude: number; radius_m: number };
  distance_m: number;
  inside: boolean;
};

/** Eng yaqin kampus binosi (ichida/yo'q). */
export function matchNearestBuilding(
  lat: number,
  lng: number,
  buildings: Array<{ id: number; name: string; latitude: number; longitude: number; radius_m: number; is_active?: boolean }>,
): NearestBuildingMatch | null {
  let best: NearestBuildingMatch | null = null;
  for (const b of buildings) {
    if (b.is_active === false) continue;
    const distance_m = haversineMeters(lat, lng, b.latitude, b.longitude);
    if (!best || distance_m < best.distance_m) {
      best = {
        building: b,
        distance_m,
        inside: distance_m <= b.radius_m,
      };
    }
  }
  return best;
}

/**
 * Foydalanuvchi bosishi bilan chaqiring — iOS Safari va baʼzi Android brauzerlarida
 * geolocation dialog faqat user gesture dan keyin chiqishi uchun.
 */
export function requestOneShotStaffLocationPing(): Promise<StaffGeoDetail> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('geolocation-unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const now = Date.now();
        const accuracy_m = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
        try {
          await postStaffLocationPing({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy_m,
            client_ts_ms: now,
          });
        } catch {
          /* tarmoq — baribir pozitsiyani UI ga beramiz */
        }
        const detail: StaffGeoDetail = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m,
          recordedAt: now,
        };
        dispatchStaffGeoUpdate(detail);
        resolve(detail);
      },
      (err) => reject(err),
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 28_000,
      },
    );
  });
}

export function subscribeStaffGeoUpdate(listener: (detail: StaffGeoDetail) => void): () => void {
  const handler = (ev: Event) => {
    const ce = ev as CustomEvent<StaffGeoDetail>;
    if (ce.detail) listener(ce.detail);
  };
  window.addEventListener(STAFF_GEO_UPDATE_EVENT, handler);
  return () => window.removeEventListener(STAFF_GEO_UPDATE_EVENT, handler);
}
