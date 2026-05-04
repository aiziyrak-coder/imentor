import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { isLikelyPhoneOrSmallTablet } from '../../utils/deviceDetection';
import { requestOneShotStaffLocationPing } from '../../utils/staffLocationGeo';

/**
 * Mobil qurilmada hodim uchun: GPS ruxsatini foydalanuvchi bosishi bilan so‘rash (iOS/Android mos).
 */
export default function HodimGpsPromptBar() {
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!q?.query) return;
    q
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (cancelled) return;
        setPermission(status.state as 'granted' | 'denied' | 'prompt');
        status.onchange = () => setPermission(status.state as 'granted' | 'denied' | 'prompt');
      })
      .catch(() => {
        /* Safari: permissions.query(geolocation) baʼzan yo‘q */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activate = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await requestOneShotStaffLocationPing();
      setPermission('granted');
    } catch (e) {
      const err = e as GeolocationPositionError;
      if (err?.code === 1) {
        setError('Ruxsat rad etildi. Brauzer sozlamalaridan joylashuvni yoqing.');
        setPermission('denied');
      } else {
        setError('Joylashuv olinmadi. GPS yoqilganini va ochiq joyda ekaningizni tekshiring.');
      }
    } finally {
      setBusy(false);
    }
  }, []);

  if (!isLikelyPhoneOrSmallTablet()) return null;

  const needsHttps =
    typeof window !== 'undefined' && !window.isSecureContext && !/^localhost$|^127\./.test(window.location.hostname);

  return (
    <div className="ios-glass rounded-2xl border border-sky-200/90 bg-gradient-to-r from-sky-50/95 to-emerald-50/90 px-3 py-2.5 shadow-sm print:hidden">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm">
            <MapPin size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold leading-tight text-black/90">Dars joylashuvi (GPS)</p>
            <p className="text-[11px] text-black/55 leading-snug">
              Admin xaritasida real vaqtda ko‘rinish uchun ruxsat bering. iOS/Android: tugmani bosing.
            </p>
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
          {permission === 'granted' ? (
            <span className="inline-flex items-center gap-1 rounded-xl bg-emerald-100 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-900">
              <ShieldCheck size={14} />
              GPS ulangan
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void activate()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-md shadow-sky-600/25 active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <MapPin size={16} />}
              Joylashuv ruxsatini berish
            </button>
          )}
        </div>
      </div>
      {needsHttps ? (
        <p className="mt-2 text-[11px] font-semibold text-rose-800">
          GPS uchun sayt <strong>https</strong> orqali ochilishi kerak (xavfsiz ulanish).
        </p>
      ) : null}
      {error ? <p className="mt-2 text-[11px] text-rose-700">{error}</p> : null}
    </div>
  );
}
