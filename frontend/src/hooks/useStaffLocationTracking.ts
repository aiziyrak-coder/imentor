import { useEffect, useRef } from 'react';
import { postStaffLocationPing } from '../utils/staffLocationApi';
import {
  dispatchStaffGeoUpdate,
  MAX_CLIENT_ACCURACY_M,
  type StaffGeoDetail,
} from '../utils/staffLocationGeo';
import { isLikelyPhoneOrSmallTablet } from '../utils/deviceDetection';
import { markGeoFailed, markGeoGranted, mayLocateAutomatically } from '../utils/geoConsent';

// Server daqiqasiga 4 ta pingni qabul qiladi. 2026-10-23 gacha telefon har 20 soniyada
// yuborardi, server esa 2/minut edi — pinglarning uchdan biri 429 bilan tashlanardi
// (48 soatda 548 ta).
function minSendIntervalMs(): number {
  return isLikelyPhoneOrSmallTablet() ? 30_000 : 45_000;
}

function watchOptions(): PositionOptions {
  const mobile = isLikelyPhoneOrSmallTablet();
  return {
    enableHighAccuracy: true,
    maximumAge: mobile ? 5_000 : 20_000,
    timeout: mobile ? 25_000 : 30_000,
  };
}

function accuracyOk(accuracy_m: number | null): boolean {
  if (accuracy_m == null || !Number.isFinite(accuracy_m)) return true;
  return accuracy_m <= MAX_CLIENT_ACCURACY_M;
}

/** Hodim telefonida fon GPS kuzatuvi. */
export function useStaffLocationTracking(
  enabled: boolean,
  options?: { silent?: boolean },
): void {
  const silent = options?.silent ?? false;
  const lastSentAt = useRef(0);
  const watchId = useRef<number | null>(null);
  const deniedNotified = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (
      !enabled ||
      !isLikelyPhoneOrSmallTablet() ||
      typeof navigator === 'undefined' ||
      !navigator.geolocation
    ) {
      return;
    }

    const minMs = minSendIntervalMs();

    const emitAndPost = async (detail: StaffGeoDetail) => {
      dispatchStaffGeoUpdate(detail);
      try {
        await postStaffLocationPing({
          latitude: detail.latitude,
          longitude: detail.longitude,
          accuracy_m: detail.accuracy_m,
          client_ts_ms: detail.recordedAt,
        });
      } catch {
        /* keyingi pingda uriniladi */
      }
    };

    const send = (pos: GeolocationPosition, force: boolean) => {
      markGeoGranted();
      const now = Date.now();
      if (!force && now - lastSentAt.current < minMs) return;

      const accuracy_m = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
      if (!accuracyOk(accuracy_m)) return;

      lastSentAt.current = now;
      void emitAndPost({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_m,
        recordedAt: now,
      });
    };

    const onErr = (err: GeolocationPositionError) => {
      markGeoFailed(err);
      if (silent) return;
      if (err.code === err.PERMISSION_DENIED && !deniedNotified.current) {
        deniedNotified.current = true;
        window.dispatchEvent(
          new CustomEvent('app:notify', {
            detail: {
              title: 'Joylashuv ruxsati kerak',
              body: 'Telefon sozlamalarida brauzer uchun joylashuvni yoqing (Safari / Chrome).',
              level: 'warning' as const,
            },
          }),
        );
      }
    };

    // Ruxsat BIR MARTA so'raladi (2026-11-12): berilmagan bo'lsa, kuzatuv oyna ochmaydi — faqat
    // "Ruxsat berish" tugmasi so'raydi. Ilgari har sahifa ochilganda va qaytganda iPhone qayta so'rardi.
    let cancelled = false;
    void mayLocateAutomatically().then((ok) => {
      if (!ok || cancelled || !mounted.current) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => send(pos, true),
        onErr,
        { ...watchOptions(), maximumAge: 0 },
      );
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => send(pos, false),
        onErr,
        watchOptions(),
      );
    });

    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || !mounted.current) return;
      void mayLocateAutomatically().then((ok) => {
        if (!ok || cancelled) return;
        navigator.geolocation.getCurrentPosition(
          (pos) => send(pos, true),
          (err) => markGeoFailed(err),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 25_000 },
        );
      });
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [enabled, silent]);
}
