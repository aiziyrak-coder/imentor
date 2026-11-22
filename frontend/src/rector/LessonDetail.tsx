import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  FileText,
  ListChecks,
  Presentation,
  Printer,
  Radio,
  Sparkles,
  Stethoscope,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { fetchControlLesson, type LessonDetail as Data, type LessonDetailStudent, type ScheduledLessonRow } from './rectorApi';
import { Spinner } from './RectorUi';
import { ProofFacts, ProofJournal, ProofTimeline, hm, sameGradeFact } from './LessonProof';
import { HistoryCard, RoomDay, TestAnalysis, shortName } from './LessonProofMore';
import { NEED_MINUTES, lessonPages, lessonState } from './TeacherLessons';
import VerdictBasis from './VerdictBasis';
import { lessonPhase } from './lessonPhase';

/**
 * Bitta dars ichi (2026-11-15; 2026-11-16 qayta tartiblandi).
 *
 * O'qish tartibi — eng muhimidan: sarlavha va 4 raqam → dalillar xulosasi → daqiqama-daqiqa →
 * jonli test va yaratgani | xona isboti va odati → talabalar (iMentor va HEMIS yonma-yon) → test tahlili →
 * hodisalar jurnali (eng pastda, ixcham).
 */

const KIND: Record<string, { label: string; icon: LucideIcon; chip: string; unit: string }> = {
  test: { label: 'Test', icon: ListChecks, chip: 'bg-indigo-100 text-indigo-700', unit: 'savol' },
  case: { label: 'Keys', icon: Stethoscope, chip: 'bg-rose-100 text-rose-700', unit: 'vaziyat' },
  presentation: { label: 'Taqdimot', icon: Presentation, chip: 'bg-violet-100 text-violet-700', unit: '' },
  handout: { label: 'Tarqatma', icon: FileText, chip: 'bg-teal-100 text-teal-700', unit: '' },
  video: { label: 'Video', icon: Video, chip: 'bg-orange-100 text-orange-700', unit: '' },
};

