import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Download, Search, X } from 'lucide-react';
import { fetchControlPeople, type AbsenceProof, type ControlPeople, type ControlTeacher, type ReportFilters } from './rectorApi';
import { Spinner } from './RectorUi';
import type { Person } from './PersonPanel';
import type { DrillTarget } from './StatDrill';
import { Avatar } from './RectorViz';
import TeacherWorkCard from './TeacherWorkCard';
import ChronicBlock, { ChronicRule } from './Chronic';
import { downloadCsv, safeFileName } from './csv';
import './rector.css';

/**
 * Raqam yoki xulosa ortidagi odamlar — TO'LIQ SAHIFA (2026-11-15).
 *
 * Rektor: "har birini ichiga kirganda ma'lumot chiqsin". Ilgari o'rtada kichik oynacha (ism + son)
 * edi. Endi butun sahifa: har o'qituvchi alohida kartada — holati, monitorli darslari, iMentor'dagi
 * vaqti, yaratgan materiali; bosilsa batafsil hisoboti ochiladi. Ro'yxat serverdan (raqam bilan bir
 * manba), qo'shimcha ma'lumot esa sahifadagi hisobot qatorlaridan olinadi.
 */

const STATE: Record<string, { label: string; cls: string }> = {
  full: { label: 'Hammasini o‘tgan', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  partial: { label: 'Dars qoldirgan', cls: 'bg-orange-50 text-orange-700 ring-orange-200' },
  opened: { label: 'Kirib chiqqan', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  misuse: { label: 'Noto‘g‘ri foydalangan', cls: 'bg-amber-50 text-amber-800 ring-amber-300' },
  none: { label: 'Umuman ochmagan', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
  on_leave: { label: 'Ta’tilda', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  unlinked: { label: 'Hisobi bog‘lanmagan', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  offsite: { label: 'Monitorsiz joyda', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

function when(iso: string): string {
  const d = new Date(iso);
  const t = d.toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });
  return `${Number(t.slice(8, 10))}-${MONTHS[Number(t.slice(5, 7)) - 1]}`;
}

function hm(iso: string): string {
  return new Date(iso).toLocaleTimeString('uz-UZ', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' });
}

/** «Umuman ochmagan» — kartochkadagi dalillar (2026-11-16): «0 daqiqa» emas, nima uchun 0 ekanining isboti. */
export function ProofLines({ p, from }: { p: AbsenceProof; from: string }) {
  const days = p.last_before ? Math.round((new Date(`${from}T00:00:00+05:00`).getTime() - new Date(p.last_before).getTime()) / 86_400_000) : null;
  const lines: Array<{ bad: boolean; text: string }> = [
    p.events === 0
      ? { bad: true, text: 'Shu davrda hisobida bitta ham qayd yo‘q — kirmagan' }
      : { bad: true, text: `Shu davrda ${p.events} ta qayd (birinchisi ${hm(p.first || '')}), lekin dars vaqtida ishlamagan` },
    { bad: true, text: `QR bilan xona kompyuteriga ulanish: ${p.qr ? `${p.qr} marta` : 'yo‘q'} · jonli test: ${p.live_tests || 'yo‘q'}` },
    p.last_before
      ? { bad: (days ?? 0) > 3, text: `Oxirgi marta iMentor’da: ${when(p.last_before)}${days && days > 0 ? ` (${days} kun oldin)` : ''}` }
      : { bad: true, text: 'iMentor’da hech qachon ishlamagan' },
  ];
  if (p.rooms) {
    lines.push(p.rooms_working
      ? { bad: false, text: `Xona monitori ishlagan: ${p.rooms_working}/${p.rooms} xonasida boshqa o‘qituvchilar shu davrda iMentor’da dars o‘tgan` }
      : { bad: false, text: `Shu davrda uning xonasida boshqa o‘qituvchining iMentor bilan o‘tilgan darsi hali yo‘q — xona haqida xulosa yo‘q` });
  }
  return (
    <ul className="mt-3 space-y-1 rounded-xl bg-rose-50/60 px-3 py-2 text-[12.5px] leading-snug ring-1 ring-rose-100">
      {lines.map((l, i) => (
        <li key={i} className={`flex gap-1.5 ${l.bad ? 'text-rose-900' : 'text-slate-700'}`}>
          <span className="shrink-0">{l.bad ? '✕' : '✓'}</span>
          <span>{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

export default function DrillPage({
  target,
  filters,
  teachers,
  onOpenPerson,
  onBack,
}: {
  target: DrillTarget;
  filters: ReportFilters;
  /** Sahifadagi hisobot qatorlari — kartadagi qo'shimcha ma'lumot uchun. */
  teachers: ControlTeacher[];
  onOpenPerson: (p: Person) => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<ControlPeople | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    fetchControlPeople(filters, target.metric)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError('Ro‘yxatni yuklab bo‘lmadi.'));
    return () => {
      alive = false;
    };
  }, [target.metric, filters.from, filters.to, filters.department]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onBack();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onBack]);

  const byKey = useMemo(() => new Map(teachers.map((t) => [t.teacher_key, t])), [teachers]);
  const needle = q.trim().toLowerCase();
  // Javobda ro'yxat bo'lmasa ham sahifa oqarib qolmasin.
  const people = useMemo(() => (Array.isArray(data?.people) ? data!.people : []), [data]);
  const total = typeof data?.total === 'number' ? data.total : people.length;
  const rows = useMemo(
    () => people.filter((p) => !needle || `${p.name} ${p.subtitle} ${p.chronic ? p.note : ''}`.toLowerCase().includes(needle)),
    [people, needle],
  );
  const title = target.label || data?.title || '…';

  return (
    <div className="rx-rise space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="ios-press inline-flex items-center gap-1 rounded-full bg-white px-3.5 py-2 text-[15px] font-semibold text-indigo-600 shadow-sm ring-1 ring-slate-200"
        >
          <ArrowLeft size={17} /> Orqaga
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[22px] font-bold tracking-tight text-slate-900">{title}</h2>
          <p className="text-[14px] text-slate-500 rx-num">{data ? `${total} ta` : 'yuklanmoqda…'}</p>
        </div>
        {people.length > 0 && (
          <>
            <div className="flex w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 sm:w-72">
              <Search size={16} className="shrink-0 text-slate-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={data?.window ? 'Familiya, kafedra yoki mas’ul' : 'Familiya yoki kafedra'}
                className="w-full bg-transparent py-2 text-[14px] outline-none"
              />
              {q && (
                <button type="button" onClick={() => setQ('')} aria-label="Tozalash">
                  <X size={14} className="text-slate-400" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  safeFileName(`${title}_${filters.from}_${filters.to}`),
                  data?.window
                    ? ['F.I.Sh.', 'Kafedra', 'Mas’ul', 'Muammoli kun', 'Dars kuni', 'Foiz', 'Ochmagan', 'Kirib chiqqan',
                      'Test/keyssiz', 'Ketma-ket', 'Oxirgi yaxshi kun']
                    : ['F.I.Sh.', 'Kafedra', 'Qiymat', 'Birlik', 'Izoh'],
                  rows.map((p) => (p.chronic
                    ? [p.name, p.subtitle, p.chronic.responsible.map((r) => r.name).join(', ') || '—', p.chronic.bad_days,
                      p.chronic.lesson_days, `${p.chronic.share}%`, p.chronic.none_days, p.chronic.short_days,
                      p.chronic.misuse_days, p.chronic.streak, p.chronic.last_ok || '—']
                    : [p.name, p.subtitle, p.value, p.value_label, p.note])),
                )
              }
              className="ios-press inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[14px] font-semibold text-emerald-700 shadow-sm ring-1 ring-slate-200"
            >
              <Download size={15} /> Excel
            </button>
          </>
        )}
      </div>

      {data?.window && <ChronicRule w={data.window} />}

      {error ? (
        <p className="ios-card px-5 py-6 text-center text-[15px] text-rose-700">{error}</p>
      ) : !data ? (
        <div className="py-16"><Spinner /></div>
      ) : rows.length === 0 ? (
        <p className="ios-card px-5 py-10 text-center text-[15px] text-slate-500">
          {people.length === 0 ? 'Bu ko‘rsatkichda hech kim yo‘q.' : 'Topilmadi.'}
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {rows.map((p) => {
            const t = byKey.get(p.key);
            // 40 daqiqa ishlagan, lekin test/keys yo'q — «kirib chiqqan» emas, «noto'g'ri foydalangan» (2026-11-19).
            const st = t?.state === 'opened' && (t.misuse_lessons ?? 0) > 0 && !(t.short_lessons ?? 0)
              ? STATE.misuse
              : t?.state ? STATE[t.state] : null;
            const openable = (p.kind === 'teacher' || p.kind === 'student') && !p.key.startsWith('name:');
            const body = (
              <>
                <div className="flex items-start gap-3">
                  <Avatar name={p.name} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-semibold text-slate-900">{p.name}</p>
                    <p className="truncate text-[13px] text-slate-500">{p.subtitle || '—'}</p>
                  </div>
                  {openable && <ChevronRight size={18} className="mt-1 shrink-0 text-slate-300" />}
                </div>
                {st && (
                  <span className={`mt-3 inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ${st.cls}`}>
                    {st.label}
                  </span>
                )}
                {p.chronic ? (
                  // Surunkali: o'z 30 kunlik oynasi — tanlangan davr kartasi (TeacherWorkCard) bu yerda chalg'itadi.
                  <ChronicBlock c={p.chronic} />
                ) : t ? (
                  <TeacherWorkCard t={t} />
                ) : (
                  <p className="mt-3 text-[14px] text-slate-600">
                    <b className="text-slate-900 rx-num">{p.value}</b> {p.value_label}
                  </p>
                )}
                {p.proof && <ProofLines p={p.proof} from={filters.from} />}
                {p.note && !p.chronic && <p className="mt-2 text-[13px] font-medium text-amber-700">{p.note}</p>}
              </>
            );
            return (
              <li key={`${p.kind}:${p.key}`}>
                {openable ? (
                  <button
                    type="button"
                    onClick={() => onOpenPerson({ kind: p.kind as 'teacher' | 'student', key: p.key, name: p.name })}
                    className="ios-card ios-press block h-full w-full p-4 text-left"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="ios-card h-full p-4">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
