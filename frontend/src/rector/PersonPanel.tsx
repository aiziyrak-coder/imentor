import { useEffect, useState } from 'react';
import {
  BookOpen,
  Building2,
  Check,
  FileText,
  GraduationCap,
  ListChecks,
  Minus,
  Presentation,
  Radio,
  Sparkles,
  Stethoscope,
  UserRound,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  fetchControlStudent,
  fetchControlTeacher,
  type ReportFilters,
  type ControlStudentDetail,
  type ControlTeacherDetail,
  type ScheduledLessonRow,
} from './rectorApi';
import { Spinner } from './RectorUi';
import { RoomTable } from './ControlReport';
import LessonDetail from './LessonDetail';
import TeacherDossier from './TeacherDossier';
import TeacherLessons, { countLessons, lessonPercent, lessonVerdict, NEED_MINUTES } from './TeacherLessons';
import { Avatar, Meter, Pill, Ring, TONE, toneOf, type Tone } from './RectorViz';
import './rector.css';

/**
 * Ism bosilganda ekran o'rtasida ochiladigan batafsil oyna (2026-09-25; 2026-11-15 dan o'rtada).
 * O'qituvchi uchun — har bir darsi va materiallari; talaba uchun — har bir testi.
 */

export type Person = { kind: 'teacher' | 'student'; key: string; name: string };

/** Profil bandlari — server kalitlari uchun nom. */
const PROFILE_LABEL: Record<string, string> = {
  photo: 'Surat',
  department: 'Kafedra',
  job_title: 'Lavozim',
  subject: 'Fan biriktirilgan',
  face: 'Yuz ro‘yxatda',
};

function day(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' });
}

/** Panel ichidagi bo'lim sarlavhasi — rangli ikonka bilan. */
function Head({ icon: Icon, tone = 'indigo', children }: { icon: LucideIcon; tone?: Tone; children: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-slate-500">
      <span className={`flex h-6 w-6 items-center justify-center rounded-lg shadow-sm ${TONE[tone].chip}`}>
        <Icon size={13} />
      </span>
      {children}
    </h3>
  );
}

/** Yaratilgan material turi — ikonka va rang. */
const CREATED_LOOK: Record<string, { icon: LucideIcon; tone: Tone }> = {
  tests: { icon: ListChecks, tone: 'indigo' },
  cases: { icon: Stethoscope, tone: 'rose' },
  lectures: { icon: BookOpen, tone: 'sky' },
  presentations: { icon: Presentation, tone: 'violet' },
  handouts: { icon: FileText, tone: 'teal' },
  videos: { icon: Video, tone: 'orange' },
  live_sessions: { icon: Radio, tone: 'emerald' },
};

const DEPTH_PILL: Record<string, Tone> = { worked: 'emerald', viewed: 'amber', visit: 'orange', none: 'rose' };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[12.5px] text-slate-500">{label}</span>
      <span className="text-right text-[13px] font-medium text-slate-800">{value}</span>
    </div>
  );
}

