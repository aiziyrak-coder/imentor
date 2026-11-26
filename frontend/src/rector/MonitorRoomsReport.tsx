import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, Monitor, Search } from 'lucide-react';
import { fetchMonitorRooms, type MonitorRoomsReport as Report } from './rectorApi';
import { EmptyNote, Skeleton } from './RectorViz';

/**
 * «Monitorli xonalar» (2026-11-26): rektor va dekan nazoratdagi xonalar ro'yxatini ko'radi — faqat ko'rish,
 * o'zgartirish admin panelida. Kafedra bo'yicha guruhlangan; dekan faqat o'z kafedralarini ko'radi.
 */
export default function MonitorRoomsReport({
  onUnauthorized,
  onBack,
}: {
  onUnauthorized: () => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    fetchMonitorRooms()
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (/401|403/.test(String(e))) onUnauthorized();
        else if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [onUnauthorized]);

  const shown = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data.departments;
    return data.departments
      .map((d) =>
        d.name.toLowerCase().includes(needle)
          ? d
          : { ...d, rooms: d.rooms.filter((r) => `${r.room} ${r.monitor_id}`.toLowerCase().includes(needle)) },
      )
      .filter((d) => d.rooms.length > 0);
  }, [data, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="ios-press inline-flex items-center gap-1 rounded-full bg-white px-3.5 py-2 text-[15px] font-semibold text-indigo-600 shadow-sm ring-1 ring-slate-200"
        >
          <ArrowLeft size={17} />
          Tizimlar
        </button>
        <h2 className="text-[20px] font-extrabold tracking-tight text-slate-900">Monitorli xonalar</h2>
      </div>

      {error && (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700 ring-1 ring-rose-200">
          Ro‘yxat kelmadi: {error}
        </p>
      )}

      {!data && !error ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Monitorli xonalar" value={data.rooms_total} />
            <Stat label="Kafedralar" value={data.departments.length} />
            <Stat label="Shu haftadagi darslar" value={data.lessons_week} />
          </div>

          <label className="flex items-center gap-2 rounded-2xl bg-white px-3.5 ring-1 ring-slate-200">
            <Search size={16} className="text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Kafedra yoki xona bo‘yicha qidirish"
              className="w-full bg-transparent py-2.5 text-[14px] outline-none"
            />
          </label>

          {shown.length === 0 ? (
            <div className="rx-card">
              <EmptyNote icon={Monitor}>Mos xona topilmadi.</EmptyNote>
            </div>
          ) : (
            <div className="rx-card overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <thead className="sticky top-0 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">№</th>
                    <th className="px-4 py-2.5">Xona</th>
                    <th className="px-4 py-2.5">Monitor</th>
                    <th className="px-4 py-2.5 text-right">Shu hafta darslar</th>
                    <th className="px-4 py-2.5 text-right">Nazoratdagi o‘qituvchilar</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => (
                    <DepartmentRows key={d.name} name={d.name} rooms={d.rooms} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="px-1 text-[11.5px] text-slate-400">
            Faqat bugun faol xonalar. «Nazoratdagi o‘qituvchilar» — o‘tgan va shu haftada xonada klinik fan bo‘yicha amaliy
            dars o‘tganlar. Ro‘yxatni o‘zgartirish — admin panelida.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rx-card px-4 py-3">
      <p className="text-[24px] font-extrabold leading-none text-slate-900 rx-num">{value}</p>
      <p className="mt-1 text-[12px] font-medium text-slate-500">{label}</p>
    </div>
  );
}

function DepartmentRows({ name, rooms }: { name: string; rooms: Report['departments'][number]['rooms'] }) {
  return (
    <>
      <tr className="border-t border-slate-200 bg-indigo-50/60">
        <td colSpan={5} className="px-4 py-2 text-[13px] font-bold text-indigo-900">
          <span className="inline-flex items-center gap-1.5">
            <Building2 size={14} /> {name}
            <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-600 ring-1 ring-indigo-200">
              {rooms.length} ta xona
            </span>
          </span>
        </td>
      </tr>
      {rooms.map((r, i) => (
        <tr key={r.monitor_id} className="border-t border-slate-100">
          <td className="px-4 py-2 text-slate-400 rx-num">{i + 1}</td>
          <td className="px-4 py-2 font-medium text-slate-800">{r.room}</td>
          <td className="px-4 py-2 text-slate-500">{r.monitor_id}</td>
          <td className="px-4 py-2 text-right rx-num">{r.lessons_week}</td>
          <td className="px-4 py-2 text-right rx-num">{r.scope_teachers}</td>
        </tr>
      ))}
    </>
  );
}
