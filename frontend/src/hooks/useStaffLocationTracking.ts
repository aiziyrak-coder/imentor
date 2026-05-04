import { useEffect, useRef } from 'react';
import { postStaffLocationPing } from '../utils/staffLocationApi';

const MIN_SEND_INTERVAL_MS = 90_000;
const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 60_000,
  timeout: 25_000,
};

/**
 * Hodim sessiyasida brauzer orqali GPS ping yuborish.
 * Brauzer yopilganda yoki fonda GPS to‘xtashi mumkin — bu veb cheklovi.
 */
export function useStaffLocationTracking(enabled: boolean): void {
  const lastSentAt = useRef(0);
  const watchId = useRef<number | null>(null);
  const deniedNotified = useRef(false);

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) {
      return;
    }

    const send = (pos: GeolocationPosition) => {
      const now = Date.now();
      if (now - lastSentAt.current < MIN_SEND_INTERVAL_MS) return;
      lastSentAt.current = now;
      void postStaffLocationPing({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        client_ts_ms: now,
      }).catch(() => {
        /* network — silent retry on next tick */
      });
    };

    const onErr = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED && !deniedNotified.current) {
        deniedNotified.current = true;
        window.dispatchEvent(
          new CustomEvent('app:notify', {
            detail: {
              title: 'GPS ruxsati',
              body: "Joylashuv tekshiruvi uchun brauzerda joylashuv ruxsatini bering. Sozlamalarda GPS o‘chirilgan bo‘lsa, uni yoqing.",
              level: 'warning' as const,
            },
          })
        );
      }
    };

    watchId.current = navigator.geolocation.watchPosition(send, onErr, WATCH_OPTIONS);

    return () => {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [enabled]);
}
