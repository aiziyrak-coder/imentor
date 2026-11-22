import { Check, Clock3, Monitor, X } from 'lucide-react';
import type { ControlTeacher, LessonModuleRow } from './rectorApi';
import { PAGE_COLOR, PAGE_LABEL } from './TeacherLessons';

/**
 * Ro'yxat kartasining ichi (2026-11-19, rektor: "material kerak emas — test yaratdi/yaratmadi, keys yaratdi/
 * yaratmadi chiqsin, har bir dars bo'yicha; har bir bo'limga qancha vaqt sarflagani ham; karta kattaroq bo'lsa
 * ham mayli"). Test va keys talabi: dars vaqtida yaratilgan va har biriga kamida 10 daqiqa.
 */

const NEED = 10;
const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];

export function hoursShort(m: number): string {
  if (!m) return '0 daq';
  if (m < 60) return `${m} daq`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} soat ${m % 60} daq` : `${h} soat`;
}

function day(iso: string): string {
  const [, mm, dd] = iso.split('-').map(Number);
  return `${dd}-${MONTHS[(mm || 1) - 1]}`;
}

function Mark({ label, made, minutes }: { label: string; made: boolean; minutes: number }) {
  const ok = made && minutes >= NEED;
  const cls = ok
    ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
    : made
      ? 'bg-amber-50 text-amber-800 ring-amber-300'
      : 'bg-rose-50 text-rose-700 ring-rose-200';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ${cls}`}>
      {made ? <Check size={11} /> : <X size={11} />}
      {label}{made ? ` ${minutes} daq` : ''}
    </span>
  );
}

function LessonLine({ l, many }: { l: LessonModuleRow; many: boolean }) {
  const dot = l.used ? 'bg-emerald-500' : l.misuse ? 'bg-amber-500' : l.minutes > 0 ? 'bg-amber-300' : 'bg-rose-500';
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5" data-testid="work-lesson">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="min-w-[92px] text-[12.5px] font-semibold text-slate-800 rx-num">
        {many ? `${day(l.date)} · ` : ''}{l.para || '—'}{l.start ? ` ${l.start}` : ''}
      </span>
      <span className="text-[12px] text-slate-500 rx-num">{l.minutes} daq</span>
      <span className="ml-auto flex flex-wrap gap-1">
        <Mark label="Test" made={l.test} minutes={l.test_minutes} />
        <Mark label="Keys" made={l.case} minutes={l.case_minutes} />
      </span>
      {l.cycle > 1 && (
        <span className="w-full pl-4 text-[11px] text-slate-500">
          {l.open ? `sikl davom etmoqda (${l.cycle} para) — oxirida baholanadi` : `sikl: ${l.cycle} para birga baholangan`}
        </span>
      )}
    </li>
  );
}

function Count({ label, n, total }: { label: string; n: number; total: number }) {
  const tone = !total ? 'text-slate-400' : n >= total ? 'text-emerald-600' : n > 0 ? 'text-amber-600' : 'text-rose-600';
  return (
    <div className="ios-tile px-2.5 py-2">
      <p className="text-[11.5px] font-medium text-slate-500">{label}</p>
      <p className={`text-[17px] font-bold rx-num ${tone}`}>
        {n}<span className="text-slate-400">/{total}</span>
        <span className="ml-1 text-[11px] font-medium text-slate-400">darsda</span>
      </p>
    </div>
  );
}

function Modules({ modules }: { modules: NonNullable<ControlTeacher['modules']> }) {
  const total = modules.reduce((a, m) => a + m.minutes, 0);
  if (!total) return <p className="text-[12px] text-slate-400">Bo‘limlarda vaqt qayd etilmagan.</p>;
  return (
    <div data-testid="work-modules">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200/80">
        {modules.map((m) => (
          <span key={m.page} className={PAGE_COLOR[m.page] || 'bg-slate-400'} style={{ width: `${(m.minutes / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {modules.map((m) => (
          <li key={m.page} className="flex items-center gap-1.5 text-[12px] text-slate-700">
            <span className={`h-2 w-2 shrink-0 rounded-full ${PAGE_COLOR[m.page] || 'bg-slate-400'}`} aria-hidden />
            <span className="truncate">{PAGE_LABEL[m.page] || m.label || m.page}</span>
            <b className="ml-auto shrink-0 font-semibold text-slate-900 rx-num">{hoursShort(m.minutes)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TeacherWorkCard({ t }: { t: ControlTeacher }) {
  const lessons = t.lesson_modules || [];
  const total = lessons.length;
  const many = new Set(lessons.map((l) => l.date)).size > 1;
  const shown = lessons.slice(0, 6);
  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="ios-tile px-2.5 py-2">
          <p className="flex items-center gap-1 text-[11.5px] font-medium text-slate-500"><Monitor size={12} /> Darslar</p>
          <p className="text-[17px] font-bold text-slate-900 rx-num">
            {t.monitor_used}<span className="text-slate-400">/{t.monitor_lessons}</span>
          </p>
        </div>
        <div className="ios-tile px-2.5 py-2">
          <p className="flex items-center gap-1 text-[11.5px] font-medium text-slate-500"><Clock3 size={12} /> Vaqt</p>
          <p className="truncate text-[15px] font-bold text-slate-900 rx-num">{hoursShort(t.minutes)}</p>
        </div>
        <Count label="Test yaratdi" n={t.test_lessons ?? lessons.filter((l) => l.test).length} total={total} />
        <Count label="Keys yaratdi" n={t.case_lessons ?? lessons.filter((l) => l.case).length} total={total} />
      </div>
      {shown.length > 0 && (
        <div className="rounded-xl bg-slate-50 px-3 py-1 ring-1 ring-slate-100">
          <ul className="divide-y divide-slate-200/70">
            {shown.map((l, i) => <LessonLine key={`${l.date}-${l.para}-${i}`} l={l} many={many} />)}
          </ul>
          {lessons.length > shown.length && (
            <p className="py-1.5 text-[11.5px] text-slate-500">yana {lessons.length - shown.length} ta dars — batafsil ichida</p>
          )}
        </div>
      )}
      <div>
        <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">Bo‘limlarda vaqt</p>
        <Modules modules={t.modules || []} />
      </div>
    </div>
  );
}
