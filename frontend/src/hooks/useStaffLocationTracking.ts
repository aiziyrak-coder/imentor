import { useEffect, useRef } from 'react';
import { postStaffLocationPing } from '../utils/staffLocationApi';
import {
  dispatchStaffGeoUpdate,
  type StaffGeoDetail,
} from '../utils/staffLocationGeo';
import { isLikelyPhoneOrSmallTablet } from '../utils/deviceDetection';

/** Telefon: tezroq yangilanish; kompyuter: biroz sekinroq (batareya) */
function minSendIntervalMs(): number {
  return isLikelyPhoneOrSmallTablet() ? 18_000 : 42_000;
}

function watchOptions(): PositionOptions {
  const mobile = isLikelyPhoneOrSmallTablet();
  return {
    enableHighAccuracy: true,
    maximumAge: mobile ? 0 : 25_000,
    timeout: mobile ? 22_000 : 28_000,
  };
}

/** Hodim sessiyasida fon jarayoni (ichki eventlar). Brauzer cheklovlari mavjud. */
export function useStaffLocationTracking(enabled: boolean): void {
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
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) {
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
        /* tarmoq xatosi — keyingi pingda uriniladi */
      }
    };

    const send = (pos: GeolocationPosition, force: boolean) => {
      const now = Date.now();
      if (!force && now - lastSentAt.current < minMs) return;
      lastSentAt.current = now;
      const accuracy_m = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
      void emitAndPost({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_m,
        recordedAt: now,
      });
    };

    const onErr = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED && !deniedNotified.current) {
        deniedNotified.current = true;
        window.dispatchEvent(
          new CustomEvent('app:notify', {
            detail: {
              title: 'Ruxsat kerak',
              body: 'Ayrim funksiyalar uchun brauzer sozlamalarida ruxsatni yoqing (Safari / Chrome — sayt sozlamalari).',
              level: 'warning' as const,
            },
          }),
        );
      }
    };

    /** Dastlabki so‘rov — baʼzi Android’larda dialog shu yerda chiqadi */
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

    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || !mounted.current) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => send(pos, true),
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 22_000 },
      );
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [enabled]);
}
