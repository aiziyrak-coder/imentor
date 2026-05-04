import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, Loader2, MapPin, Trash2 } from 'lucide-react';
import {
  bulkReplaceAdminStaffSchedule,
  deleteAdminStaffSchedule,
  getScheduleWeekInfo,
  HttpError,
  listAdminStaffAlerts,
  listAdminStaffPings,
  listAdminStaffSchedule,
  patchAdminStaffSchedule,
  type BulkScheduleSlotPayload,
  type ScheduleWeekInfoDto,
  type StaffLocationAlertDto,
  type StaffLocationPingDto,
  type StaffScheduleSlotDto,
  type WeekPhase,
} from '../../utils/staffLocationApi';

const WEEKDAYS: { v: number; l: string }[] = [
  { v: 0, l: 'Dushanba' },
  { v: 1, l: 'Seshanba' },
  { v: 2, l: 'Chorshanba' },
  { v: 3, l: 'Payshanba' },
  { v: 4, l: 'Juma' },
  { v: 5, l: 'Shanba' },
  { v: 6, l: 'Yakshanba' },
];

const PHASE_ORDER: WeekPhase[] = ['every', 'upper', 'lower'];
const PHASE_LABEL: Record<WeekPhase, string> = {
  every: 'Har hafta',
  upper: 'Yuqori hafta (ISO toq)',
  lower: 'Pastki hafta (ISO juft)',
};

type Tab = 'schedule' | 'pings' | 'alerts';
type EditorMode = 'single' | 'alternating';

type DayRow = {
  enabled: boolean;
  start: string;
  end: string;
  building: string;
  title: string;
};

function emptyRow(): DayRow {
  return { enabled: false, start: '09:00', end: '10:00', building: '', title: '' };
}

function emptyGrid(): DayRow[] {
  return Array.from({ length: 7 }, () => emptyRow());
}

function toHms(t: string): string {
  return t.split(':').length === 2 ? `${t}:00` : t;
}

function validateOwnerKey(v: string): string | null {
  const d = v.replace(/\D/g, '');
  if (d.length !== 12 || !d.startsWith('998')) return "Telefon 998 bilan 12 raqam bo'lishi kerak.";
  return null;
}

function defaultWeekPhase(s: StaffScheduleSlotDto): WeekPhase {
  return s.week_phase ?? 'every';
}

function slotsToGrid(slots: StaffScheduleSlotDto[], phase: WeekPhase): DayRow[] {
  const g = emptyGrid();
  for (const s of slots) {
    if (defaultWeekPhase(s) !== phase) continue;
    g[s.weekday] = {
      enabled: true,
      start: String(s.start_time).slice(0, 5),
      end: String(s.end_time).slice(0, 5),
      building: s.building_name,
      title: s.title ?? '',
    };
  }
  return g;
}