function Side({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06]">
      <h3 className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

/**
 * O'qituvchi oynasi (2026-11-15, qayta qurildi): tepada bitta xulosa va 3 raqam,
 * chapda darslar (kunlar xaritasi + kartalar), o'ngda yaratgani, fanlari va profili.
 * "Qaysi bo'limda qancha" umumiy ro'yxati olib tashlandi — har darsning o'z kartasida bor.
 */
function TeacherBody({ data, onOpen, filters, view, setView }: {
  data: ControlTeacherDetail; onOpen: (l: ScheduledLessonRow) => void; filters: ReportFilters;
  view: 'lessons' | 'dossier'; setView: (v: 'lessons' | 'dossier') => void;
}) {
  const e = data.engagement;
  const m = data.materials;
  const pc = data.profile_check;
  const sm = data.subject_materials;
  const c = countLessons(data.lessons);
  const pct = lessonPercent(c);
  const created = Object.entries(e.created_labels)
    .map(([key, label]) => ({ key, label, n: e.created[key] ?? 0 }))
    .filter((x) => x.n > 0);
  const toggle = (
    <div className="inline-flex rounded-xl bg-slate-900/[0.06] p-1 text-[13px] font-semibold">
      {([['lessons', 'Darslar'], ['dossier', 'Dalillar jadvali']] as const).map(([k, label]) => (
        <button key={k} type="button" onClick={() => setView(k)}
          className={`rounded-lg px-3.5 py-1.5 transition ${view === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
          {label}
        </button>
      ))}
    </div>
  );
  const tiles = [
    { label: 'O‘tilgan', n: c.done, cls: 'text-emerald-600', dot: 'bg-emerald-500' },
    { label: 'Chala o‘tilgan', n: c.short, cls: 'text-amber-600', dot: 'bg-amber-400' },
    { label: 'Noto‘g‘ri foydalangan', n: c.misuse, cls: 'text-amber-700', dot: 'bg-amber-500' },
    { label: 'Ochilmagan', n: c.none, cls: 'text-rose-600', dot: 'bg-rose-500' },
    ...(c.excused ? [{ label: 'Uzrli', n: c.excused, cls: 'text-slate-600', dot: 'bg-slate-400' }] : []),
  ];
  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-4 rounded-3xl bg-white p-4 ring-1 ring-slate-900/[0.06] sm:flex-row sm:items-center sm:p-5">
        <div className="flex items-center gap-4 sm:min-w-0 sm:flex-1">
          <Ring value={pct ?? 0} size={92} stroke={9} tone={pct === null ? 'slate' : toneOf(pct)} track="rgba(15,23,42,0.07)">
            <span className="text-[22px] font-bold text-slate-900 rx-num">{pct === null ? '—' : `${pct}%`}</span>
          </Ring>
          <div className="min-w-0">
            <p className="text-[17px] font-bold leading-snug text-slate-900">{lessonVerdict(c)}</p>
            <p className="mt-1 text-[13px] text-slate-500">
              Dars o‘tilgan hisoblanadi: kamida {NEED_MINUTES} daqiqa iMentor’da ishlagan yoki talabalar uning jonli testida qatnashgan.
            </p>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-3 gap-2 sm:flex">
          {tiles.map((t) => (
            <div key={t.label} className="min-w-[92px] rounded-2xl bg-slate-50 px-3 py-2.5 text-center">
              <p className={`text-[26px] font-bold leading-none rx-num ${t.cls}`}>{t.n}</p>
              <p className="mt-1 flex items-center justify-center gap-1 text-[12px] font-medium text-slate-500">
                <span className={`h-2 w-2 rounded-full ${t.dot}`} /> {t.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className={`grid gap-4 ${view === 'dossier' ? '' : 'lg:grid-cols-[minmax(0,1fr)_300px]'}`}>
        <section className="min-w-0">
          {/* Ikki ko'rinish (2026-11-16): darslar kartalari yoki dalillar jadvali. Almashtirgich filtr qatorida
              turadi — alohida qator egallamaydi. */}
          {view === 'dossier'
            ? <><div className="mb-3">{toggle}</div><TeacherDossier teacherKey={data.teacher_key} filters={filters} onOpen={onOpen} /></>
            : <TeacherLessons lessons={data.lessons} onOpen={onOpen} lead={toggle} />}
        </section>

        <aside className={view === 'dossier' ? 'hidden' : 'space-y-3'}>
          <Side title={`Shu davrda yaratgani — ${e.created_total}`}>
            {created.length === 0 ? (
              <p className="text-[13.5px] text-slate-500">Yangi material yaratmagan.</p>
            ) : (
              <ul className="space-y-1.5">
                {created.map((x) => {
                  const look = CREATED_LOOK[x.key] || { icon: Sparkles, tone: 'slate' as Tone };
                  return (
                    <li key={x.key} className="flex items-center gap-2.5 text-[14px]">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${TONE[look.tone].chip}`}><look.icon size={14} /></span>
                      <span className="flex-1 text-slate-700">{x.label}</span>
                      <b className="text-slate-900 rx-num">{x.n}</b>
                    </li>
                  );
                })}
              </ul>
            )}
            {m.students_taught > 0 && (
              <p className="mt-2.5 border-t border-slate-100 pt-2 text-[12.5px] text-slate-500">
                Testlarida {m.students_taught} talaba qatnashgan ({m.student_attempts} urinish).
              </p>
            )}
          </Side>

          <Side title="Fanlari">
            {sm.rows.length === 0 ? (
              <p className="text-[13.5px] text-rose-700">Hech qanday fan biriktirmagan.</p>
            ) : (
              <ul className="space-y-2">
                {sm.rows.map((x) => (
                  <li key={`${x.syllabus_id}-${x.variant}`} className="text-[13px]">
                    <p className="truncate font-medium text-slate-800" title={x.subject}>
                      {x.subject}{x.variant && <span className="text-slate-400"> · {x.variant}</span>}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="min-w-0 flex-1"><Meter value={x.percent} height={6} /></span>
                      <span className="shrink-0 text-[12px] text-slate-500">{x.topics - x.empty}/{x.topics} mavzuda material</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Side>

          <Side title="Profil">
            <Row label="Lavozim" value={data.profile.job_title || '—'} />
            <Row label="Oxirgi faollik (davrda)" value={data.profile.last_active ? day(data.profile.last_active) : 'yo‘q'} />
            <Row label="Oxirgi kirish" value={day(data.profile.last_login)} />
            <Row label="Faollik darajasi" value={<Pill tone={DEPTH_PILL[e.depth] || 'rose'}>{e.depth_label}</Pill>} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(pc.have).map(([key, ok]) => (
                <span
                  key={key}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ${
                    ok ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-rose-50 text-rose-800 ring-rose-200'
                  }`}
                >
                  {ok ? <Check size={11} /> : <Minus size={11} />}
                  {PROFILE_LABEL[key] || key}
                </span>
              ))}
            </div>
          </Side>

          {data.rooms.length > 0 && (
            <details className="rounded-2xl bg-white ring-1 ring-slate-900/[0.06]">
              <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-bold uppercase tracking-wide text-slate-500">
                Monitor xonalari ({data.rooms.length})
              </summary>
              <div className="border-t border-slate-100 p-2"><RoomTable rows={data.rooms} compact /></div>
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}

function StudentBody({ data }: { data: ControlStudentDetail }) {
  const c = data.contingent;
  const attempts = (data.attempts as Array<Record<string, unknown>>) || [];
  const totals = (data.totals as Record<string, number>) || {};
  return (
    <div className="space-y-5">
      {c ? (
        <section className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
          <Row label="Guruh" value={c.group_name || '—'} />
          <Row label="Kurs" value={c.course ?? '—'} />
          <Row label="Fakultet" value={c.faculty || '—'} />
          <Row label="Yo‘nalish" value={c.direction || '—'} />
          <Row label="Ta’lim shakli" value={`${c.education_form || '—'}${c.education_language ? ` · ${c.education_language}` : ''}`} />
          <Row label="Talaba ID" value={c.student_id} />
        </section>
      ) : (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          Bu talaba HEMIS kontingentida topilmadi — test ID’siz (QR orqali) topshirilgan bo‘lishi mumkin.
        </p>
      )}

      <section className="grid grid-cols-3 gap-2">
        {[
          ['Urinish', totals.attempts ?? attempts.length],
          ['O‘rtacha ball', totals.avg_score != null ? `${totals.avg_score}%` : '—'],
          ['Fanlar', totals.subjects ?? '—'],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06]">
            <p className="text-[11px] font-semibold text-slate-500">{label}</p>
            <p className="text-[18px] font-extrabold tabular-nums text-slate-900">{String(value)}</p>
          </div>
        ))}
      </section>

      <section>
        <Head icon={ListChecks} tone="indigo">Testlari ({attempts.length})</Head>
        {attempts.length === 0 ? (
          <p className="text-[12.5px] text-slate-400">Bu davrda test topshirmagan.</p>
        ) : (
          <div className="space-y-1">
            {attempts.slice(0, 40).map((a, i) => {
              const score = Number(a.score ?? 0);
              const total = Number(a.total ?? 0);
              const pct = total ? Math.round((100 * score) / total) : 0;
              return (
                <div key={String(a.id ?? i)} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px]">
                  <span className="w-[62px] shrink-0 text-slate-500">{day(String(a.submitted_date ?? a.date ?? ''))}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700" title={String(a.topic ?? '')}>
                    {String(a.topic ?? a.subject_code ?? '—')}
                  </span>
                  <span
                    className={`w-14 shrink-0 text-right font-semibold ${
                      pct >= 60 ? 'text-emerald-700' : pct >= 40 ? 'text-amber-700' : 'text-rose-700'
                    }`}
                  >
                    {score}/{total}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default function PersonPanel({
  person,
  filters,
  onClose,
}: {
  person: Person;
  filters: ReportFilters;
  onClose: () => void;
}) {
  const [data, setData] = useState<ControlTeacherDetail | ControlStudentDetail | null>(null);
  const [error, setError] = useState('');
  const [lesson, setLesson] = useState<ScheduledLessonRow | null>(null);
  const [view, setView] = useState<'lessons' | 'dossier'>('lessons');

  useEffect(() => {
    let alive = true;
    setData(null);
    setLesson(null);
    setError('');
    const load = person.kind === 'teacher'
      ? fetchControlTeacher(person.key, filters)
      : fetchControlStudent(person.key, filters);
    load
      .then((d) => alive && setData(d as ControlTeacherDetail | ControlStudentDetail))
      .catch(() => alive && setError('Ma’lumotni yuklab bo‘lmadi.'));
    return () => {
      alive = false;
    };
  }, [person.kind, person.key, filters.from, filters.to]);

  useEffect(() => {
    // Esc: dars ichida bo'lsa — darslarga qaytadi, aks holda oyna yopiladi.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lesson) setLesson(null);
      else onClose();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, lesson]);

  // O'rtada alohida oyna (2026-11-15): rektor "yondan chiqmasin, o'rtada chiqsin".
  const teacher = person.kind === 'teacher' ? (data as ControlTeacherDetail | null) : null;
  const sub = teacher ? [teacher.profile?.department, teacher.profile?.job_title].filter(Boolean).join(' · ') : '';
  return (
    <div className="rx-print-overlay fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[3px]" onClick={onClose} aria-label="Yopish" />
      <div
        className={`rx-pop rx-print-root relative flex max-h-full w-full flex-col overflow-hidden rounded-[28px] bg-[#f4f5f9] shadow-2xl ring-1 ring-black/5 ${
          person.kind === 'teacher' ? 'h-[min(94vh,980px)] max-w-[1180px]' : 'max-h-[90vh] max-w-[760px]'
        }`}
      >
        <header className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-5 py-4">
          <Avatar name={person.name} size={48} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {person.kind === 'teacher' ? <UserRound size={13} /> : <GraduationCap size={13} />}
              {person.kind === 'teacher' ? 'O‘qituvchi' : 'Talaba'}
            </p>
            <h2 className="truncate text-[20px] font-bold tracking-tight text-slate-900">{person.name}</h2>
            {sub && (
              <p className="flex items-center gap-1 truncate text-[13px] text-slate-500">
                <Building2 size={13} className="shrink-0" /> {sub}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rx-no-print shrink-0 rounded-full bg-slate-100 p-2.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
            aria-label="Yopish"
          >
            <X size={20} />
          </button>
        </header>
        <div key={lesson ? `l${lesson.id}` : 'list'} className="rx-print-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {error ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
          ) : !data ? (
            <Spinner />
          ) : person.kind === 'teacher' ? (
            lesson ? <LessonDetail lesson={lesson} onBack={() => setLesson(null)} />
              : <TeacherBody data={data as ControlTeacherDetail} onOpen={setLesson} filters={filters} view={view} setView={setView} />
          ) : (
            <StudentBody data={data as ControlStudentDetail} />
          )}
        </div>
      </div>
    </div>
  );
}
