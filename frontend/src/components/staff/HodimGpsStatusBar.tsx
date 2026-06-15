import { useCallback, useEffect, useState } from 'react';
import { Loader2, MapPin, MapPinOff } from 'lucide-react';
import {
  requestOneShotStaffLocationPing,
  subscribeStaffGeoUpdate,
  type StaffGeoDetail,
} from '../../utils/staffLocationGeo';

function formatAge(ms: number): string {
  if (ms < 60_000) return 'hozirgina';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} daq oldin`;
  return `${Math.floor(ms / 3600_000)} soat oldin`;
}

/** Hodim telefonida GPS holati (companion va asosiy ilova). */
export default function HodimGpsStatusBar({ compact = false }: { compact?: boolean }) {
  const [last, setLast] = useState<StaffGeoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => subscribeStaffGeoUpdate((d) => {
    setLast(d);
    setError(null);
  }), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await requestOneShotStaffLocationPing();
    } catch (e) {
      const err = e as GeolocationPositionError & { message?: string };
      if (err?.code === 1) {
        setError('Joylashuv ruxsati berilmagan');
      } else {
        setError('GPS olinmadi — qayta urinib ko‘ring');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const age = last ? formatAge(Date.now() - last.recordedAt) : null;
  const ok = last && Date.now() - last.recordedAt < 5 * 60_000;

  return (
    <div
      className={`rounded-2xl border px-3 py-2.5 flex flex-wrap items-center gap-2 ${
        ok ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-400/40 bg-amber-500/10'
      } ${compact ? 'text-[11px]' : 'text-[12px]'}`}
    >
      {ok ? (
        <MapPin size={compact ? 14 : 16} className="text-emerald-400 shrink-0" />
      ) : (
        <MapPinOff size={compact ? 14 : 16} className="text-amber-300 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        {last ? (
          <p className="text-white/90 font-medium leading-snug">
            GPS: {age}
            {last.accuracy_m != null ? ` · ±${Math.round(last.accuracy_m)} m` : ''}
          </p>
        ) : (
          <p className="text-white/80 leading-snug">GPS hali yuborilmagan</p>
        )}
        {error ? <p className="text-amber-200 text-[11px] mt-0.5">{error}</p> : null}
        {!compact ? (
          <p className="text-white/50 text-[11px] mt-0.5 leading-snug">
            Telefon yonida turing — dars vaqtida joylashuv tekshiriladi.
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={loading}
        className="shrink-0 rounded-xl bg-white/15 px-3 py-1.5 text-[11px] font-semibold text-white active:scale-[0.98] disabled:opacity-60 flex items-center gap-1"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : null}
        Yangilash
      </button>
    </div>
  );
}
