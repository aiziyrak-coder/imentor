import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, Loader2, MapPin, Plus, Radio, Trash2 } from 'lucide-react';
import {
  listAllStaffUsers,
  normalizeUserRole,
  subscribeLocalAuth,
  type LocalStaffUser,
} from '../../utils/localStaffAuth';
import AdminStaffLiveMapPanel from './AdminStaffLiveMapPanel';
import {
  bulkReplaceAdminStaffSchedule,
  deleteAdminStaffSchedule,
  getScheduleWeekInfo,
  HttpError,
  listAdminStaffAlerts,
  listAdminStaffPings,
  listAdminStaffSchedule,
  listCampusBuildings,
  patchAdminStaffSchedule,
  type BulkScheduleSlotPayload,
  type CampusBuildingDto,
  type ScheduleWeekInfoDto,
  type StaffLocationAlertDto,
  type StaffLocationPingDto,
  type StaffScheduleSlotDto,
  type WeekPhase,
} from '../../utils/staffLocationApi';

// formatApiError - local if not exported; define here
function formatApiErrorLocal(err: unknown): string {
  if (err instanceof HttpError && err.body && typeof err.body === 'object') {
    const b = err.body as { [key: string]: unknown };
    if (typeof b.detail === 'string') return b.detail;
    if (Array.isArray(b.non_field_errors)) return String(b.non_field_errors[0]);
    const parts: string[] = [];
    for (const [k, v] of Object.entries(b)) {
      parts.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
    if (parts.length) return parts.join('; ');
  }
  if (err instanceof Error) return err.message;
  return "So'rovda xato.";
}

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
const PHASE_LABEL: { [K in WeekPhase]: string } = {
  every: 'Har hafta',
  upper: 'Yuqori hafta (ISO toq)',
  lower: 'Pastki hafta (ISO juft)',
};

type Tab = 'schedule' | 'livemap' | 'pings' | 'alerts';
type EditorMode = 'single' | 'alternating';

type IntervalRow = {
  clientId: string;
  start: string;
  end: string;
  buildingId: number | '';
  title: string;
  legacyName?: string;
  legacyLat?: string;
  legacyLng?: string;
};

/** TSX: Record<..., T[]> oxiridagi `>` JSX bilan adashmasin */
type IntervalsByWeekday = { [day: number]: IntervalRow[] };

function newClientId(): string {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function newIntervalRow(): IntervalRow {
  return {
    clientId: newClientId(),
    start: '09:00',
    end: '10:30',
    buildingId: '',
    title: '',
  };
}

function emptyIntervals(): IntervalsByWeekday {
  return Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, []])) as IntervalsByWeekday;
}

function defaultPhase(s: StaffScheduleSlotDto): WeekPhase {
  return s.week_phase ?? 'every';
}

function scheduleToIntervals(slots: StaffScheduleSlotDto[], phase: WeekPhase): IntervalsByWeekday {
  const r = emptyIntervals();
  for (const s of slots) {
    if (defaultPhase(s) !== phase) continue;
    const bId = s.building?.id;
    const row: IntervalRow = {
      clientId: `s${s.id}`,
      start: String(s.start_time).slice(0, 5),
      end: String(s.end_time).slice(0, 5),
      buildingId: typeof bId === 'number' ? bId : '',
      title: s.title ?? '',
    };
    if (!bId) {
      row.legacyName = s.building_name;
      row.legacyLat = String(s.latitude);
      row.legacyLng = String(s.longitude);
    }
    r[s.weekday].push(row);
  }
  for (let d = 0; d <= 6; d++) {
    r[d].sort((a, b) => a.start.localeCompare(b.start));
  }
  return r;
}

function toHms(t: string): string {
  return t.split(':').length === 2 ? `${t}:00` : t;
}

function validateOwnerKey(v: string): string | null {
  const d = v.replace(/\D/g, '');
  if (d.length !== 12 || !d.startsWith('998')) return "Telefon 998 bilan 12 raqam bo'lishi kerak.";
  return null;
}

