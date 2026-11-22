import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { errorText } from '../../utils/staffSelfApi';
import { fetchScopeSubjects, setSubjectScope, type ScopeSubject, type ScopeSubjectsData } from '../../utils/monitorRoomsApi';

/**
 * «Nazoratdagi fanlar» (2026-11-16). Rektor hisoboti faqat KLINIK fanlarning AMALIY mashg'ulotlarini,
 * faqat monitorli xonada nazorat qiladi. Fan klinikmi — avtomatik qoida (klinik kafedra fani yoki
 * nomida klinik belgi bor), admin bu yerda har bir fan uchun qarorni o'zgartira oladi.
 */

type Filter = 'scope' | 'other' | 'manual' | 'all';

const FILTERS: Array<[Filter, string]> = [
  ['scope', 'Nazoratda'],
  ['other', 'Klinik emas'],
  ['manual', 'Admin o‘zgartirgan'],
  ['all', 'Hammasi'],
];

function Decision({ s, busy, onSet }: { s: ScopeSubject; busy: boolean; onSet: (value: boolean | null) => void }) {
  const opt = (value: boolean | null, label: string, on: boolean, tone: string) => (
    <button type="button" disabled={busy} onClick={() => onSet(value)}
      className={`rounded-lg px-2.5 py-1 text-[12.5px] font-semibold transition disabled:opacity-50 ${on ? tone : 'text-slate-500 hover:bg-slate-100'}`}>
      {label}
    </button>
  );
  return (
    <span className="inline-flex rounded-xl bg-slate-50 p-0.5 ring-1 ring-slate-200">
      {opt(true, 'Klinik', s.override === true, 'bg-emerald-600 text-white')}
      {opt(false, 'Klinik emas', s.override === false, 'bg-slate-700 text-white')}
      {opt(null, `Avto: ${s.auto ? 'klinik' : 'emas'}`, s.override === null, 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200')}
    </span>
  );
}

export default function AdminScopeSubjects() {
  const [data, setData] = useState<ScopeSubjectsData | null>(null);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('scope');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await fetchScopeSubjects());
      setError('');
    } catch (e) {
      setError(errorText(e, 'Fanlar ro‘yxatini yuklab bo‘lmadi.'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = async (s: ScopeSubject, value: boolean | null) => {
    setBusyKey(s.key);
    setMsg('');
    try {
      await setSubjectScope(s.name, value);
      setMsg(`«${s.name}» — ${value === null ? 'avtomatik qoidaga qaytarildi' : value ? 'klinik (nazoratda)' : 'klinik emas (nazoratdan chiqdi)'}. Rektor hisoboti 5 daqiqa ichida yangilanadi.`);
      await load();
    } catch (e) {
      setError(errorText(e, 'Saqlab bo‘lmadi.'));
    } finally {
      setBusyKey('');
    }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.subjects || []).filter((s) => {
      if (filter === 'scope' && !(s.clinical && !s.excluded)) return false;
      if (filter === 'other' && s.clinical && !s.excluded) return false;
      if (filter === 'manual' && s.override === null) return false;
      return !needle || `${s.name} ${s.departments.join(' ')}`.toLowerCase().includes(needle);
    });
  }, [data, q, filter]);

  if (!data) {
    return error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-rose-700">{error}</p>
      : <p className="flex items-center gap-2 p-4 text-slate-500"><Loader2 size={16} className="animate-spin" /> Fanlar yuklanmoqda…</p>;
  }
  const sm = data.summary;
  const pct = sm.clinical_lessons ? Math.round((100 * sm.clinical_monitor_lessons) / sm.clinical_lessons) : 0;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-sky-50 px-4 py-3 text-[14px] leading-relaxed text-sky-950 ring-1 ring-sky-100">
        Rektor hisobotida <b>faqat klinik fanlarning amaliy mashg‘ulotlari</b> (amaliy, seminar, klinik mashg‘ulot), <b>faqat monitorli xonada</b> nazorat qilinadi.
        Ma’ruza va laboratoriya, klinik bo‘lmagan fanlar va monitorsiz xonadagi darslar hisobga kirmaydi.
        Fan klinikmi — avtomatik aniqlanadi (klinik kafedra fani yoki nomida klinik belgi bor); kerak bo‘lsa shu yerda o‘zgartiring.
      </div>
      <div className="flex flex-wrap gap-2 text-[13.5px]">
        <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-slate-200"><b>{sm.clinical}</b> ta klinik fan nazoratda ({sm.subjects} tadan)</span>
        <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-slate-200">Ularning amaliy darslari: <b>{sm.clinical_lessons}</b></span>
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-900 ring-1 ring-emerald-200">
          shundan monitorli xonada: <b>{sm.clinical_monitor_lessons}</b> ({pct}%) — hisobotga faqat shular kiradi
        </span>
        <span className="self-center text-[12.5px] text-slate-500">Davr: {data.from} … {data.to}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-xl bg-slate-100 p-0.5">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={`rounded-lg px-3 py-1.5 text-[13.5px] font-semibold ${filter === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {label}
            </button>
          ))}
        </span>
        <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <Search size={15} className="text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Fan yoki kafedra"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none" />
        </label>
      </div>
      {msg && <p className="rounded-xl bg-emerald-50 px-4 py-2 text-[14px] text-emerald-800">{msg}</p>}
      {error && <p className="rounded-xl bg-rose-50 px-4 py-2 text-[14px] text-rose-700">{error}</p>}
      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-slate-50 text-left text-[12px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="border-b border-slate-200 px-3 py-2">Fan</th>
              <th className="border-b border-l border-slate-200 px-3 py-2">Kafedra</th>
              <th className="border-b border-l border-slate-200 px-3 py-2 text-right" title="Oxirgi 4 hafta va shu hafta, amaliy mashg‘ulotlar">Amaliy darslar</th>
              <th className="border-b border-l border-slate-200 px-3 py-2 text-right">Monitorli xonada</th>
              <th className="border-b border-l border-slate-200 px-3 py-2">Qaror</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.key} className={s.clinical && !s.excluded ? '' : 'text-slate-500'}>
                <td className="border-b border-slate-100 px-3 py-2">
                  <span className="font-medium text-slate-900">{s.name}</span>
                  <span className="mt-0.5 block text-[12px] text-slate-500">
                    {s.reason}{s.excluded && ' · kafedrasi hisobotdan chiqarilgan'}
                  </span>
                </td>
                <td className="border-b border-l border-slate-100 px-3 py-2 text-[13px]">{s.departments.join('; ')}</td>
                <td className="border-b border-l border-slate-100 px-3 py-2 text-right tabular-nums">
                  {s.lessons}<span className="block text-[11.5px] text-slate-400">{s.teachers} o‘qituvchi</span>
                </td>
                <td className="border-b border-l border-slate-100 px-3 py-2 text-right tabular-nums">
                  <b className={s.monitor_lessons ? 'text-emerald-700' : 'text-slate-400'}>{s.monitor_lessons}</b>
                  <span className="block text-[11.5px] text-slate-400">{s.monitor_teachers} o‘qituvchi</span>
                </td>
                <td className="border-b border-l border-slate-100 px-3 py-2">
                  <Decision s={s} busy={busyKey === s.key} onSet={(v) => void decide(s, v)} />
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">Topilmadi.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
