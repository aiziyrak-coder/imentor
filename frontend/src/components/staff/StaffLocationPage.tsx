import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, MapPin } from 'lucide-react';
import { getMyStaffSchedule, type StaffScheduleSlotDto } from '../../utils/staffLocationApi';

const WEEKDAYS: string[] = [
  'Dushanba',
  'Seshanba',
  'Chorshanba',
  'Payshanba',
  'Juma',
  'Shanba',
  'Yakshanba',
];

function formatTime(s: string): string {
  return s.length >= 5 ? s.slice(0, 5) : s;
}

export default function StaffLocationPage() {
  const [rows, setRows] = useState<StaffScheduleSlotDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await getMyStaffSchedule();
      setRows(list);
    } catch {
      setError('Jadvalni olishda xato. Tizimga qayta kiring yoki tarmoqni tekshiring.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-2xl mx-auto space-y-6 px-2 sm:px-4 pb-20">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-sky-600 text-white flex items-center justify-center">
          <MapPin size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-black/90">Joylashuv va dars jadvali</h1>
          <p className="text-[12px] text-black/50">Admin belgilagan vaqtlar va kutilgan bino</p>
        </div>
      </div>

      <div className="ios-glass rounded-2xl border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-[13px] text-amber-950/90 flex gap-2">
        <AlertTriangle className="shrink-0 mt-0.5" size={18} />
        <div>
          <p className="font-semibold">Qanday ishlaydi</p>
          <p className="mt-1 text-black/70 leading-relaxed">
            Dars vaqtida kutilgan joy atrofidagi radiusdan tashqarida bo‘lsangiz, markazga ogohlantirish yuboriladi.
            Brauzer ochiq turganida joylashuv muntazam serverga yuboriladi; GPS ruxsatini sozlamalarda yoqib qo‘ying.
            Dastur yopilganda yoki telefonda GPS o‘chirilgan bo‘lsa, veb-ilova joylashuvni to‘liq kafolatlay olmaydi.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-black/50 gap-2">
          <Loader2 className="animate-spin" size={20} />
          Yuklanmoqda…
        </div>
      ) : rows.length === 0 ? (
        <div className="ios-glass rounded-2xl border border-white/60 p-6 text-[14px] text-black/55 text-center">
          Hozircha sizga biriktirilgan dars jadvali yo‘q (administrator kiritadi).
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="ios-glass rounded-2xl border border-white/70 p-4 space-y-1"
            >
              <div className="flex justify-between gap-2 flex-wrap">
                <span className="text-[13px] font-bold text-black/85">
                  {WEEKDAYS[r.weekday] ?? `Hafta kuni ${r.weekday}`}
                </span>
                <span className="text-[12px] font-semibold text-sky-700">
                  {formatTime(r.start_time)} — {formatTime(r.end_time)}
                </span>
              </div>
              <p className="text-[14px] font-medium text-black/80">{r.building_name}</p>
              {r.title ? <p className="text-[12px] text-black/50">{r.title}</p> : null}
              <p className="text-[11px] text-black/40">
                Nuqta: {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)} · radius {r.radius_m} m
              </p>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => void load()}
        className="rounded-xl border border-black/10 bg-white/90 px-4 py-2 text-[13px] font-semibold text-black/80"
      >
        Yangilash
      </button>
    </div>
  );
}