function formatApiError(err: unknown): string {
  if (err instanceof HttpError && err.body && typeof err.body === 'object') {
    const b = err.body as Record<string, unknown>;
    if (typeof b.detail === 'string') return b.detail;
    if (Array.isArray(b.slots) && b.slots.length) return JSON.stringify(b.slots);
    const parts: string[] = [];
    for (const [k, v] of Object.entries(b)) {
      parts.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
    if (parts.length) return parts.join('; ');
  }
  if (err instanceof Error) return err.message;
  return "So'rovda xato.";
}

export default function AdminStaffLocationConsole() {
  const [tab, setTab] = useState<Tab>('schedule');
  const [filterOwner, setFilterOwner] = useState('');
  const [schedule, setSchedule] = useState<StaffScheduleSlotDto[]>([]);
  const [pings, setPings] = useState<StaffLocationPingDto[]>([]);
  const [alerts, setAlerts] = useState<StaffLocationAlertDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [weekInfo, setWeekInfo] = useState<ScheduleWeekInfoDto | null>(null);
  const [editorOwner, setEditorOwner] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('single');
  const [defLat, setDefLat] = useState('41.311151');
  const [defLng, setDefLng] = useState('69.279737');
  const [defRadius, setDefRadius] = useState(1000);
  const [gridEvery, setGridEvery] = useState<DayRow[]>(() => emptyGrid());
  const [gridUpper, setGridUpper] = useState<DayRow[]>(() => emptyGrid());
  const [gridLower, setGridLower] = useState<DayRow[]>(() => emptyGrid());

  const ownerFilterApplied = useMemo(() => filterOwner.replace(/\D/g, ''), [filterOwner]);
  const editorDigits = useMemo(() => editorOwner.replace(/\D/g, ''), [editorOwner]);

  const scheduleGrouped = useMemo(() => {
    const m: Record<string, StaffScheduleSlotDto[]> = { every: [], upper: [], lower: [] };
    for (const r of schedule) {
      const p = defaultWeekPhase(r);
      if (!m[p]) m[p] = [];
      m[p].push(r);
    }
    return m;
  }, [schedule]);

  const hasAlternatingData = useMemo(
    () => schedule.some((s) => defaultWeekPhase(s) === 'upper' || defaultWeekPhase(s) === 'lower'),
    [schedule],
  );

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const o = ownerFilterApplied.length >= 12 ? ownerFilterApplied : undefined;
      if (tab === 'schedule') {
        const [rows, wi] = await Promise.all([
          listAdminStaffSchedule(o),
          getScheduleWeekInfo().catch(() => null),
        ]);
        setSchedule(rows);
        if (wi) setWeekInfo(wi);
      } else if (tab === 'pings') {
        const rows = await listAdminStaffPings(o);
        setPings(rows);
      } else {
        const rows = await listAdminStaffAlerts(o);
        setAlerts(rows);
      }
    } catch {
      setError('Maʼlumotni olishda xato (admin huquqi va JWT).');
    } finally {
      setLoading(false);
    }
  }, [tab, ownerFilterApplied]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateGridCell = (
    which: 'every' | 'upper' | 'lower',
    dayIdx: number,
    patch: Partial<DayRow>,
  ) => {
    const upd = (prev: DayRow[]) => {
      const next = [...prev];
      next[dayIdx] = { ...next[dayIdx], ...patch };
      return next;
    };
    if (which === 'every') setGridEvery(upd);
    else if (which === 'upper') setGridUpper(upd);
    else setGridLower(upd);
  };

  const fillGridsFromTeacher = useCallback(() => {
    const err = validateOwnerKey(editorOwner);
    if (err) {
      setError(err);
      return;
    }
    const digits = editorDigits;
    const mine = schedule.filter((s) => s.owner_key === digits);
    if (mine.length === 0) {
      setError('Bu hodim uchun jadval hali yo‘q — formani qo‘lda to‘ldiring.');
      return;
    }
    const hasAlt = mine.some((s) => defaultWeekPhase(s) === 'upper' || defaultWeekPhase(s) === 'lower');
    setEditorMode(hasAlt ? 'alternating' : 'single');
    if (hasAlt) {
      setGridUpper(slotsToGrid(mine, 'upper'));
      setGridLower(slotsToGrid(mine, 'lower'));
      setGridEvery(emptyGrid());
    } else {
      setGridEvery(slotsToGrid(mine, 'every'));
      setGridUpper(emptyGrid());
      setGridLower(emptyGrid());
    }
    const first = mine[0];
    if (first) {
      setDefLat(String(first.latitude));
      setDefLng(String(first.longitude));
      setDefRadius(first.radius_m);
    }
    setError(null);
  }, [editorOwner, editorDigits, schedule]);

  const copyUpperToLower = () => {
    setGridLower(gridUpper.map((r) => ({ ...r })));
  };

  const buildPayload = (grid: DayRow[]): BulkScheduleSlotPayload[] => {
    const lat = Number(defLat);
    const lng = Number(defLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('Asosiy nuqta (lat/lng) noto‘g‘ri.');
    }
    const out: BulkScheduleSlotPayload[] = [];
    grid.forEach((row, weekday) => {
      if (!row.enabled) return;
      const b = row.building.trim();
      if (!b) throw new Error(`${WEEKDAYS[weekday]?.l ?? weekday}: bino nomi bo‘sh.`);
      out.push({
        weekday,
        start_time: toHms(row.start),
        end_time: toHms(row.end),
        building_name: b,
        latitude: lat,
        longitude: lng,
        radius_m: defRadius,
        title: row.title.trim(),
      });
    });
    return out;
  };

  const saveBulk = async (phase: WeekPhase, grid: DayRow[]) => {
    const err = validateOwnerKey(editorOwner);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const slots = buildPayload(grid);
      await bulkReplaceAdminStaffSchedule({
        owner_key: editorDigits,
        week_phase: phase,
        replace_existing: true,
        slots,
      });
      await load();
      setFilterOwner(editorDigits);
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: StaffScheduleSlotDto) => {
    try {
      await patchAdminStaffSchedule(row.id, { is_active: !row.is_active });
      await load();
    } catch {
      setError('Yangilashda xato.');
    }
  };

  const removeSlot = async (id: number) => {
    if (!window.confirm('O‘chirishni tasdiqlaysizmi?')) return;
    try {
      await deleteAdminStaffSchedule(id);
      await load();
    } catch {
      setError('O‘chirishda xato.');
    }
  };

  const renderDayEditor = (which: 'every' | 'upper' | 'lower', grid: DayRow[], phase: WeekPhase) => {
    const showPhaseBadge =
      weekInfo && (phase === 'upper' || phase === 'lower') && weekInfo.current_week_phase === phase;

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-[14px] font-bold text-black/85">{PHASE_LABEL[phase]}</h3>
          {showPhaseBadge ? (
            <span className="text-[11px] font-semibold rounded-full bg-emerald-100 text-emerald-900 px-2 py-0.5">
              Bu hafta shu variant
            </span>
          ) : null}
        </div>
        <div className="rounded-xl border border-black/10 overflow-hidden bg-white/60">
          <table className="w-full text-[12px]">
            <thead className="bg-black/[0.04] text-black/55">
              <tr>
                <th className="px-2 py-2 text-left w-10"> </th>
                <th className="px-2 py-2 text-left">Kun</th>
                <th className="px-2 py-2 text-left">Boshlanish</th>
                <th className="px-2 py-2 text-left">Tugash</th>
                <th className="px-2 py-2 text-left min-w-[120px]">Bino</th>
                <th className="px-2 py-2 text-left hidden sm:table-cell">Izoh</th>
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((wd, i) => {
                const row = grid[i];
                return (
                  <tr key={wd.v} className="border-t border-black/5 align-top">
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(e) => updateGridCell(which, i, { enabled: e.target.checked })}
                        aria-label={`${wd.l} faol`}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-medium text-black/80 whitespace-nowrap">{wd.l}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="time"
                        disabled={!row.enabled}
                        value={row.start}
                        onChange={(e) => updateGridCell(which, i, { start: e.target.value })}
                        className="w-full rounded-lg border border-black/10 px-1 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="time"
                        disabled={!row.enabled}
                        value={row.end}
                        onChange={(e) => updateGridCell(which, i, { end: e.target.value })}
                        className="w-full rounded-lg border border-black/10 px-1 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        disabled={!row.enabled}
                        value={row.building}
                        onChange={(e) => updateGridCell(which, i, { building: e.target.value })}
                        placeholder="Bino / auditoriya"
                        className="w-full rounded-lg border border-black/10 px-2 py-1 min-w-0"
                      />
                    </td>
                    <td className="px-2 py-1.5 hidden sm:table-cell">
                      <input
                        disabled={!row.enabled}
                        value={row.title}
                        onChange={(e) => updateGridCell(which, i, { title: e.target.value })}
                        placeholder="ixtiyoriy"
                        className="w-full rounded-lg border border-black/10 px-2 py-1"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5 px-2 sm:px-4 pb-24">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-sky-600 text-white flex items-center justify-center">
            <MapPin size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-black/90">Hodimlar joylashuvi</h1>
            <p className="text-[12px] text-black/50">Haftalik jadval (yuqori/pastki hafta ixtiyoriy)</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-black/10 bg-white/90 px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
        >
          Yangilash
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['schedule', 'Dars jadvali'],
            ['pings', 'GPS pinglar'],
            ['alerts', 'Ogohlantirishlar'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-xl px-4 py-2 text-[13px] font-semibold ${
              tab === id ? 'bg-blue-600 text-white shadow-md' : 'bg-white/80 border border-black/10 text-black/70'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60 flex-1 min-w-[200px]">
          Ro‘yxat filtri (hodim telefoni)
          <input
            value={filterOwner}
            onChange={(e) => setFilterOwner(e.target.value)}
            placeholder="998901112233"
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-[14px]"
          />
        </label>
      </div>

      {tab === 'schedule' && weekInfo ? (
        <div className="ios-glass rounded-2xl border border-sky-200/80 bg-sky-50/50 px-4 py-3 text-[13px] text-black/80 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <strong>ISO hafta:</strong> {weekInfo.iso_week}
          </span>
          <span>
            <strong>Joriy bosqich:</strong> {weekInfo.current_week_phase_label_uz}
          </span>
          <span className="text-black/55">
            Yuqori = ISO toq hafta, pastki = ISO juft (viloyatlar bir xil qoida).
          </span>
        </div>
      ) : null}

      {hasAlternatingData && tab === 'schedule' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-[12px] text-amber-950">
          Bu hodimda <strong>yuqori/pastki</strong> hafta slotlari saqlangan — jadvalda turlari bo‘yicha guruhlangan.
        </div>
      ) : null}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-black/50 gap-2">
          <Loader2 className="animate-spin" size={20} />
          Yuklanmoqda…
        </div>
      ) : tab === 'schedule' ? (
        <div className="space-y-8">
          {/* Jadval ko‘rinishi */}
          <div className="ios-glass rounded-2xl border border-white/60 overflow-hidden">
            <div className="px-3 py-2 bg-black/[0.02] text-[12px] font-semibold text-black/55 flex items-center gap-1">
              <ChevronDown size={14} />
              Saqlangan slotlar
            </div>
            {PHASE_ORDER.map((phase) => {
              const rows = scheduleGrouped[phase] ?? [];
              if (rows.length === 0) return null;
              return (
                <div key={phase} className="border-t border-black/5">
                  <div className="px-3 py-2 text-[12px] font-bold text-black/70 bg-black/[0.03]">
                    {PHASE_LABEL[phase]}
                  </div>
                  <table className="w-full text-left text-[13px]">
                    <thead className="text-black/50">
                      <tr>
                        <th className="px-3 py-2">Hodim</th>
                        <th className="px-3 py-2">Kun</th>
                        <th className="px-3 py-2">Vaqt</th>
                        <th className="px-3 py-2">Bino</th>
                        <th className="px-3 py-2">R</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-t border-black/5">
                          <td className="px-3 py-2 font-mono text-[12px]">{r.owner_key}</td>
                          <td className="px-3 py-2">{WEEKDAYS.find((w) => w.v === r.weekday)?.l ?? r.weekday}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {String(r.start_time).slice(0, 5)} — {String(r.end_time).slice(0, 5)}
                          </td>
                          <td className="px-3 py-2">{r.building_name}</td>
                          <td className="px-3 py-2">{r.radius_m} m</td>
                          <td className="px-3 py-2 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => void toggleActive(r)}
                              className="text-[12px] font-semibold text-blue-600"
                            >
                              {r.is_active ? 'Pauza' : 'Faol'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeSlot(r.id)}
                              className="inline-flex items-center justify-center p-1 rounded-lg text-rose-600"
                              aria-label="O‘chirish"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
            {schedule.length === 0 && (
              <div className="px-4 py-8 text-center text-black/45 text-[13px]">Hech qanday slot yo‘q.</div>
            )}
          </div>

          {/* Haftalik editor */}
          <div className="ios-glass rounded-2xl border border-white/60 p-4 space-y-4">
            <h2 className="text-[15px] font-bold text-black/90">Haftalik jadvalni kiritish</h2>
            <p className="text-[12px] text-black/55 leading-relaxed">
              Bitta o‘qituvchi uchun barcha kunlarni shu yerda belgilang. Faol qATORLAR yuboriladi; faolsiz kunlar
              o‘sha bosqichdagi eski slotlarni o‘chiradi (almashtirish). Bir kunda vaqt oralig‘lari ustma-ust
              tushmasligi kerak.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
                Hodim telefoni
                <input
                  value={editorOwner}
                  onChange={(e) => setEditorOwner(e.target.value)}
                  placeholder="998901112233"
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                />
              </label>
              <div className="flex flex-col gap-1 justify-end">
                <span className="text-[12px] font-medium text-black/60">Rejim</span>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setEditorMode('single')}
                    className={`rounded-xl px-3 py-2 text-[12px] font-semibold ${
                      editorMode === 'single' ? 'bg-blue-600 text-white' : 'bg-white border border-black/10'
                    }`}
                  >
                    Har hafta bir xil
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorMode('alternating')}
                    className={`rounded-xl px-3 py-2 text-[12px] font-semibold ${
                      editorMode === 'alternating' ? 'bg-blue-600 text-white' : 'bg-white border border-black/10'
                    }`}
                  >
                    Yuqori / pastki alohida
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
                Asosiy lat
                <input
                  value={defLat}
                  onChange={(e) => setDefLat(e.target.value)}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px] font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
                Asosiy lng
                <input
                  value={defLng}
                  onChange={(e) => setDefLng(e.target.value)}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px] font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
                Radius (m)
                <input
                  type="number"
                  min={30}
                  max={50000}
                  value={defRadius}
                  onChange={(e) => setDefRadius(Number(e.target.value) || 1000)}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fillGridsFromTeacher()}
                className="rounded-xl border border-black/15 bg-white px-4 py-2 text-[12px] font-semibold text-black/80"
              >
                Filtr bo‘yicha jadvalni forma ustiga yuklash
              </button>
              {editorMode === 'alternating' ? (
                <button
                  type="button"
                  onClick={copyUpperToLower}
                  className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-[12px] font-semibold text-violet-900"
                >
                  Pastki haftani yuqoridan nusxa
                </button>
              ) : null}
            </div>

            {editorMode === 'single' ? (
              <div className="space-y-4">
                {renderDayEditor('every', gridEvery, 'every')}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveBulk('every', gridEvery)}
                  className="rounded-xl bg-blue-600 text-white px-5 py-2.5 text-[13px] font-semibold disabled:opacity-50"
                >
                  {saving ? 'Saqlanmoqda…' : 'Har hafta jadvalini saqlash'}
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {renderDayEditor('upper', gridUpper, 'upper')}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveBulk('upper', gridUpper)}
                  className="rounded-xl bg-indigo-600 text-white px-5 py-2.5 text-[13px] font-semibold disabled:opacity-50"
                >
                  {saving ? '…' : 'Yuqori haftani saqlash'}
                </button>

                {renderDayEditor('lower', gridLower, 'lower')}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveBulk('lower', gridLower)}
                  className="rounded-xl bg-teal-600 text-white px-5 py-2.5 text-[13px] font-semibold disabled:opacity-50"
                >
                  {saving ? '…' : 'Pastki haftani saqlash'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : tab === 'pings' ? (
        <div className="ios-glass rounded-2xl border border-white/60 overflow-x-auto">
          <table className="w-full text-left text-[12px] min-w-[640px]">
            <thead className="bg-black/[0.03] text-black/55">
              <tr>
                <th className="px-3 py-2">Vaqt</th>
                <th className="px-3 py-2">Hodim</th>
                <th className="px-3 py-2">lat</th>
                <th className="px-3 py-2">lng</th>
                <th className="px-3 py-2">aniqlik (m)</th>
              </tr>
            </thead>
            <tbody>
              {pings.map((p) => (
                <tr key={p.id} className="border-t border-black/5">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(p.recorded_at).toLocaleString('uz-UZ')}</td>
                  <td className="px-3 py-2 font-mono">{p.owner_key}</td>
                  <td className="px-3 py-2 font-mono">{p.latitude.toFixed(5)}</td>
                  <td className="px-3 py-2 font-mono">{p.longitude.toFixed(5)}</td>
                  <td className="px-3 py-2">{p.accuracy_m != null ? Math.round(p.accuracy_m) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pings.length === 0 && (
            <div className="px-4 py-8 text-center text-black/45 text-[13px]">Ping yo‘q.</div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <div key={a.id} className="ios-glass rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4">
              <div className="flex justify-between gap-2 flex-wrap text-[12px] text-black/50">
                <span className="font-mono">{a.owner_key}</span>
                <span>{new Date(a.created_at).toLocaleString('uz-UZ')}</span>
              </div>
              <p className="text-[14px] font-medium text-black/85 mt-2">{a.building_name || 'Bino'}</p>
              <p className="text-[13px] text-black/70 mt-1">{a.message}</p>
              <p className="text-[11px] text-black/45 mt-2">
                Masofa: {a.distance_m} m · ruxsat radiusi {a.radius_m} m
              </p>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="ios-glass rounded-2xl border border-white/60 p-8 text-center text-black/45 text-[13px]">
              Ogohlantirish yo‘q.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
