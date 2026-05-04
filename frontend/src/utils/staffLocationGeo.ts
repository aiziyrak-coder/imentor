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
