import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, MapPin } from 'lucide-react';
import {
  getMyStaffSchedule,
  getScheduleWeekInfo,
  type ScheduleWeekInfoDto,
  type StaffScheduleSlotDto,
  type WeekPhase,
} from '../../utils/staffLocationApi';

const WEEKDAYS: string[] = [
  'Dushanba',
  'Seshanba',
  'Chorshanba',
  'Payshanba',
  'Juma',
  'Shanba',
  'Yakshanba',
];

const PHASE_LABEL: Record<WeekPhase, string> = {
  every: 'Har hafta',
  upper: 'Yuqori hafta',
  lower: 'Pastki hafta',
};

function formatTime(s: string): string {
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function phaseOf(r: StaffScheduleSlotDto): WeekPhase {
  return r.week_phase ?? 'every';
}

export default function StaffLocationPage() {
  const [rows, setRows] = useState<StaffScheduleSlotDto[]>([]);
  const [weekInfo, setWeekInfo] = useState<ScheduleWeekInfoDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const order: WeekPhase[] = ['every', 'upper', 'lower'];
    const m: Partial<Record<WeekPhase, StaffScheduleSlotDto[]>> = {};
    for (const r of rows) {
      const p = phaseOf(r);
      if (!m[p]) m[p] = [];
      m[p]!.push(r);
    }
    return order.map((p) => ({ phase: p, items: m[p] ?? [] })).filter((x) => x.items.length > 0);
  }, [rows]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [list, wi] = await Promise.all([
        getMyStaffSchedule(),
        getScheduleWeekInfo().catch(() => null),
      ]);
      setRows(list);
      setWeekInfo(wi);
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

      {weekInfo ? (
        <div className="ios-glass rounded-2xl border border-sky-200/80 bg-sky-50/60 px-4 py-3 text-[13px] text-black/80 space-y-1">
          <p>
            <span className="font-semibold">ISO hafta:</span> {weekInfo.iso_week} ·{' '}
            <span className="font-semibold">Bu hafta:</span> {weekInfo.current_week_phase_label_uz}
          </p>
          <p className="text-[11px] text-black/50">
            «Yuqori/pastki» jadvalingiz bo‘lsa, faqat shu hafta bosqichiga tegishli qatorlar GPS tekshiruvida
            ishlatiladi.
          </p>
        </div>
      ) : null}

      <div className="ios-glass rounded-2xl border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-[13px] text-amber-950/90 flex gap-2">
        <AlertTriangle className="shrink-0 mt-0.5" size={18} />
        <div>
          <p className="font-semibold">Qanday ishlaydi</p>
          <p className="mt-1 text-black/70 leading-relaxed">
            Dars vaqtida kutilgan joy radiusidan tashqarida bo‘lsangiz, ogohlantirish yuboriladi. Brauzer ochiq
            turganida GPS yuboriladi. Dastur yopilganda veb-ilova joylashuvni to‘liq kafolatlay olmaydi.
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
        <div className="space-y-6">
          {grouped.map(({ phase, items }) => (
            <div key={phase} className="space-y-3">
              <h2 className="text-[13px] font-bold text-black/70 uppercase tracking-wide px-1">
                {PHASE_LABEL[phase]}
                {phase !== 'every' && weekInfo?.current_week_phase === phase ? (
                  <span className="ml-2 normal-case font-semibold text-emerald-700">· bu hafta faol</span>
                ) : null}
              </h2>
              <ul className="space-y-3">
                {items.map((r) => (
                  <li key={r.id} className="ios-glass rounded-2xl border border-white/70 p-4 space-y-1">
                    <div className="flex justify-between gap-2 flex-wrap">
                      <span className="text-[13px] font-bold text-black/85">
                        {WEEKDAYS[r.weekday] ?? `Hafta kuni ${r.weekday}`}
                      </span>
                      <span className="text-[12px] font-semibold text-sky-700">
                        {formatTime(r.start_time)} — {formatTime(r.end_time)}
                      </span>
                    </div>
                    <p className="text-[14px] font-medium text-black/80">
                      {r.building?.name ?? r.building_name}
                    </p>
                    {r.title ? <p className="text-[12px] text-black/50">{r.title}</p> : null}
                    {typeof r.applies_this_calendar_week === 'boolean' ? (
                      <p
                        className={`text-[11px] font-medium ${
                          r.applies_this_calendar_week ? 'text-emerald-700' : 'text-black/40'
                        }`}
                      >
                        {r.applies_this_calendar_week
                          ? 'Bu kalendar haftasida GPS tekshiruvida hisobga olinadi'
                          : 'Bu kalendar haftasida bu qator o‘tkazib yuboriladi'}
                      </p>
                    ) : null}
                    <p className="text-[11px] text-black/40">
                      Nuqta: {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)} · radius {r.radius_m} m
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
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
