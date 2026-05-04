import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, MapPin, Trash2 } from 'lucide-react';
import {
  createAdminStaffSchedule,
  deleteAdminStaffSchedule,
  listAdminStaffAlerts,
  listAdminStaffPings,
  listAdminStaffSchedule,
  patchAdminStaffSchedule,
  type StaffLocationAlertDto,
  type StaffLocationPingDto,
  type StaffScheduleSlotDto,
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

type Tab = 'schedule' | 'pings' | 'alerts';

function validateOwnerKey(v: string): string | null {
  const d = v.replace(/\D/g, '');
  if (d.length !== 12 || !d.startsWith('998')) return "Telefon 998XXXXXXXXX (12 raqam) bo'lishi kerak.";
  return null;
}

export default function AdminStaffLocationConsole() {
  const [tab, setTab] = useState<Tab>('schedule');
  const [filterOwner, setFilterOwner] = useState('');
  const [schedule, setSchedule] = useState<StaffScheduleSlotDto[]>([]);
  const [pings, setPings] = useState<StaffLocationPingDto[]>([]);
  const [alerts, setAlerts] = useState<StaffLocationAlertDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    owner_key: '',
    weekday: 0,
    start_time: '09:00',
    end_time: '10:30',
    building_name: '',
    latitude: '41.311151',
    longitude: '69.279737',
    radius_m: 1000,
    title: '',
  });

  const ownerFilterApplied = useMemo(() => filterOwner.replace(/\D/g, ''), [filterOwner]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const o = ownerFilterApplied.length >= 12 ? ownerFilterApplied : undefined;
      if (tab === 'schedule') {
        const rows = await listAdminStaffSchedule(o);
        setSchedule(rows);
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

  const submitSlot = async () => {
    const err = validateOwnerKey(form.owner_key);
    if (err) {
      setError(err);
      return;
    }
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError('Latitude/longitude noto‘g‘ri.');
      return;
    }
    setError(null);
    const toHms = (t: string) => (t.split(':').length === 2 ? `${t}:00` : t);
    try {
      await createAdminStaffSchedule({
        owner_key: form.owner_key.replace(/\D/g, ''),
        weekday: form.weekday,
        start_time: toHms(form.start_time),
        end_time: toHms(form.end_time),
        building_name: form.building_name.trim(),
        latitude: lat,
        longitude: lng,
        radius_m: form.radius_m,
        title: form.title.trim(),
        is_active: true,
      });
      await load();
    } catch {
      setError('Slot yaratishda xato (vaqt formati yoki maydonlar).');
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

  return (
    <div className="max-w-5xl mx-auto space-y-5 px-2 sm:px-4 pb-24">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-sky-600 text-white flex items-center justify-center">
            <MapPin size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-black/90">Hodimlar joylashuvi</h1>
            <p className="text-[12px] text-black/50">Jadval, pinglar va radiusdan tashqari holatlar</p>
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
          Hodim telefoni (filtr, 998…)
          <input
            value={filterOwner}
            onChange={(e) => setFilterOwner(e.target.value)}
            placeholder="998901112233"
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-[14px]"
          />
        </label>
      </div>

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
        <div className="space-y-6">
          <div className="ios-glass rounded-2xl border border-white/60 overflow-hidden">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-black/[0.03] text-black/55">
                <tr>
                  <th className="px-3 py-2 font-semibold">Hodim</th>
                  <th className="px-3 py-2 font-semibold">Kun</th>
                  <th className="px-3 py-2 font-semibold">Vaqt</th>
                  <th className="px-3 py-2 font-semibold">Bino</th>
                  <th className="px-3 py-2 font-semibold">Radius</th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {schedule.map((r) => (
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
            {schedule.length === 0 && (
              <div className="px-4 py-8 text-center text-black/45 text-[13px]">Hech qanday slot yo‘q.</div>
            )}
          </div>

          <div className="ios-glass rounded-2xl border border-white/60 p-4 space-y-3">
            <h2 className="text-[14px] font-bold text-black/80">Yangi slot</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
                Hodim telefoni (owner_key)
                <input
                  value={form.owner_key}
                  onChange={(e) => setForm((f) => ({ ...f, owner_key: e.target.value }))}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                  placeholder="998901112233"
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
                Hafta kuni
                <select
                  value={form.weekday}
                  onChange={(e) => setForm((f) => ({ ...f, weekday: Number(e.target.value) }))}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                >
                  {WEEKDAYS.map((w) => (
                    <option key={w.v} value={w.v}>
                      {w.l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
                Boshlanish
                <input
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
                Tugash
                <input
                  type="time"
                  value={form.end_time}
                  onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60 sm:col-span-2">
                Bino nomi
                <input
                  value={form.building_name}
                  onChange={(e) => setForm((f) => ({ ...f, building_name: e.target.value }))}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
                Kenglik (lat)
                <input
                  value={form.latitude}
                  onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px] font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
                Uzunlik (lng)
                <input
                  value={form.longitude}
                  onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px] font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
                Radius (m)
                <input
                  type="number"
                  min={50}
                  max={5000}
                  value={form.radius_m}
                  onChange={(e) => setForm((f) => ({ ...f, radius_m: Number(e.target.value) || 1000 }))}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
                Izoh (ixtiyoriy)
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => void submitSlot()}
              className="rounded-xl bg-blue-600 text-white px-4 py-2.5 text-[13px] font-semibold"
            >
              Saqlash
            </button>
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