function intervalsToPayload(
  rec: IntervalsByWeekday,
  legacyDefaultRadius: number,
): { slots: BulkScheduleSlotPayload[]; error: string | null } {
  const out: BulkScheduleSlotPayload[] = [];
  for (let wd = 0; wd <= 6; wd++) {
    for (const row of rec[wd] ?? []) {
      if (!row.start || !row.end) {
        return { slots: [], error: `${WEEKDAYS[wd]?.l ?? wd}: vaqt to'ldirilsin.` };
      }
      if (row.buildingId !== '') {
        out.push({
          weekday: wd,
          start_time: toHms(row.start),
          end_time: toHms(row.end),
          building_id: row.buildingId as number,
          title: row.title.trim(),
        });
        continue;
      }
      const n = (row.legacyName || '').trim();
      const la = row.legacyLat != null ? parseFloat(row.legacyLat) : NaN;
      const ln = row.legacyLng != null ? parseFloat(row.legacyLng) : NaN;
      if (!n || !Number.isFinite(la) || !Number.isFinite(ln)) {
        return {
          slots: [],
          error: `${WEEKDAYS[wd]?.l ?? wd}: bino tanlang yoki (eski usul) nom + lat + lng kiriting.`,
        };
      }
      out.push({
        weekday: wd,
        start_time: toHms(row.start),
        end_time: toHms(row.end),
        building_name: n,
        latitude: la,
        longitude: ln,
        radius_m: legacyDefaultRadius,
        title: row.title.trim(),
      });
    }
  }
  return { slots: out, error: null };
}

