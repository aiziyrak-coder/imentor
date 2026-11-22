import { useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, Check, ChevronRight, Clock3, Hourglass, Laptop, Minus, Monitor, Users, X } from 'lucide-react';
import type { ScheduledLessonRow } from './rectorApi';
import { lessonPhase } from './lessonPhase';

/**
 * O'qituvchining darslari — kunma-kun, HAR BIR dars alohida karta (2026-11-14).
 *
 * Rektor: "qaysi kun, qaysi para, qaysi bo'limda qancha ishlatgani ko'rinmayapti, tushunarli qiling".
 * Ilgari darslar yopiq qatorlar edi, ichida inglizcha bo'lim nomlari va "qayd №" ro'yxati.
 * Endi har kartada birinchi qarashda: holat, necha daqiqa (40 daqiqa chizig'i bilan),
 * qaysi bo'limda qancha vaqt, mavzu va testda qatnashgan talabalar.
 */

export const NEED_MINUTES = 40;

/** "1 soat 58 daq" — rektor uchun qisqartmasiz. */
export function hoursText(m: number): string {
  if (!m) return '0 daq';
  if (m < 60) return `${m} daq`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} soat ${m % 60} daq` : `${h} soat`;
}

/** Sahifa kalitlari → o'zbekcha nom (server `MODULE_LABEL` bilan bir xil). */
export const PAGE_LABEL: Record<string, string> = {
  syllabus: 'Sillabus',
  lectures: 'Ma’ruza matni',
  presentation: 'Taqdimot',
  videos: 'Video',
  handouts: 'Tarqatma',
  cases: 'Keys',
  tests: 'Test',
  'my-tests': 'Mening testlarim',
  'content-catalog': 'Materiallar katalogi',
  profile: 'Profil',
  dashboard: 'Bosh sahifa',
  other: 'Boshqa',
};

export const PAGE_COLOR: Record<string, string> = {
  presentation: 'bg-violet-500',
  videos: 'bg-orange-500',
  tests: 'bg-indigo-500',
  'my-tests': 'bg-indigo-400',
  lectures: 'bg-sky-500',
  cases: 'bg-rose-500',
  handouts: 'bg-teal-500',
  syllabus: 'bg-slate-400',
};

export type LessonState = 'done' | 'misuse' | 'short' | 'none' | 'pending' | 'excused' | 'free';

/** Dars holati — bitta so'z bilan. */
export function lessonState(l: ScheduledLessonRow): LessonState {
  if (l.absence) return 'excused';
  if (l.pending) return 'pending';
  if (l.used) return 'done';
  if (!l.monitor_id || l.counted === false) return 'free';
  // 40 daqiqa ishlagan, lekin test/keys yo'q yoki ularga kam vaqt — sariq, yashil emas (2026-11-19).
  if (l.verdict === 'misuse') return 'misuse';
  // Faqat guruh talabalari faol, o'qituvchi o'zi kirmagan — chala, yashil emas (2026-11-17).
  return (l.minutes ?? 0) > 0 || l.verdict === 'short' || l.verdict === 'group' ? 'short' : 'none';
}

const LOOK: Record<LessonState, { label: string; card: string; badge: string; icon: typeof Check }> = {
  done: { label: 'O‘tilgan', card: 'ring-emerald-200 bg-white', badge: 'bg-emerald-600 text-white', icon: Check },
  misuse: { label: 'Noto‘g‘ri foydalangan', card: 'ring-amber-300 bg-amber-50/50', badge: 'bg-amber-500 text-white', icon: AlertTriangle },
  short: { label: 'Chala', card: 'ring-amber-300 bg-amber-50/50', badge: 'bg-amber-500 text-white', icon: Hourglass },
  none: { label: 'Kirmagan', card: 'ring-rose-300 bg-rose-50/60', badge: 'bg-rose-600 text-white', icon: X },
  pending: { label: 'Hali tugamagan', card: 'ring-sky-200 bg-white', badge: 'bg-sky-600 text-white', icon: Clock3 },
  excused: { label: 'Uzrli', card: 'ring-slate-200 bg-slate-50', badge: 'bg-slate-500 text-white', icon: Minus },
  free: { label: 'Hisobga kirmaydi', card: 'ring-slate-200 bg-slate-50', badge: 'bg-slate-200 text-slate-700', icon: Minus },
};

/** Holat ostidagi bitta jumla — nega shunday. */
function reason(l: ScheduledLessonRow, state: LessonState): string {
  const min = l.minutes ?? 0;
  switch (state) {
    case 'done':
      if (l.verdict === 'block') return `Ketma-ket ${l.block_size || 2} paraning boshqasida o‘tilgan — shu sabab bu para ham hisoblandi.`;
      if (l.verdict === 'students') {
        return min >= NEED_MINUTES
          ? `iMentor’da ${min} daqiqa ishlagan (kerak: ${NEED_MINUTES}), talabalar uning jonli testida qatnashgan.`
          : `${min > 0 ? `O‘zi ${min} daqiqa ishlagan` : 'O‘zi kam ishlagan'}; talabalar uning jonli testida qatnashgani uchun dars o‘tilgan hisoblandi.`;
      }
      return `iMentor’da ${min} daqiqa ishlangan (kerak: ${NEED_MINUTES}).`;
    case 'misuse':
      return `iMentor’da ${min} daqiqa ishlagan, lekin ${moduleGapsText(l)}.`;
    case 'short':
      if (l.verdict === 'group' && min === 0) {
        return 'O‘qituvchi dars vaqtida iMentor’ga kirmagan — faqat guruh talabalari faol bo‘lgan. Shu sabab dars o‘tilgan hisoblanmadi.';
      }
      return min > 0
        ? `Kirgan, lekin ${min} daqiqa ishlagan — ${NEED_MINUTES} daqiqaga ${NEED_MINUTES - min} daqiqa yetmagan.`
        : 'Kirib chiqqan — 1 daqiqadan kam ishlagan.';
    case 'none':
      return 'Dars vaqtida iMentor umuman ochilmagan.';
    case 'pending':
      return lessonPhase(l.date, l.start_time, l.end_time) === 'upcoming'
        ? `Dars soat ${l.start_time} da boshlanadi — tugagach baholanadi.`
        : `Dars davom etmoqda, ${l.end_time} da tugaydi — tugagach baholanadi.`;
    case 'excused':
      return `${l.absence?.label || 'Uzrli sabab'} — admin tasdiqlagan, foizga kirmaydi.`;
    default:
      return l.counted === false
        ? `${l.lesson_type || 'Ma’ruza'} — foizga kirmaydi.`
        : 'Xonada monitor yo‘q — iMentor majburiy emas.';
  }
}

/** Nima yetishmadi — bitta jumla ("test yaratilmagan, keysga atigi 4 daqiqa (kerak: 10)"). */
export function moduleGapsText(l: ScheduledLessonRow): string {
  const md = l.modules;
  if (!md || !md.gaps.length) return 'test va keys talabi bajarilmagan';
  const parts = md.gaps.map((g) => {
    if (g === 'test') return 'test yaratilmagan';
    if (g === 'case') return 'keys yaratilmagan';
    if (g === 'test_time') return `testga atigi ${md.test_minutes} daqiqa (kerak: ${md.need_test})`;
    return `keysga atigi ${md.case_minutes} daqiqa (kerak: ${md.need_case})`;
  });
  return parts.join(', ') + (md.cycle > 1 ? ` — ${md.cycle} paralik sikl bo‘yicha` : '');
}

function ModuleChips({ md }: { md: NonNullable<ScheduledLessonRow['modules']> }) {
  const chip = (label: string, made: boolean, minutes: number, need: number) => {
    const ok = made && minutes >= need;
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${ok ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-amber-300'}`}>
        {made ? <Check size={11} /> : <X size={11} />}
        {label}{made ? ` · ${minutes} daq` : ' yaratilmagan'}
      </span>
    );
  };
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1" data-testid="lesson-modules">
      {chip('Test', md.test, md.test_minutes, md.need_test)}
      {chip('Keys', md.case, md.case_minutes, md.need_case)}
      {md.cycle > 1 && (
        <span className="text-[11px] text-slate-500">
          {md.open ? `sikl davom etmoqda (${md.cycle} para) — test va keys sikl oxirida tekshiriladi` : `sikl: ${md.cycle} para birga`}
        </span>
      )}
    </div>
  );
}

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
function dayTitle(iso: string, weekday: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}-${MONTHS[(m || 1) - 1]}${weekday ? `, ${weekday.toLowerCase()}` : ''}`;
}

/**
 * Bo'limlar bo'yicha daqiqa (kamayish tartibida, 1 daqiqadan kamlari tashlanadi).
 * Ikki oyna/qurilmada bir vaqtda ochilgan bo'lsa bo'limlar yig'indisi dars daqiqasidan oshadi —
 * shunda ular dars daqiqasiga mutanosib keltiriladi: kartadagi raqamlar bir-biriga mos bo'lsin.
 */
export function lessonPages(l: ScheduledLessonRow): Array<{ page: string; label: string; minutes: number; opens: number }> {
  const raw = (l.evidence?.pages || []).filter((p) => p.seconds > 0);
  const total = raw.reduce((a, p) => a + p.seconds, 0) / 60;
  const cap = l.minutes ?? total;
  const k = total > cap && total > 0 ? cap / total : 1;
  return raw
    .map((p) => ({ page: p.page, label: PAGE_LABEL[p.page] || p.page, minutes: Math.round((p.seconds / 60) * k), opens: p.opens }))
    .filter((p) => p.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

function MinutesBar({ minutes, pages }: { minutes: number; pages: ReturnType<typeof lessonPages> }) {
  // Shkala 80 daqiqa (bir para); 40 daqiqa chizig'i — "o'tilgan" chegarasi.
  const scale = 80;
  const total = pages.reduce((a, p) => a + p.minutes, 0);
  const width = Math.min(100, (minutes / scale) * 100);
  return (
    <div className="relative mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-200/80">
      <div className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full" style={{ width: `${width}%` }}>
        {total > 0
          ? pages.map((p) => (
              <span key={p.page} className={PAGE_COLOR[p.page] || 'bg-slate-500'} style={{ width: `${(p.minutes / total) * 100}%` }} />
            ))
          : <span className="w-full bg-slate-500" />}
      </div>
      <span className="absolute inset-y-[-2px] w-[2px] bg-slate-700/70" style={{ left: `${(NEED_MINUTES / scale) * 100}%` }} title={`${NEED_MINUTES} daqiqa chegarasi`} />
    </div>
  );
}

function LessonCard({ l, onOpen }: { l: ScheduledLessonRow; onOpen?: (l: ScheduledLessonRow) => void }) {
  const state = lessonState(l);
  if (state === 'free' && !(l.minutes ?? 0)) {
    // Hisobga kirmaydigan dars — bitta kulrang qator (2026-11-15).
    return (
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-500 ring-1 ring-slate-100" data-state={state}>
        <span className="w-[62px] shrink-0 text-center font-bold text-slate-600">{l.para}</span>
        <span className="min-w-0 flex-1 truncate" title={l.subject}>{l.subject || '—'} · {l.group || '—'} · {l.room || '—'}</span>
        <span className="hidden shrink-0 text-[11.5px] sm:inline">{reason(l, state)}</span>
      </div>
    );
  }
  const phase = state === 'pending' ? lessonPhase(l.date, l.start_time, l.end_time) : 'over';
  if (phase === 'upcoming') {
    // Hali boshlanmagan dars — ko'rsatadigan narsa yo'q: bitta kulrang qator, bosilmaydi (2026-11-16).
    return (
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-500 ring-1 ring-slate-100" data-state={state} data-phase="upcoming">
        <span className="w-[62px] shrink-0 text-center font-bold text-slate-600">{l.para}</span>
        <span className="min-w-0 flex-1 truncate" title={l.subject}>{l.subject || '—'} · {l.group || '—'} · {l.room || '—'}</span>
        <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[11.5px] font-semibold text-slate-600">Hali boshlanmagan · {l.start_time} da</span>
      </div>
    );
  }
  const look = state === 'pending' ? { ...LOOK.pending, label: 'Dars davom etmoqda' } : LOOK[state];
  const pages = lessonPages(l);
  const min = l.minutes ?? 0;
  return (
    <div
      className={`rounded-2xl p-3 ring-1 ${look.card} ${onOpen ? 'cursor-pointer transition hover:shadow-md hover:ring-indigo-300' : ''}`}
      data-state={state}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? () => onOpen(l) : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(l); } } : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="w-[62px] shrink-0 text-center">
          <p className="text-[15px] font-extrabold leading-none text-slate-900">{l.para.replace('-para', '')}<span className="text-[10px] font-bold text-slate-500">-para</span></p>
          <p className="mt-1 text-[10.5px] tabular-nums text-slate-500">{l.start_time}–{l.end_time}</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${look.badge}`}>
              <look.icon size={11} strokeWidth={3} /> {look.label}
            </span>
            {state !== 'pending' && state !== 'excused' && state !== 'none' && (
              <span className="text-[13px] font-extrabold tabular-nums text-slate-900">{min} daqiqa</span>
            )}
            {l.students > 0 && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-indigo-700">
                <Users size={12} /> testda {l.students} talaba
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-[13px] font-semibold text-slate-800" title={l.subject}>{l.subject || '—'}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-slate-500">
            <span>{l.group || '—'}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              {l.monitor_id ? <Monitor size={11} className="text-sky-600" /> : <Laptop size={11} />}
              {l.room || '—'}
            </span>
            {l.lesson_type && <><span>·</span><span>{l.lesson_type}</span></>}
          </p>
          {l.topics && l.topics.length > 0 && (
            <p className="mt-1 flex items-start gap-1 text-[12px] text-indigo-800">
              <BookOpen size={12} className="mt-[2px] shrink-0" />
              <span><b>Mavzu:</b> <span>{l.topics.join(' · ')}</span></span>
            </p>
          )}
          <p className={`mt-1 text-[12px] ${state === 'none' ? 'text-rose-800' : state === 'short' || state === 'misuse' ? 'text-amber-800' : 'text-slate-600'}`}>
            {reason(l, state)}
          </p>
          {l.modules && (state === 'done' || state === 'misuse') && <ModuleChips md={l.modules} />}
          {(state === 'done' || state === 'short' || state === 'misuse' || (state === 'free' && min > 0)) && (
            <>
              <MinutesBar minutes={min} pages={pages} />
              {pages.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {pages.map((p) => (
                    <span key={p.page} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-700 ring-1 ring-slate-200">
                      <span className={`h-2 w-2 rounded-full ${PAGE_COLOR[p.page] || 'bg-slate-500'}`} />
                      {p.label} <b className="tabular-nums">{p.minutes} daq</b>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {onOpen && <ChevronRight size={18} className="mt-1 shrink-0 text-slate-300" />}
      </div>
    </div>
  );
}

type Filter = 'counted' | 'missed' | 'all';

const COUNTED: LessonState[] = ['done', 'misuse', 'short', 'none', 'pending', 'excused'];
const DOT: Record<LessonState, string> = {
  done: 'bg-emerald-500', misuse: 'bg-amber-500', short: 'bg-amber-400', none: 'bg-rose-500', pending: 'bg-sky-400', excused: 'bg-slate-400', free: 'bg-slate-300',
};

export type LessonCounts = Record<LessonState, number>;

export function countLessons(lessons: ScheduledLessonRow[]): LessonCounts {
  const c: LessonCounts = { done: 0, misuse: 0, short: 0, none: 0, pending: 0, excused: 0, free: 0 };
  for (const l of lessons) c[lessonState(l)] += 1;
  return c;
}

/** Baholanadigan darslardan o'tilganlar ulushi (tugamagan va uzrlilar kirmaydi). */
export function lessonPercent(c: LessonCounts): number | null {
  const base = c.done + c.misuse + c.short + c.none;
  return base ? Math.round((100 * c.done) / base) : null;
}

/** Bitta jumlali xulosa — rektor birinchi o'qiydigan qator. */
export function lessonVerdict(c: LessonCounts): string {
  const base = c.done + c.misuse + c.short + c.none;
  if (!base) return c.pending ? 'Bugungi darslari hali tugamagan yoki boshlanmagan — tugagach baholanadi.' : 'Bu davrda nazoratdagi (monitorli xonadagi) darsi yo‘q.';
  if (c.done === base) return `Nazoratdagi ${base} ta darsining hammasini iMentor’da o‘tgan.`;
  const bad = [c.none && `${c.none} tasida umuman ochmagan`, c.short && `${c.short} tasini chala o‘tgan`,
    c.misuse && `${c.misuse} tasida test/keys yaratmagan yoki ularga kam vaqt ajratgan`].filter(Boolean).join(', ');
  return `Nazoratdagi ${base} ta darsidan ${c.done} tasini iMentor’da o‘tgan — ${bad}.`;
}

export default function TeacherLessons({ lessons, onOpen, lead }: {
  lessons: ScheduledLessonRow[]; onOpen?: (l: ScheduledLessonRow) => void;
  /** Filtr qatorining chap tomoniga qo'yiladigan tugmalar (masalan, «Darslar / Dalillar jadvali»). */
  lead?: React.ReactNode;
}) {
  const counts = useMemo(() => countLessons(lessons), [lessons]);
  const missed = counts.short + counts.misuse + counts.none;
  const counted = lessons.length - counts.free;
  // Asosiy ko'rinish — faqat nazoratdagi darslar; monitorsiz/ma'ruza darslari "Hammasi"da (2026-11-15).
  const [filter, setFilter] = useState<Filter>(counted ? 'counted' : 'all');
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const allDays = useMemo(() => {
    const map = new Map<string, ScheduledLessonRow[]>();
    for (const l of lessons) map.set(l.date, [...(map.get(l.date) || []), l]);
    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [lessons]);
  const shown = lessons.filter((l) => {
    const st = lessonState(l);
    if (pickedDay && l.date !== pickedDay) return false;
    if (filter === 'missed') return st === 'short' || st === 'misuse' || st === 'none';
    if (filter === 'counted') return COUNTED.includes(st);
    return true;
  });
  const days = useMemo(() => {
    const map = new Map<string, ScheduledLessonRow[]>();
    for (const l of shown) map.set(l.date, [...(map.get(l.date) || []), l]);
    return [...map.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
  }, [shown]);

  if (!lessons.length) {
    return <>{lead && <div className="mb-3">{lead}</div>}<p className="rounded-2xl bg-white px-4 py-6 text-center text-[14px] text-slate-500 ring-1 ring-slate-900/[0.06]">Bu davrda HEMIS jadvalida darsi yo‘q.</p></>;
  }
  const tabs: Array<[Filter, string, number]> = [
    ['counted', 'Nazoratdagi', counted],
    ['missed', 'O‘tilmaganlar', missed],
    ['all', 'Hammasi', lessons.length],
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {lead}
        <div className="flex gap-1 rounded-xl bg-slate-900/[0.06] p-1 text-[13px] font-semibold">
          {tabs.map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-lg px-3 py-1.5 transition ${filter === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              {label} · {n}
            </button>
          ))}
        </div>
      </div>
      {/* Kunlar xaritasi: har nuqta — bitta dars. Kun bosilsa faqat shu kun qoladi. */}
      {allDays.length > 1 && (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {allDays.map(([date, rows]) => {
            const [, m, d] = date.split('-').map(Number);
            const on = pickedDay === date;
            return (
              <button
                key={date}
                type="button"
                onClick={() => setPickedDay(on ? null : date)}
                className={`min-w-[64px] shrink-0 rounded-xl px-2 py-1.5 text-center ring-1 transition ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-200 hover:ring-indigo-300'}`}
                title={dayTitle(date, rows[0].weekday)}
              >
                <span className="block text-[12px] font-bold">{d}.{String(m).padStart(2, '0')}</span>
                <span className={`block text-[10.5px] ${on ? 'text-indigo-100' : 'text-slate-400'}`}>{(rows[0].weekday || '').slice(0, 3)}</span>
                <span className="mt-1 flex flex-wrap justify-center gap-[3px]">
                  {[...rows].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')).map((l) => (
                    <span key={l.id} className={`h-2 w-2 rounded-full ${l.pending && lessonPhase(l.date, l.start_time, l.end_time) === 'upcoming' ? 'bg-slate-300' : DOT[lessonState(l)]} ${on ? 'ring-1 ring-white/70' : ''}`} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {pickedDay && (
        <button type="button" onClick={() => setPickedDay(null)} className="mb-2 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-[12px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
          <X size={12} /> Faqat {dayTitle(pickedDay, '')} — barcha kunlarni ko‘rsatish
        </button>
      )}
      {!days.length && (
        <p className="rounded-2xl bg-emerald-50 px-4 py-6 text-center text-[14px] font-medium text-emerald-800 ring-1 ring-emerald-200">
          {filter === 'missed' ? 'O‘tilmagan darsi yo‘q.' : 'Bu tanlovda dars yo‘q.'}
        </p>
      )}
      <div className="space-y-4">
        {days.map(([date, rows]) => {
          const done = rows.filter((l) => lessonState(l) === 'done').length;
          const bad = rows.filter((l) => ['short', 'misuse', 'none'].includes(lessonState(l))).length;
          return (
            <section key={date}>
              <h4 className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
                <span className="text-[14px] font-extrabold text-slate-900">{dayTitle(date, rows[0].weekday)}</span>
                <span className="text-[12px] text-slate-500">
                  {rows.length} dars{done ? ` · ${done} o‘tilgan` : ''}{bad ? ' · ' : ''}{bad ? <b className="text-rose-700">{bad} o‘tilmagan</b> : null}
                </span>
              </h4>
              <div className="space-y-1.5">
                {[...rows].sort((a, b) => (a.start_time || a.para).localeCompare(b.start_time || b.para)).map((l) => (
                  <LessonCard key={l.id} l={l} onOpen={onOpen} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
