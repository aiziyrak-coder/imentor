import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { fetchControlPeople, type ControlPerson, type ReportFilters } from './rectorApi';
import type { Person } from './PersonPanel';

/**
 * Aqlli filtr (2026-11-15). Rektor: "filter zo'r emas, ishlamayapti, tez emas — smart filter qiling".
 *
 * * Davr — tez tugmalar + sanalar; tanlov o'zgarsa hisobot yuklanayotgani sahifada ko'rinadi.
 * * Kafedra — qidiruvli ro'yxat, fakultetlar bo'yicha guruhlangan (bitta bosish bilan tanlanadi).
 * * O'qituvchi — yozish bilan DARHOL natija (serverga har harfda so'rov yubormaydi): ism yoki kafedra
 *   bo'yicha; tanlansa o'qituvchining to'liq hisoboti ochiladi.
 */

export type QuickRange = { label: string; from: () => string; to: () => string };

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[‘’ʻʼ`']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function DepartmentPicker({
  value,
  onChange,
  departments,
  faculties,
}: {
  value: string;
  onChange: (v: string) => void;
  departments: string[];
  faculties: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const groups = useMemo(() => {
    const needle = norm(q);
    const by = new Map<string, string[]>();
    for (const d of departments) {
      if (needle && !norm(`${d} ${faculties[d] || ''}`).includes(needle)) continue;
      const f = faculties[d] || 'Boshqa';
      by.set(f, [...(by.get(f) || []), d]);
    }
    return [...by.entries()].sort(([a], [b]) => (a === 'Boshqa' ? 1 : b === 'Boshqa' ? -1 : a.localeCompare(b)));
  }, [departments, faculties, q]);

  return (
    <div ref={box} className="relative w-full sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-10 w-full min-w-0 items-center gap-2 rounded-xl border px-3 text-left text-[14px] transition sm:w-60 2xl:w-72 ${value ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Building2 size={16} className="shrink-0 opacity-60" />
        <span className="min-w-0 flex-1 truncate">{value || 'Barcha fakultet va kafedralar'}</span>
        {value ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange(''); } }}
            className="rounded-full p-0.5 hover:bg-indigo-100"
            aria-label="Kafedra tanlovini olib tashlash"
          >
            <X size={14} />
          </span>
        ) : (
          <ChevronDown size={16} className="shrink-0 opacity-50" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,26rem)] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10">
          <div className="border-b border-slate-100 p-2">
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3">
              <Search size={15} className="text-slate-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Kafedra yoki fakultet"
                className="h-9 w-full bg-transparent text-[14px] outline-none"
              />
            </div>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto py-1" role="listbox">
            <li>
              <button type="button" onClick={() => { onChange(''); setOpen(false); }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[14px] font-semibold text-slate-800 hover:bg-slate-50">
                <span className="flex-1">Barcha fakultet va kafedralar</span>
                {!value && <Check size={16} className="text-indigo-600" />}
              </button>
            </li>
            {groups.map(([faculty, items]) => (
              <li key={faculty}>
                {faculty === 'Boshqa' ? (
                  <p className="px-4 pb-1 pt-3 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">{faculty}</p>
                ) : (
                  // Fakultet butunligicha tanlanadi (2026-11-16): server `department` ga fakultet nomini taniydi.
                  <button type="button" onClick={() => { onChange(faculty); setOpen(false); setQ(''); }}
                    className={`mt-1 flex w-full items-center gap-2 px-4 pb-1.5 pt-2.5 text-left hover:bg-indigo-50 ${faculty === value ? 'text-indigo-700' : 'text-slate-500'}`}
                    title="Fakultetning hamma kafedralari">
                    <span className="flex-1 text-[11.5px] font-bold uppercase tracking-wide">{faculty}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-semibold normal-case">butun fakultet</span>
                    {faculty === value && <Check size={16} className="text-indigo-600" />}
                  </button>
                )}
                {items.map((d) => (
                  <button key={d} type="button" onClick={() => { onChange(d); setOpen(false); setQ(''); }}
                    className={`flex w-full items-center gap-2 py-2 pl-6 pr-4 text-left text-[14px] hover:bg-indigo-50 ${d === value ? 'font-semibold text-indigo-700' : 'text-slate-700'}`}>
                    <span className="flex-1">{d}</span>
                    {d === value && <Check size={16} className="text-indigo-600" />}
                  </button>
                ))}
              </li>
            ))}
            {!groups.length && <li className="px-4 py-6 text-center text-[14px] text-slate-400">Topilmadi</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function TeacherSearch({ filters, onOpenPerson }: { filters: ReportFilters; onOpenPerson: (p: Person) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ControlPerson[] | null>(null);
  const [loading, setLoading] = useState(false);
  /** Ro'yxat yuklanmadi — "topilmadi" deb ko'rsatilmaydi (2026-11-17 audit). */
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const key = `${filters.from}|${filters.to}|${filters.department}|${retryTick}`;
  const loadedKey = useRef('');

  // Ro'yxat birinchi marta yozilganda yuklanadi (davr/kafedra o'zgarsa — qayta), keyin qidiruv brauzerda.
  useEffect(() => {
    if (!open || loadedKey.current === key) return;
    loadedKey.current = key;
    setLoading(true);
    setFailed(false);
    fetchControlPeople({ ...filters, q: '' }, 'watched')
      .then((d) => setList(Array.isArray(d.people) ? d.people : []))
      .catch(() => {
        setList([]);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }, [open, key, filters]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const hits = useMemo(() => {
    const needle = norm(q);
    if (!list || needle.length < 2) return [];
    return list.filter((p) => norm(`${p.name} ${p.subtitle}`).includes(needle)).slice(0, 8);
  }, [list, q]);

  return (
    <div ref={box} className="relative w-full min-w-0 flex-1 sm:w-auto sm:min-w-[9rem]">
      <div className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
        <Search size={16} className="shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) { onOpenPerson({ kind: 'teacher', key: hits[0].key, name: hits[0].name }); setOpen(false); }
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="O‘qituvchini toping"
          className="w-full bg-transparent text-[14px] outline-none"
        />
        {loading && <Loader2 size={15} className="shrink-0 animate-spin text-slate-400" />}
        {q && !loading && (
          <button type="button" onClick={() => setQ('')} aria-label="Tozalash"><X size={14} className="text-slate-400" /></button>
        )}
      </div>
      {open && norm(q).length >= 2 && (
        <div className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10">
          {list === null ? (
            <p className="px-4 py-4 text-[14px] text-slate-400">Yuklanmoqda…</p>
          ) : failed ? (
            <div role="alert" className="flex items-center justify-between gap-2 px-4 py-4 text-[14px] text-rose-700">
              <span>O‘qituvchilar ro‘yxatini yuklab bo‘lmadi</span>
              <button
                type="button"
                onClick={() => setRetryTick((n) => n + 1)}
                className="shrink-0 text-[13px] font-semibold underline underline-offset-2 hover:text-rose-900"
              >
                Qayta urinish
              </button>
            </div>
          ) : hits.length === 0 ? (
            <p className="px-4 py-4 text-[14px] text-slate-400">Bu davrda monitorli darsi bor o‘qituvchilar orasida topilmadi</p>
          ) : (
            <ul className="py-1">
              {hits.map((p) => (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => { onOpenPerson({ kind: 'teacher', key: p.key, name: p.name }); setOpen(false); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-indigo-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-slate-900">{p.name}</span>
                      <span className="block truncate text-[12.5px] text-slate-500">{p.subtitle}</span>
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold text-slate-600 rx-num">{p.value}%</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function SmartFilters({
  ranges,
  from,
  to,
  setFrom,
  setTo,
  department,
  setDepartment,
  departments,
  faculties,
  showTeacherFilters,
  filters,
  onOpenPerson,
}: {
  ranges: QuickRange[];
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  department: string;
  setDepartment: (v: string) => void;
  departments: string[];
  faculties: Record<string, string>;
  showTeacherFilters: boolean;
  filters: ReportFilters;
  onOpenPerson: (p: Person) => void;
}) {
  return (
    <div className="ios-card flex flex-wrap items-center gap-2.5 p-2.5">
      <div className="flex flex-wrap gap-0.5 rounded-[14px] bg-slate-100 p-1">
        {ranges.map((r) => {
          const active = r.from() === from && r.to() === to;
          return (
            <button
              key={r.label}
              type="button"
              onClick={() => { setFrom(r.from()); setTo(r.to()); }}
              className={`rounded-[10px] px-3 py-2 text-[14px] font-semibold transition 2xl:px-3.5 ${active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-900'}`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <div className="flex w-full items-center gap-1.5 sm:w-auto">
        <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-[14px] outline-none focus:border-indigo-400 sm:flex-none" aria-label="Boshlanish sanasi" />
        <span className="shrink-0 text-slate-400">—</span>
        <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-[14px] outline-none focus:border-indigo-400 sm:flex-none" aria-label="Tugash sanasi" />
      </div>
      {showTeacherFilters && (
        <>
          <TeacherSearch filters={filters} onOpenPerson={onOpenPerson} />
          {departments.length > 0 && (
            <DepartmentPicker value={department} onChange={setDepartment} departments={departments} faculties={faculties} />
          )}
        </>
      )}
    </div>
  );
}