export default function AdminStaffLocationConsole() {
  const [tab, setTab] = useState<Tab>('schedule');
  /** 12 raqam (998...) yoki bo'sh: barcha hodimlar */
  const [staffOwnerDigits, setStaffOwnerDigits] = useState('');
  const [staffOptions, setStaffOptions] = useState<LocalStaffUser[]>([]);
  const [schedule, setSchedule] = useState<StaffScheduleSlotDto[]>([]);
  const [pings, setPings] = useState<StaffLocationPingDto[]>([]);
  const [alerts, setAlerts] = useState<StaffLocationAlertDto[]>([]);
  const [buildings, setBuildings] = useState<CampusBuildingDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [weekInfo, setWeekInfo] = useState<ScheduleWeekInfoDto | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('single');
  const [legacyRadius, setLegacyRadius] = useState(1000);
  const [intervalsEvery, setIntervalsEvery] = useState<IntervalsByWeekday>(() => emptyIntervals());
  const [intervalsUpper, setIntervalsUpper] = useState<IntervalsByWeekday>(() => emptyIntervals());
  const [intervalsLower, setIntervalsLower] = useState<IntervalsByWeekday>(() => emptyIntervals());
  const [liveMapUpdated, setLiveMapUpdated] = useState<Date | null>(null);

  const LIVE_MAP_POLL_SEC = 5;

  const refreshStaffOptions = useCallback(() => {
    try {
      const rows = listAllStaffUsers()
        .filter((u) => normalizeUserRole(u) === 'hodim')
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'uz'));
      setStaffOptions(rows);
    } catch {
      setStaffOptions([]);
    }
  }, []);

  useEffect(() => {
    refreshStaffOptions();
  }, [refreshStaffOptions]);

  useEffect(() => {
    return subscribeLocalAuth(() => {
      refreshStaffOptions();
    });
  }, [refreshStaffOptions]);

  const ownerFilterApplied = useMemo(() => staffOwnerDigits.replace(/\D/g, ''), [staffOwnerDigits]);
  const editorDigits = ownerFilterApplied;

  const scheduleGrouped = useMemo(() => {
    const m: { every: StaffScheduleSlotDto[]; upper: StaffScheduleSlotDto[]; lower: StaffScheduleSlotDto[] } = {
      every: [],
      upper: [],
      lower: [],
    };
    for (const r of schedule) {
      const p = defaultPhase(r);
      if (!m[p]) m[p] = [];
      m[p].push(r);
    }
    return m;
  }, [schedule]);

  const hasAlternatingData = useMemo(
    () => schedule.some((s) => defaultPhase(s) === 'upper' || defaultPhase(s) === 'lower'),
    [schedule],
  );

  const showAlternatingHint =
    hasAlternatingData && tab === 'schedule' && ownerFilterApplied.length >= 12;

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const o = ownerFilterApplied.length >= 12 ? ownerFilterApplied : undefined;
      if (tab === 'schedule') {
        const [rows, wi, b] = await Promise.all([
          listAdminStaffSchedule(o),
          getScheduleWeekInfo().catch(() => null),
          listCampusBuildings().catch(() => []),
        ]);
        setSchedule(rows);
        if (wi) setWeekInfo(wi);
        setBuildings(b);
      } else if (tab === 'livemap') {
        const [p, b] = await Promise.all([
          listAdminStaffPings(o),
          listCampusBuildings().catch(() => []),
        ]);
        setPings(p);
        setBuildings(b);
        setLiveMapUpdated(new Date());
      } else if (tab === 'pings') {
        setPings(await listAdminStaffPings(o));
      } else {
        setAlerts(await listAdminStaffAlerts(o));
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

  const refreshLiveMapPings = useCallback(async () => {
    if (tab !== 'livemap') return;
    try {
      const o = ownerFilterApplied.length >= 12 ? ownerFilterApplied : undefined;
      setPings(await listAdminStaffPings(o));
      setLiveMapUpdated(new Date());
    } catch {
      /* sessiya yoki tarmoq — jim yangilash */
    }
  }, [tab, ownerFilterApplied]);

  useEffect(() => {
    if (tab !== 'livemap') return;
    const id = window.setInterval(() => void refreshLiveMapPings(), LIVE_MAP_POLL_SEC * 1000);
    return () => window.clearInterval(id);
  }, [tab, refreshLiveMapPings]);

  const setIntervals = (which: 'every' | 'upper' | 'lower', fn: (p: IntervalsByWeekday) => IntervalsByWeekday) => {
    if (which === 'every') setIntervalsEvery((p) => fn(p));
    else if (which === 'upper') setIntervalsUpper((p) => fn(p));
    else setIntervalsLower((p) => fn(p));
  };

  const addInterval = (which: 'every' | 'upper' | 'lower', dayIdx: number) => {
    setIntervals(which, (prev) => {
      const next = { ...prev, [dayIdx]: [...(prev[dayIdx] ?? []), newIntervalRow()] };
      return next;
    });
  };

  const removeInterval = (which: 'every' | 'upper' | 'lower', dayIdx: number, clientId: string) => {
    setIntervals(which, (prev) => ({
      ...prev,
      [dayIdx]: (prev[dayIdx] ?? []).filter((r) => r.clientId !== clientId),
    }));
  };

  const patchInterval = (
    which: 'every' | 'upper' | 'lower',
    dayIdx: number,
    clientId: string,
    patch: Partial<IntervalRow>,
  ) => {
    setIntervals(which, (prev) => ({
      ...prev,
      [dayIdx]: (prev[dayIdx] ?? []).map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)),
    }));
  };

  const fillFromSchedule = useCallback(() => {
    const err = validateOwnerKey(staffOwnerDigits);
    if (err) {
      setError(err);
      return;
    }
    const digits = editorDigits;
    const mine = schedule.filter((s) => s.owner_key === digits);
    if (mine.length === 0) {
      setError('Bu hodim uchun jadval hali yo‘q — pastda yangi yarating.');
      return;
    }
    const hasAlt = mine.some((s) => defaultPhase(s) === 'upper' || defaultPhase(s) === 'lower');
    setEditorMode(hasAlt ? 'alternating' : 'single');
    if (hasAlt) {
      setIntervalsUpper(scheduleToIntervals(mine, 'upper'));
      setIntervalsLower(scheduleToIntervals(mine, 'lower'));
      setIntervalsEvery(emptyIntervals());
    } else {
      setIntervalsEvery(scheduleToIntervals(mine, 'every'));
      setIntervalsUpper(emptyIntervals());
      setIntervalsLower(emptyIntervals());
    }
    setError(null);
  }, [staffOwnerDigits, editorDigits, schedule]);

  const copyUpperToLower = () => {
    const copy = emptyIntervals();
    for (let d = 0; d <= 6; d++) {
      copy[d] = (intervalsUpper[d] ?? []).map((r) => ({ ...r, clientId: newClientId() }));
    }
    setIntervalsLower(copy);
  };

  const saveBulk = async (phase: WeekPhase, rec: IntervalsByWeekday) => {
    const err = validateOwnerKey(staffOwnerDigits);
    if (err) {
      setError(err);
      return;
    }
    const { slots, error: pe } = intervalsToPayload(rec, legacyRadius);
    if (pe) {
      setError(pe);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await bulkReplaceAdminStaffSchedule({
        owner_key: editorDigits,
        week_phase: phase,
        replace_existing: true,
        slots,
      });
      await load();
      setStaffOwnerDigits(editorDigits);
    } catch (e) {
      setError(formatApiErrorLocal(e));
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

  const buildingOptions = useMemo(
    () =>
      buildings.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
          {b.short_code ? ` (${b.short_code})` : ''}
        </option>
      )),
    [buildings],
  );

  const renderPhaseCard = (phase: WeekPhase, currentPhase: 'every' | 'upper' | 'lower') => {
    const rec =
      currentPhase === 'every' ? intervalsEvery : currentPhase === 'upper' ? intervalsUpper : intervalsLower;
    const which = currentPhase;
    const showBadge =
      weekInfo && (phase === 'upper' || phase === 'lower') && weekInfo.current_week_phase === phase;

    return (
      <div key={phase} className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-[14px] font-bold text-black/85">{PHASE_LABEL[phase]}</h3>
          {showBadge ? (
            <span className="text-[11px] font-semibold rounded-full bg-emerald-100 text-emerald-900 px-2 py-0.5">
              Bu hafta shu variant
            </span>
          ) : null}
        </div>
        <div className="space-y-4">
          {WEEKDAYS.map((wd) => {
            const rows = rec[wd.v] ?? [];
            return (
              <div key={wd.v} className="rounded-xl border border-black/10 bg-white/50 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-black/80">{wd.l}</span>
                  <button
                    type="button"
                    onClick={() => addInterval(which, wd.v)}
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-50 text-blue-700 px-2.5 py-1 text-[12px] font-semibold border border-blue-100"
                  >
                    <Plus size={14} />
                    Vaqt oralig‘i
                  </button>
                </div>
                {rows.length === 0 ? (
                  <p className="text-[12px] text-black/45">Bu kun uchun slot yo‘q — «Vaqt oralig‘i» bosing.</p>
                ) : (
                  <div className="space-y-2">
                    {rows.map((row) => (
                      <div
                        key={row.clientId}
                        className="flex flex-col lg:flex-row lg:flex-wrap gap-2 p-2 rounded-lg bg-black/[0.02] border border-black/5"
                      >
                        <input
                          type="time"
                          value={row.start}
                          onChange={(e) => patchInterval(which, wd.v, row.clientId, { start: e.target.value })}
                          className="rounded-lg border border-black/10 px-2 py-1 text-[13px] w-[7rem]"
                        />
                        <span className="text-black/35 self-center hidden lg:inline">—</span>
                        <input
                          type="time"
                          value={row.end}
                          onChange={(e) => patchInterval(which, wd.v, row.clientId, { end: e.target.value })}
                          className="rounded-lg border border-black/10 px-2 py-1 text-[13px] w-[7rem]"
                        />
                        <select
                          value={row.buildingId === '' ? '' : String(row.buildingId)}
                          onChange={(e) => {
                            const v = e.target.value;
                            patchInterval(which, wd.v, row.clientId, {
                              buildingId: v === '' ? '' : Number(v),
                              legacyName: undefined,
                              legacyLat: undefined,
                              legacyLng: undefined,
                            });
                          }}
                          className="flex-1 min-w-[160px] rounded-lg border border-black/10 px-2 py-1.5 text-[13px]"
                        >
                          <option value="">— Bino tanlang —</option>
                          {buildingOptions}
                        </select>
                        {row.buildingId === '' ? (
                          <div className="flex flex-wrap gap-2 flex-1">
                            <input
                              placeholder="Eski: bino nomi"
                              value={row.legacyName ?? ''}
                              onChange={(e) =>
                                patchInterval(which, wd.v, row.clientId, { legacyName: e.target.value })
                              }
                              className="rounded-lg border border-amber-200 bg-amber-50/50 px-2 py-1 text-[12px] min-w-[120px]"
                            />
                            <input
                              placeholder="lat"
                              value={row.legacyLat ?? ''}
                              onChange={(e) =>
                                patchInterval(which, wd.v, row.clientId, { legacyLat: e.target.value })
                              }
                              className="rounded-lg border border-amber-200 px-2 py-1 text-[12px] w-28 font-mono"
                            />
                            <input
                              placeholder="lng"
                              value={row.legacyLng ?? ''}
                              onChange={(e) =>
                                patchInterval(which, wd.v, row.clientId, { legacyLng: e.target.value })
                              }
                              className="rounded-lg border border-amber-200 px-2 py-1 text-[12px] w-28 font-mono"
                            />
                          </div>
                        ) : null}
                        <input
                          placeholder="Izoh"
                          value={row.title}
                          onChange={(e) => patchInterval(which, wd.v, row.clientId, { title: e.target.value })}
                          className="rounded-lg border border-black/10 px-2 py-1 text-[12px] min-w-[100px] flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => removeInterval(which, wd.v, row.clientId)}
                          className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 self-start"
                          aria-label="O‘chirish"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveBulk(phase, rec)}
          className="rounded-xl bg-blue-600 text-white px-5 py-2.5 text-[13px] font-semibold disabled:opacity-50"
        >
          {saving ? 'Saqlanmoqda…' : `${PHASE_LABEL[phase]} — saqlash`}
        </button>
      </div>
    );
  };

  return (
    <div
      className={`mx-auto space-y-5 px-2 sm:px-4 pb-24 ${tab === 'livemap' ? 'max-w-7xl' : 'max-w-5xl'}`}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-sky-600 text-white flex items-center justify-center">
            <MapPin size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-black/90">Hodimlar joylashuvi</h1>
            <p className="text-[12px] text-black/50">Bino katalogi + kun bo‘yicha bir nechta vaqt</p>
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
            ['livemap', 'Jonli xarita'],
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

      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60 flex-1 min-w-[200px]">
          Hodimni tanlang (jadval, filtr va jonli xarita)
          <select
            value={staffOwnerDigits}
            onChange={(e) => setStaffOwnerDigits(e.target.value)}
            className="rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[14px] text-black/90"
          >
            <option value="">— Barcha hodimlar (barcha slotlar / barcha pinglar) —</option>
            {staffOptions.map((u) => (
              <option key={u.uid} value={u.phoneDigits}>
                {u.displayName} · {u.phoneDisplay}
              </option>
            ))}
          </select>
        </label>
        {staffOptions.length === 0 ? (
          <p className="text-[11px] text-amber-800">
            Ro‘yxatda hodim yo‘q — avval <strong>Hodimlar boshqaruvi</strong> orqali hodim (rol: hodim) qo‘shing.
          </p>
        ) : null}
      </div>

      {tab !== 'livemap' ? (
        <button
          type="button"
          onClick={() => setTab('livemap')}
          className="group w-full rounded-2xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50/95 to-sky-50/85 px-4 py-3 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md">
                <Radio className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <div className="text-[14px] font-bold text-black/90">Barcha hodimlar — jonli xarita</div>
                <div className="text-[12px] text-black/55">
                  Kim qayerda: oxirgi GPS va kampus binolari (har {LIVE_MAP_POLL_SEC}s yangilanadi)
                </div>
              </div>
            </div>
            <span className="text-[12px] font-semibold text-emerald-800 group-hover:underline">Ochish →</span>
          </div>
        </button>
      ) : null}

      {tab === 'schedule' && weekInfo ? (
        <div className="ios-glass rounded-2xl border border-sky-200/80 bg-sky-50/50 px-4 py-3 text-[13px] text-black/80 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <strong>ISO hafta:</strong> {weekInfo.iso_week}
          </span>
          <span>
            <strong>Joriy:</strong> {weekInfo.current_week_phase_label_uz}
          </span>
        </div>
      ) : null}

      {showAlternatingHint ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-[12px] text-amber-950">
          Bu hodimda <strong>yuqori/pastki</strong> hafta slotlari bor — jadvalda guruhlangan.
        </div>
      ) : null}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {tab === 'schedule' && buildings.length === 0 && !loading ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[13px] text-rose-900">
          Hozircha <strong>kampus binolari</strong> kiritilmagan. Avval menyu orqali{' '}
          <strong>«Kampus binolari»</strong> sahifasida binolar va GPS nuqtalarini qo‘shing.
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-black/50 gap-2">
          <Loader2 className="animate-spin" size={20} />
          Yuklanmoqda…
        </div>
      ) : tab === 'schedule' ? (
        <div className="space-y-8">
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
                  <div className="px-3 py-2 text-[12px] font-bold text-black/70 bg-black/[0.03]">{PHASE_LABEL[phase]}</div>
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
                          <td className="px-3 py-2">{r.building?.name ?? r.building_name}</td>
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

          <div className="ios-glass rounded-2xl border border-white/60 p-4 space-y-4">
            <h2 className="text-[15px] font-bold text-black/90">Haftalik jadval</h2>
            <p className="text-[12px] text-black/55 leading-relaxed">
              Har bir kun uchun bir nechta vaqt oralig‘i qo‘shing (turli binolar). GPS nazorati slot tugash vaqtigacha
              shu binoning radiusida bo‘lishni kutadi. Bir kunda vaqtlar ustma-ust tushmasligi kerak.
            </p>

            <div className="rounded-xl border border-sky-100 bg-sky-50/40 px-3 py-2 text-[12px] text-black/70">
              {staffOwnerDigits.length >= 12 ? (
                <>
                  Jadval <span className="font-mono font-semibold text-black/90">{staffOwnerDigits}</span> uchun
                  saqlanadi — hodimni yuqoridagi ro‘yxatdan o‘zgartirishingiz mumkin.
                </>
              ) : (
                <>
                  <strong className="text-amber-900">Jadval yaratish va saqlash</strong> uchun yuqoridan konkret
                  hodimni tanlang.
                </>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60 sm:col-span-2">
                Eski usul radius (m) — faqat bino tanlanmagan qatorlar uchun
                <input
                  type="number"
                  min={30}
                  max={50000}
                  value={legacyRadius}
                  onChange={(e) => setLegacyRadius(Number(e.target.value) || 1000)}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px] max-w-xs"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[12px] font-medium text-black/60">Rejim:</span>
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
              <button
                type="button"
                onClick={() => fillFromSchedule()}
                className="rounded-xl border border-black/15 bg-white px-4 py-2 text-[12px] font-semibold text-black/80"
              >
                Filtr bo‘yicha yuklash
              </button>
              {editorMode === 'alternating' ? (
                <button
                  type="button"
                  onClick={copyUpperToLower}
                  className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-[12px] font-semibold text-violet-900"
                >
                  Pastkini yuqoridan nusxa
                </button>
              ) : null}
            </div>

            {editorMode === 'single' ? renderPhaseCard('every', 'every') : (
              <div className="space-y-10">
                {renderPhaseCard('upper', 'upper')}
                {renderPhaseCard('lower', 'lower')}
              </div>
            )}
          </div>
        </div>
      ) : tab === 'livemap' ? (
        <div className="ios-glass rounded-2xl border border-white/60 p-4 sm:p-5">
          <AdminStaffLiveMapPanel
            pings={pings}
            buildings={buildings}
            lastUpdated={liveMapUpdated}
            pollIntervalSec={LIVE_MAP_POLL_SEC}
          />
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
