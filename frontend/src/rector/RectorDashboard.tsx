import { dayStarted } from './lessonPhase';
import { AlertTriangle, ChevronRight, Clock3, GraduationCap, Info, Layers, LineChart, Repeat, TrendingDown, TrendingUp, UserX } from 'lucide-react';
import { Ring, type Tone } from './RectorViz';
import type { DrillTarget } from './StatDrill';
import SectionsCard, { type Section } from './SectionsCard';
import type { ControlTeacher } from './rectorApi';
import type { Person } from './PersonPanel';

/**
 * Rektor hisobotining bosh sahifasi — rektor yuborgan maket asosida (2026-11-15).
 *
 * Umumiy natija kartasi (banner rektor talabi bilan olib tashlandi, 2026-11-15),
 * to'rt toifa kartasi, kunlik dinamika grafigi va asosiy ko'rsatkichlar. Raqamlar faqat hisobot
 * qatorlaridan (o'qituvchilar bo'yicha); har karta bosilsa — batafsil ro'yxat.
 */

type Headline = {
  watched_teachers: number;
  teachers_used?: number;
  teacher_percent?: number | null;
  min_lesson_minutes: number;
  teacher_buckets?: { full: number; partial: number; opened: number; none: number };
  pending?: { teachers: number; monitor_lessons: number } | null;
};
type Day = { date: string; teacher_percent?: number | null; teachers?: number };