const STATE_LOOK: Record<string, { label: string; cls: string }> = {
  done: { label: 'O‘tilgan', cls: 'bg-emerald-600 text-white' },
  misuse: { label: 'Noto‘g‘ri foydalangan', cls: 'bg-amber-500 text-white' },
  short: { label: 'Chala', cls: 'bg-amber-500 text-white' },
  none: { label: 'Ochilmagan', cls: 'bg-rose-600 text-white' },
  pending: { label: 'Hali tugamagan', cls: 'bg-sky-600 text-white' },
  excused: { label: 'Uzrli', cls: 'bg-slate-500 text-white' },
  free: { label: 'Hisobga kirmaydi', cls: 'bg-slate-200 text-slate-700' },
};

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
function dayTitle(iso: string, weekday: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}-${MONTHS[(m || 1) - 1]}${weekday ? `, ${weekday.toLowerCase()}` : ''}`;
}

function Card({ title, icon: Icon, right, children }: { title: string; icon: LucideIcon; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Icon size={15} /></span>
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Baho pog'onasi rangi: iMentor foizi va HEMIS bali bir xil chegaralar bilan (86 / 71 / 55). */
function scoreCls(v: number | null): string {
  if (v === null) return 'text-slate-400';
  return v >= 86 ? 'text-emerald-700' : v >= 71 ? 'text-sky-700' : v >= 55 ? 'text-amber-700' : 'text-rose-700';
}

function Created({ c }: { c: Data['created'][number] & { times?: number } }) {
  const [open, setOpen] = useState(false);
  const k = KIND[c.kind] || { label: c.kind, icon: Sparkles, chip: 'bg-slate-100 text-slate-700', unit: '' };
  return (
    <li className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
      <button type="button" disabled={!c.items.length} onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 text-left">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${k.chip}`}><k.icon size={15} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-slate-900">
            {k.label}{c.count > 0 && k.unit ? ` · ${c.count} ${k.unit}` : ''}{c.times ? ` ×${c.times}` : ''}
            <span className="ml-2 text-[12px] font-normal text-slate-400 rx-num">{hm(c.at)}</span>
          </span>
          <span className="line-clamp-2 text-[13px] text-slate-600" title={c.title || c.topic}>{c.title || c.topic}</span>
        </span>
        {c.items.length > 0 && <ChevronDown size={16} className={`rx-no-print mt-1 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && (
        <ol className="mt-2 list-decimal space-y-1.5 pl-14 pr-2 text-[13px] leading-relaxed text-slate-700">
          {c.items.map((t, i) => <li key={i}>{t}</li>)}
        </ol>
      )}
    </li>
  );
}

type Flag = NonNullable<LessonDetailStudent['flag']>;
const FLAGS: Array<{ key: Flag; label: string; cls: string }> = [
  { key: 'graded_without_trace', label: 'HEMIS’da baho bor, iMentor’da izi yo‘q', cls: 'bg-rose-100 text-rose-800' },
  { key: 'low_test_high_grade', label: 'Test qoniqarsiz (<55%), HEMIS’da 71+', cls: 'bg-amber-100 text-amber-900' },
  { key: 'high_test_low_grade', label: 'Test yaxshi (71%+), HEMIS’da 55 dan past', cls: 'bg-amber-100 text-amber-900' },
  { key: 'tested_not_graded', label: 'Testni ishlagan, HEMIS’da baho yo‘q', cls: 'bg-slate-200 text-slate-800' },
];

export default function LessonDetail({ lesson, onBack }: { lesson: ScheduledLessonRow; onBack: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [flag, setFlag] = useState<Flag | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    setFlag(null);
    fetchControlLesson(lesson.id)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError('Dars ma’lumotini yuklab bo‘lmadi.'));
    return () => {
      alive = false;
    };
  }, [lesson.id]);

  // Karta darhol ko'rinsin: server javobi kelguncha ro'yxatdagi qatordan.
  const l = data?.lesson ?? lesson;
  const state = lessonState(l);
  const look = state === 'pending'
    ? { ...STATE_LOOK.pending, label: lessonPhase(l.date, l.start_time, l.end_time) === 'upcoming' ? 'Hali boshlanmagan' : 'Dars davom etmoqda' }
    : STATE_LOOK[state];
  const pages = lessonPages(l);
  const min = l.minutes ?? 0;
  const students = useMemo(() => (data?.students || []).filter((s) => !flag || s.flag === flag), [data, flag]);
  const s = data?.summary;
  const sameGrade = useMemo(() => sameGradeFact((data?.students || []).map((x) => x.hemis)), [data]);
  const nothingMade = !!data && data.live_tests.length === 0 && data.created.length === 0;
  const proof = data?.proof;
  const flags = proof?.hemis_flags;
  // Bir xil material ketma-ket bir necha marta saqlangan bo'lsa (masalan, uchta video) — bitta qator, «×3».
  const created = useMemo(() => {
    const out: Array<Data['created'][number] & { times?: number }> = [];
    for (const c of data?.created || []) {
      const prev = out[out.length - 1];
      if (prev && prev.kind === c.kind && (prev.title || prev.topic) === (c.title || c.topic) && !c.items.length) prev.times = (prev.times ?? 1) + 1;
      else out.push({ ...c });
    }
    return out;
  }, [data]);
  // "0 daqiqa" bilan "O'tilgan" yonma-yon turganda nega shundayligini aytib qo'yamiz.
  const minutesHint = l.verdict === 'students' && min < NEED_MINUTES ? 'talabalar testi bo‘yicha o‘tilgan'
    : l.verdict === 'block' && min < NEED_MINUTES ? 'ketma-ket paralar bo‘yicha o‘tilgan'
    : `kerak: ${NEED_MINUTES} daq`;
  const minutesCls = min >= NEED_MINUTES ? 'text-emerald-600' : state === 'done' ? 'text-slate-900' : min > 0 ? 'text-amber-600' : 'text-rose-600';

  return (
    <div className="space-y-4">
      <div className="rx-no-print flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[13.5px] font-semibold text-indigo-700 ring-1 ring-slate-200 hover:bg-indigo-50">
          <ArrowLeft size={15} /> Darslarga qaytish
        </button>
        {data && (
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3.5 py-1.5 text-[13.5px] font-semibold text-white hover:bg-slate-700">
            <Printer size={15} /> Dalolatnoma — chop etish / PDF
          </button>
        )}
      </div>
      <p className="hidden text-[12px] text-slate-500 print:block">
        Dars dalolatnomasi · iMentor qaydlari asosida · tuzilgan: {new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}
      </p>

      {/* 1. Qaysi dars va 4 asosiy raqam. */}
      <section className="rounded-3xl bg-white p-4 ring-1 ring-slate-900/[0.06] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
              <span className="font-semibold text-slate-700">{dayTitle(l.date, l.weekday)}</span>
              <span>·</span>
              <span className="rx-num">{l.para}, {l.start_time}–{l.end_time}</span>
              <span className={`ml-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${look.cls}`}>{look.label}</span>
            </div>
            <h2 className="mt-1.5 text-[20px] font-bold leading-snug text-slate-900">{l.subject || '—'}</h2>
            <p className="mt-0.5 text-[13.5px] text-slate-500">
              {(data?.lesson.groups?.join(', ') || l.group || '—')} · {l.room || '—'} · {l.lesson_type || '—'}
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto">
            {[
              { label: 'iMentor’da ishlagan', value: `${min} daq`, hint: minutesHint, cls: minutesCls },
              { label: 'Jonli test', value: data ? String(data.live_tests.length) : '…', hint: s ? `${s.tested} talaba ishlagan` : '', cls: 'text-indigo-600' },
              { label: 'Shu darsda yaratgani', value: data ? String(data.created.length) : '…', hint: 'test, keys, material', cls: 'text-violet-600' },
              { label: 'HEMIS’da baho', value: s ? `${s.graded}` : '…', hint: s ? `guruhda ${s.roster} talaba` : '', cls: 'text-slate-900' },
            ].map((t) => (
              <div key={t.label} className="rounded-2xl bg-slate-50 px-3 py-2 lg:min-w-[140px]">
                <p className="text-[12px] font-medium text-slate-500">{t.label}</p>
                <p className={`text-[22px] font-bold leading-tight rx-num ${t.cls}`}>{t.value}</p>
                <p className="text-[11.5px] leading-tight text-slate-400">{t.hint}</p>
              </div>
            ))}
          </div>
        </div>
        {l.topics && l.topics.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-indigo-50 px-3 py-2 text-[13.5px] leading-snug text-indigo-900">
            <BookOpen size={15} className="mt-[2px] shrink-0" /> <span><b>Mavzu:</b> {l.topics.join(' · ')}</span>
          </p>
        )}
      </section>

      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
      {!data && !error && <Spinner />}

      {/* Baho asosi — har shart, haqiqiy qiymati bilan (2026-11-19). */}
      {data && <VerdictBasis l={l} />}

      {/* 2–3. Dalillar xulosasi va daqiqama-daqiqa. */}
      {proof && <ProofFacts p={proof} verdict={l.verdict} graded={s?.graded ?? 0} extra={sameGrade ? [sameGrade] : []} />}
      {proof && <ProofTimeline p={proof} pages={pages} />}

      {/* 4. Chapda: jonli test va yaratgani. O'ngda: xona isboti va odati. */}
      {data && nothingMade && (
        <>
          <p className="rounded-2xl bg-white px-4 py-3 text-[13.5px] text-slate-500 ring-1 ring-slate-900/[0.06] sm:px-5">
            Bu darsda jonli test o‘tkazilmagan, yangi test, keys yoki material ham yaratilmagan.
          </p>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {proof?.room_day && <RoomDay r={proof.room_day} taught={state === 'done'} date={l.date} />}
            {proof?.history && <HistoryCard h={proof.history} p={proof} minutes={min} />}
          </div>
        </>
      )}
      {data && !nothingMade && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            {(
              <>
              <Card title="Jonli testlar" icon={Radio}>
                {data.live_tests.length === 0 ? (
                  <p className="text-[13.5px] text-slate-500">Bu darsda jonli test o‘tkazilmagan.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.live_tests.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-[14px] font-semibold text-slate-900" title={t.topic}>{t.topic || 'Mavzusiz test'}</span>
                          <span className="block text-[12.5px] text-slate-500 rx-num">{hm(t.at)} · {t.questions} savol · <Users size={12} className="inline" /> {t.students} talaba</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={`block text-[22px] font-bold leading-none rx-num ${scoreCls(t.average)}`}>{t.average === null ? '—' : `${t.average}%`}</span>
                          <span className="text-[11px] text-slate-400">o‘rtacha</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Shu darsda yaratgani" icon={Sparkles}>
                {data.created.length === 0 ? (
                  <p className="text-[13.5px] text-slate-500">Dars vaqtida yangi test, keys yoki material yaratmagan.</p>
                ) : (
                  <ul className="space-y-2">{created.map((c, i) => <Created key={`${c.kind}-${i}`} c={c} />)}</ul>
                )}
              </Card>
              </>
            )}
          </div>
          <div className="space-y-4">
            {proof?.room_day && <RoomDay r={proof.room_day} taught={state === 'done'} date={l.date} />}
            {proof?.history && <HistoryCard h={proof.history} p={proof} minutes={min} />}
          </div>
        </div>
      )}

      {/* 5. Talabalar: iMentor natijasi va HEMIS bahosi yonma-yon. */}
      {data && (
        <Card
          title="Talabalar: iMentor natijasi va HEMIS bahosi"
          icon={Users}
          right={s && (s.imentor_avg !== null || s.hemis_avg !== null) && (
            <span className="flex flex-wrap gap-2 text-[13px]">
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-800">iMentor testi o‘rtacha <b className="rx-num">{s.imentor_avg ?? '—'}{s.imentor_avg !== null ? '%' : ''}</b></span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-800">HEMIS bahosi o‘rtacha <b className="rx-num">{s.hemis_avg ?? '—'}</b></span>
            </span>
          )}
        >
          {data.hemis_error && <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-800">{data.hemis_error}</p>}
          {s && s.graded === 0 && !data.hemis_error && (
            <p className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-600">O‘qituvchi HEMIS’da shu darsga hali birorta ham baho qo‘ymagan.</p>
          )}
          {flags && FLAGS.some((f) => flags[f.key] > 0) && (
            <div className="rx-no-print mb-3 flex flex-wrap items-center gap-1.5">
              {FLAGS.filter((f) => flags[f.key] > 0).map((f) => (
                <button key={f.key} type="button" onClick={() => setFlag(flag === f.key ? null : f.key)}
                  className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ${f.cls} ${flag === f.key ? 'ring-2 ring-slate-900' : flag ? 'opacity-50' : ''}`}>
                  {f.label} · {flags[f.key]}
                </button>
              ))}
              {flag && <button type="button" onClick={() => setFlag(null)} className="rounded-full bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 ring-1 ring-slate-200">Hammasi</button>}
            </div>
          )}
          {students.length === 0 ? (
            <p className="text-[13.5px] text-slate-500">Bu dars guruhining talabalari topilmadi.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl ring-1 ring-slate-100">
              <table className="w-full min-w-[820px] text-[13.5px]">
                <thead className="bg-slate-50 text-left text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-10 px-3 py-2">№</th>
                    <th className="px-3 py-2">Talaba</th>
                    <th className="px-3 py-2 text-right" title="Dars vaqtida iMentor'da faol bo'lgan daqiqalari va birinchi ko'ringan vaqti">Darsda faol</th>
                    <th className="px-3 py-2 text-right">Testni boshladi</th>
                    <th className="px-3 py-2 text-right" title="Test paytida boshqa oyna yoki ilovaga o'tgan">Oynadan chiqdi</th>
                    <th className="px-3 py-2 text-right">iMentor testi</th>
                    <th className="px-3 py-2 text-right">HEMIS bahosi</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((st, i) => {
                    const mark = st.flag === 'graded_without_trace' ? 'bg-rose-50/70' : st.flag === 'low_test_high_grade' || st.flag === 'high_test_low_grade' ? 'bg-amber-50/70' : '';
                    return (
                      <tr key={st.student_id} className={`border-t border-slate-100 ${mark}`}>
                        <td className="px-3 py-2 text-slate-400 rx-num">{i + 1}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium text-slate-900" title={st.name}>{shortName(st.name || st.student_id)}</span>
                          {st.group && (data.lesson.groups?.length ?? 0) !== 1 && <span className="ml-2 text-[12px] text-slate-400">{st.group}</span>}
                          {st.group && data.lesson.groups?.length === 1 && st.group !== data.lesson.groups[0] && <span className="ml-2 rounded bg-slate-100 px-1.5 text-[11.5px] text-slate-500">{st.group}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {st.active_minutes ? <span><b className="rx-num text-slate-800">{st.active_minutes} daq</b> <span className="text-[12px] text-slate-400 rx-num">{hm(st.first_seen)} dan</span></span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right rx-num text-slate-700">{st.test_started ? hm(st.test_started) : <span className="text-slate-300">—</span>}</td>
                        <td className={`px-3 py-2 text-right rx-num ${(st.tab_switches ?? 0) >= 5 ? 'font-bold text-amber-700' : 'text-slate-500'}`}>{st.tab_switches ? `${st.tab_switches} marta` : <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2 text-right">
                          {st.imentor === null ? <span className="text-slate-400">ishlamagan</span> : (
                            <span><b className={`rx-num ${scoreCls(st.imentor)}`}>{st.imentor}%</b> <span className="text-[12px] text-slate-400 rx-num">{st.score}/{st.total}</span></span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {st.hemis === null ? <span className="text-slate-400">qo‘yilmagan</span> : <b className={`rx-num ${scoreCls(st.hemis)}`}>{st.hemis}</b>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[12px] leading-snug text-slate-400">
            iMentor testi — shu darsdagi jonli testda to‘g‘ri javoblar ulushi (bir necha urinish bo‘lsa eng yaxshisi). HEMIS bahosi — o‘qituvchi shu darsga qo‘ygan baho (100 ballik).
            Ranglar bir xil chegarada: 86+ a’lo, 71+ yaxshi, 55+ qoniqarli, undan past — qoniqarsiz. «Izi yo‘q» talaba darsga kelmagan degani emas — iMentor’ni ochmagan bo‘lishi mumkin.
          </p>
        </Card>
      )}

      {/* 6. Test tahlili. */}
      {proof?.integrity && <TestAnalysis it={proof.integrity} />}

      {/* 7. Hodisalar jurnali — eng pastda. */}
      {proof && <ProofJournal p={proof} />}
    </div>
  );
}