const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
const dayLabel = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}-${MONTHS[(m || 1) - 1]}`;
};

function Chart({ days }: { days: Array<{ date: string; v: number }> }) {
  // 0–100% shkala; chiziq va maydon SVG'da, nuqta va yozuvlar HTML'da (cho'zilmasin).
  const n = days.length;
  const x = (i: number) => (n === 1 ? 50 : 4 + (92 * i) / (n - 1));
  const y = (v: number) => 100 - v;
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.v)}`).join(' ');
  const area = `${line} L${x(n - 1)},100 L${x(0)},100 Z`;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        {[100, 75, 50, 25, 0].map((t) => (
          <div key={t} className="absolute left-0 right-0 flex items-center gap-2" style={{ top: `${100 - t}%` }}>
            <span className="w-9 -translate-y-1/2 text-right text-[11px] text-slate-400 rx-num">{t}%</span>
            <span className="h-px flex-1 -translate-y-1/2 bg-slate-100" />
          </div>
        ))}
        <div className="absolute inset-y-0 left-11 right-0">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            <defs>
              <linearGradient id="rx-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#rx-area)" />
            <path d={line} fill="none" stroke="#16a34a" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {days.map((d, i) => (
            <span key={d.date} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(i)}%`, top: `${y(d.v)}%` }}>
              <span className="block h-3 w-3 rounded-full border-2 border-white bg-green-600 shadow" />
              {i === n - 1 && (
                <span className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-full bg-green-600 px-2 py-0.5 text-[11.5px] font-bold text-white rx-num">
                  {d.v}%
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
      <div className="relative ml-11 mt-2 h-4">
        {days.map((d, i) => (
          <span key={d.date} className="absolute -translate-x-1/2 whitespace-nowrap text-[11.5px] text-slate-500" style={{ left: `${x(i)}%` }}>
            {dayLabel(d.date)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function RectorDashboard({
  h,
  daily,
  ringTone,
  onDrill,
  graded = 0,
  sections,
  department = '',
  onDepartment,
  teachers,
  onOpenPerson,
  chronic = null,
}: {
  h: Headline;
  daily: Day[];
  ringTone: Tone;
  onDrill: (t: DrillTarget) => void;
  /** HEMIS'da baho bor, iMentor ochilmagan darslar (2026-11-16). */
  graded?: number;
  /** Fakultet → kafedra kesimi (2026-11-16). */
  sections?: Section[];
  department?: string;
  onDepartment?: (value: string) => void;
  teachers?: ControlTeacher[];
  onOpenPerson?: (p: Person) => void;
  /** «Surunkalilar» soni (2026-11-19): oxirgi 30 kunda doimiy muammo; null — yuklanmoqda. */
  chronic?: number | null;
}) {
  const b = h.teacher_buckets;
  const watched = h.watched_teachers || 0;
  const share = (n: number) => (watched ? Math.round((100 * n) / watched) : 0);
  const cats = [
    { metric: 't_full', label: 'Hammasini o‘tgan', drill: 'Hamma darsini iMentor’da o‘tganlar', n: b?.full ?? 0, icon: GraduationCap,
      card: 'from-emerald-50 to-white ring-emerald-100', chip: 'bg-emerald-100 text-emerald-600', num: 'text-emerald-600', bar: 'bg-emerald-400' },
    { metric: 't_opened', label: 'Kirib chiqqan', drill: 'Kirgan, lekin birorta darsni to‘liq o‘tmaganlar', n: b?.opened ?? 0, icon: Clock3,
      card: 'from-amber-50 to-white ring-amber-100', chip: 'bg-amber-100 text-amber-600', num: 'text-amber-600', bar: 'bg-amber-400' },
    // «Dars qoldirgan» (avval «Bir qismini o'tgan») — qaysidir darsini o'tmagan: sariq bilan qizil o'rtasida, to'q sariq (2026-11-19).
    { metric: 't_partial', label: 'Dars qoldirgan', drill: 'Ba’zi darslarini iMentor’da o‘tmaganlar', n: b?.partial ?? 0, icon: Layers,
      card: 'from-orange-50 to-white ring-orange-100', chip: 'bg-orange-100 text-orange-600', num: 'text-orange-600', bar: 'bg-orange-400' },
    { metric: 't_none', label: 'Umuman ochmagan', drill: 'Dars vaqtida iMentor’ni umuman ochmaganlar', n: b?.none ?? 0, icon: UserX,
      card: 'from-rose-50 to-white ring-rose-100', chip: 'bg-rose-100 text-rose-600', num: 'text-rose-600', bar: 'bg-rose-400' },
  ];
  const days = daily
    .filter((d) => typeof d.teacher_percent === 'number' && (d.teachers ?? 0) > 0)
    .map((d) => ({ date: d.date, v: d.teacher_percent as number }));
  const growth = days.length > 1 ? days[days.length - 1].v - days[0].v : null;
  const pct = h.teacher_percent ?? 0;

  return (
    <div className="ios-fill ios-fit flex flex-col gap-3">
      {/* Umumiy natija */}
      <section className="ios-card rx-sum flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <GraduationCap size={28} />
        </span>
        <button type="button" onClick={() => onDrill({ metric: 't_used', label: 'Kamida bitta darsini iMentor’da o‘tganlar' })}
          className="min-w-0 flex-1 text-left">
          <p className="text-[14px] font-medium text-slate-500">Klinik fanlar va nazoratdagi kafedralar · amaliy mashg‘ulot · monitorli xona</p>
          <p className="text-[24px] font-bold leading-tight tracking-tight text-slate-900 xl:text-[26px]">
            {watched} ta o‘qituvchidan <span className="text-emerald-600">{h.teachers_used ?? 0}</span> tasi
          </p>
          <p className="text-[14px] text-slate-500">iMentor’da dars o‘tgan</p>
        </button>
        <span className="hidden h-14 w-px bg-slate-200 md:block" />
        <div className="flex items-center gap-4">
          <Ring value={pct} size={72} stroke={9} tone={ringTone} track="rgba(15,23,42,0.07)" />
          <div>
            <p className="text-[14px] font-medium text-slate-500">Umumiy qamrov</p>
            <p className="text-[34px] font-bold leading-none text-emerald-600 rx-num">{pct}%</p>
          </div>
        </div>
        {graded > 0 && (
          <button type="button" onClick={() => onDrill({ metric: 'graded_not_opened', label: 'HEMIS’da baho bor, iMentor ochilmagan' })}
            className="ml-auto inline-flex transition active:scale-[0.985] items-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-[14px] font-semibold text-white shadow-sm hover:bg-rose-700"
            title="Dars vaqtida iMentor umuman ochilmagan, lekin HEMIS'da shu darsga baho qo'yilgan">
            <AlertTriangle size={16} /> {graded} darsda HEMIS’da baho bor, iMentor ochilmagan <ChevronRight size={16} />
          </button>
        )}
        <details className={`group relative ${graded > 0 ? '' : 'ml-auto'}`}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-rose-50 px-4 py-2 text-[14px] font-semibold text-rose-700 ring-1 ring-rose-100 hover:bg-rose-100">
            <Info size={16} /> Qanday hisoblanadi? <ChevronRight size={16} />
          </summary>
          <ul className="absolute right-0 z-30 mt-2 w-[min(92vw,28rem)] space-y-1.5 rounded-2xl bg-white p-4 text-[14px] leading-relaxed text-slate-600 shadow-2xl ring-1 ring-slate-900/10">
            <li><b className="text-slate-800">Nazoratda</b> — prorektor tasdiqlagan ro‘yxatdagi <b>25 kafedraning</b> (barcha klinik kafedralar, fiziologiya, normal anatomiya, gistologiya, farmakologiya, tibbiy va biologik kimyo, patologik fiziologiya va anatomiya, gigiyena kafedralari, preventiv tibbiyot, epidemiologiya, mikrobiologiya) hamda boshqa kafedralardagi <b>klinik fanlarning</b> <b>amaliy mashg‘ulotlari</b> (amaliy, seminar, klinik mashg‘ulot), faqat <b>monitorli xonada</b>. Ma’ruza, laboratoriya, tillar, ijtimoiy fanlar, biofizika va monitorsiz xonadagi darslar hisobga kirmaydi.</li>
            <li>Qaysi fan klinik va qaysi xonada monitor bor — admin panelidagi «Monitorli xonalar» sahifasida.</li>
            <li>Har o‘qituvchi bitta toifada.</li>
            <li><b className="text-slate-800">Hammasini o‘tgan</b> — har darsida kamida {h.min_lesson_minutes} daqiqa ishlatgan yoki talabalar uning jonli testida qatnashgan.</li>
            <li><b className="text-slate-800">Kirib chiqqan</b> — ochgan, lekin birorta darsni to‘liq o‘tmagan.</li>
            <li>Ketma-ket paralar bitta dars; kasallik/ta’til kunlari hisobga kirmaydi.</li>
          </ul>
        </details>
      </section>

      {/* To'rt toifa */}
      <section className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        {cats.map((c) => {
          const sh = share(c.n);
          return (
            <button key={c.metric} type="button" onClick={() => onDrill({ metric: c.metric, label: c.drill })}
              className={`ios-press rx-cat group relative overflow-hidden rounded-[20px] bg-gradient-to-br p-4 text-left shadow-sm ring-1 ${c.card}`}>
              <span className="flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${c.chip}`}><c.icon size={20} /></span>
                <span className="text-[16px] font-semibold text-slate-800">{c.label}</span>
                <ChevronRight size={18} className="ml-auto text-slate-300 transition group-hover:translate-x-0.5" />
              </span>
              <span className="mt-3 flex items-end justify-between gap-2">
                <span>
                  <span className={`rx-cat-num block text-[40px] font-bold leading-none tracking-tight rx-num ${c.num}`}>{c.n}</span>
                  <span className="mt-1 block text-[14px] text-slate-500">o‘qituvchi · <b className="font-semibold">{sh}%</b></span>
                </span>
                <span className="rx-cat-bars flex h-12 items-end gap-1" aria-hidden>
                  {[0.35, 0.55, 0.75, 1].map((k) => (
                    <span key={k} className={`w-2.5 rounded-t ${c.bar}`} style={{ height: `${Math.max(12, k * Math.max(sh, 8))}%`, opacity: 0.4 + k * 0.6 }} />
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </section>

      {/* Surunkalilar (2026-11-19): to'rt toifadan alohida — davr emas, oxirgi 30 kun; ichida kafedra mas'uli. */}
      <button type="button" data-testid="chronic-card"
        onClick={() => onDrill({ metric: 'chronic', label: 'Surunkalilar — doimiy muammo bo‘layotgan o‘qituvchilar' })}
        className="ios-press group flex shrink-0 items-center gap-4 rounded-[20px] bg-gradient-to-r from-violet-50 via-white to-white px-4 py-3 text-left shadow-sm ring-1 ring-violet-100">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600"><Repeat size={20} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold text-slate-800">Surunkalilar</span>
          <span className="block text-[13px] leading-snug text-slate-500">
            Oxirgi 30 kunda dars kunlarining yarmidan ko‘pida muammo bo‘lgan o‘qituvchilar · har biriga biriktirilgan mas’ul bilan
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[32px] font-bold leading-none tracking-tight text-violet-600 rx-num">{chronic ?? '…'}</span>
          <span className="block text-[13px] text-slate-500">o‘qituvchi</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5" />
      </button>

      {/* Dinamika ("Asosiy ko'rsatkichlar" kartasi rektor talabi bilan olib tashlandi, 2026-11-15) */}
      <section className={`grid min-h-0 flex-1 gap-3 ${sections ? 'lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]' : ''}`}>
        <div className="ios-card rx-low flex min-h-[220px] flex-col p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-[17px] font-bold text-slate-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-500"><LineChart size={17} /></span>
              Darsda ishtirok dinamikasi <span className="font-normal text-slate-400">(kunlar bo‘yicha)</span>
            </h3>
            {growth !== null && (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[14px] font-bold ring-1 ${growth >= 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' : 'bg-rose-50 text-rose-700 ring-rose-100'}`}>
                {growth >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                {growth >= 0 ? '+' : ''}{growth}%
              </span>
            )}
          </div>
          {days.length > 1 ? (
            <Chart days={days} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-center text-[14px] text-slate-400">
              Kunlik dinamika uchun 7 kun yoki undan ko‘p davr tanlang
            </div>
          )}
        </div>
        {sections && <SectionsCard sections={sections} department={department} onDepartment={onDepartment}
          teachers={teachers} onOpenPerson={onOpenPerson} />}
      </section>

      {h.pending && h.pending.monitor_lessons > 0 && (
        <p className="flex shrink-0 items-center gap-2 rounded-2xl bg-sky-50 px-4 py-2 text-[14px] text-sky-900 ring-1 ring-sky-100">
          <Clock3 size={16} className="shrink-0 text-sky-500" />
          <span>
            {dayStarted()
              ? <><b>{h.pending.teachers}</b> ta o‘qituvchining bugungi darsi hali tugamagan — tugagach qo‘shiladi.</>
              : <>Bugungi darslar hali boshlanmagan — <b>{h.pending.teachers}</b> ta o‘qituvchining darsi kun davomida, tugagani sari qo‘shiladi.</>}
          </span>
        </p>
      )}
    </div>
  );
}
