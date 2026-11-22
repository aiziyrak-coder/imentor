import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, FileSearch, Info, ListOrdered, XCircle, type LucideIcon } from 'lucide-react';
import type { LessonProof as Proof } from './rectorApi';
import { PAGE_LABEL } from './TeacherLessons';

/**
 * Dars dalillari (2026-11-16). Rektor: «tergovchi dalil yig'gandek — ikir-chikirigacha, aniq statistika».
 * Xulosa jumlalari faqat qaydlardan; har birida aniq vaqt va son.
 *
 * Rang qoidasi (2026-11-16 tuzatish): qizil faqat ANIQ kamchilik uchun. Dars ichidagi tanaffus yoki
 * erta to'xtash o'z-o'zidan ayb emas (doskada tushuntirish) — ular kulrang/sariq ma'lumot sifatida turadi.
 */

export const PAGE_COLOR: Record<string, string> = {
  presentation: '#8b5cf6', videos: '#f97316', tests: '#6366f1', 'my-tests': '#818cf8', lectures: '#0ea5e9',
  cases: '#f43f5e', handouts: '#14b8a6', syllabus: '#94a3b8', 'content-catalog': '#64748b',
};

export function hm(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('uz-UZ', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' });
}

/** "5 daqiqa oldin" / "8 daqiqa kech" — manfiy sonlarsiz. */
export function lateText(minutes: number): string {
  if (minutes > 0) return `${minutes} daqiqa kech`;
  if (minutes < 0) return `${-minutes} daqiqa oldin`;
  return 'o‘z vaqtida';
}

export type Fact = { tone: 'good' | 'warn' | 'bad' | 'info'; text: string };

/** Hamma talabaga AYNAN bir xil baho qo'yilgan bo'lsa (kamida 5 talaba) — rasmiyatchilik belgisi. */
export function sameGradeFact(grades: Array<number | null>): Fact | null {
  const g = grades.filter((x): x is number => x !== null);
  if (g.length < 5 || new Set(g).size !== 1) return null;
  return { tone: 'warn', text: `HEMIS’da ${g.length} talabaning hammasiga aynan bir xil baho qo‘yilgan — ${g[0]}.` };
}

/** `verdict` — dars qanday baholangani (full | students | block | short | none): xulosa shunga mos yoziladi. */
export function proofFacts(p: Proof, verdict?: string, graded = 0): Fact[] {
  const t = p.teacher;
  const out: Fact[] = [];
  const len = p.scheduled.minutes;
  const taughtOtherwise = verdict === 'students' || verdict === 'block';
  if (!t.first && verdict === 'group') {
    out.push({ tone: 'warn', text: 'O‘qituvchining o‘z hisobida dars vaqtida harakat yo‘q — faqat guruh talabalari iMentor’da ishlagan. Bu darsni o‘qituvchi iMentor’da o‘tganini isbotlamaydi, shuning uchun «chala».' });
  } else if (!t.first) {
    out.push(taughtOtherwise
      ? { tone: 'info', text: verdict === 'students'
          ? 'O‘qituvchining o‘z hisobida dars vaqtida harakat qayd etilmagan — dars talabalar uning jonli testida ishlagani bo‘yicha o‘tilgan deb hisoblandi.'
          : 'Shu paraning o‘zida o‘qituvchi hisobida harakat yo‘q — ketma-ket paralarning boshqasida o‘tilgani uchun hisoblandi.' }
      : { tone: 'bad', text: `Dars vaqtida (${hm(p.scheduled.from)}–${hm(p.scheduled.to)}) o‘qituvchining iMentor’da birorta ham harakati qayd etilmagan.` });
  } else {
    const late = t.late_minutes ?? 0;
    out.push({
      tone: late > 15 ? 'bad' : late > 5 ? 'warn' : 'good',
      text: late > 0
        ? `iMentor’ni ${hm(t.first)} da ochgan — dars boshlanganidan ${late} daqiqa keyin.`
        : `iMentor’ni ${hm(t.first)} da ochgan — dars boshlanishidan ${-late} daqiqa oldin.`,
    });
    const early = t.early_leave_minutes ?? 0;
    out.push({
      tone: early > 20 ? 'warn' : early > 5 ? 'info' : 'good',
      text: early > 0
        ? `Oxirgi harakat ${hm(t.last)} da — dars tugashiga ${early} daqiqa qolganda.`
        : `Oxirgi harakat ${hm(t.last)} da — dars oxirigacha ishlagan.`,
    });
    // Rasmiy mezon: 80 daqiqalik darsda kamida 40 daqiqa, ya'ni yarmi.
    out.push({
      tone: t.coverage >= 50 ? 'good' : t.coverage >= 25 ? 'warn' : 'bad',
      text: `Darsning ${len} daqiqasidan ${t.active_minutes} tasida iMentor’da faol bo‘lgan (${t.coverage}%), ${t.pages_opened} marta bo‘lim ochgan.`,
    });
    for (const g of t.gaps) {
      const open = g.open_minutes ?? 0;
      const where = g.open_page && PAGE_LABEL[g.open_page] ? ` («${PAGE_LABEL[g.open_page]}» bo‘limi)` : '';
      if (open >= g.minutes - 1) {
        // Sahifa ekranda ochiq turgan — o'qituvchi iMentor'dan chiqmagan (2026-11-19).
        out.push({ tone: 'good', text: `${hm(g.from)}–${hm(g.to)}: ${g.minutes} daqiqa sichqoncha/klaviaturaga tegilmagan, lekin iMentor ekranda ochiq turgan${where} — chiqib ketmagan.` });
      } else if (open > 0) {
        out.push({ tone: 'info', text: `${hm(g.from)}–${hm(g.to)}: ${g.minutes} daqiqa harakat yo‘q; shundan ${open} daqiqasida iMentor ekranda ochiq turgan${where}.` });
      } else {
        out.push({ tone: g.minutes >= 20 ? 'warn' : 'info', text: `${hm(g.from)}–${hm(g.to)}: ${g.minutes} daqiqa iMentor’da harakat yo‘q.` });
      }
    }
  }
  // Eng kuchli belgi: darsda iMentor'da hech qanday iz yo'q, lekin HEMIS'da shu darsga baho qo'yilgan.
  if (!t.first && !taughtOtherwise && graded > 0) {
    out.push({ tone: 'bad', text: `Shunga qaramay HEMIS’da shu darsga ${graded} talabaga baho qo‘yilgan — dars o‘tilganmi va baho qanday asosda qo‘yilgani so‘ralishi kerak.` });
  }
  // Talabalar BOSHQA hisob testida (2026-11-19: Sobirova — dars talaba hisobidan; o'rinbosar o'qituvchi).
  for (const o of p.other_sessions ?? []) {
    out.push({ tone: 'warn', text: `Shu dars vaqtida guruhdan ${o.students} talaba BOSHQA hisob — ${o.name} — jonli testida qatnashgan (${hm(o.first)}). Dars boshqa hisobdan yoki boshqa o‘qituvchi tomonidan o‘tilgan bo‘lishi mumkin — hisobni tekshirish kerak.` });
  }
  for (const f of p.face_logins ?? []) {
    out.push({ tone: 'good', text: `${hm(f.at)} da yuzi orqali tanilib kirgan — hisobga aynan o‘zi kirgan${f.before_lesson ? ' (darsdan oldin)' : ''}.` });
  }
  for (const q of p.qr) {
    out.push({ tone: 'good', text: `${hm(q.at)} da xona kompyuteriga QR-kod orqali kirgan${q.before_lesson ? ' (darsdan oldin)' : ''}.` });
  }
  const n = p.network;
  if (n.networks) {
    out.push(n.outside === 0
      ? { tone: 'good', text: `Institut tarmog‘idan ishlagan${n.networks > 1 ? ` (${n.networks} ta qurilma/tarmoq, hammasi institutniki)` : ''}.` }
      : { tone: 'warn', text: `${n.outside} ta tashqi tarmoqdan ishlagan${n.campus ? `, ${n.campus} ta institut tarmog‘idan` : ''} — institutdan tashqarida bo‘lgan bo‘lishi mumkin.` });
  }
  if (p.location) {
    const l = p.location;
    out.push(l.inside
      ? { tone: 'good', text: `Joylashuv (${hm(l.at)}): ${l.building} hududida${l.accuracy_m ? `, aniqlik ±${l.accuracy_m} m` : ''}.` }
      : { tone: 'warn', text: `Joylashuv (${hm(l.at)}): eng yaqin bino — ${l.building}, ${l.distance_m} m uzoqda.` });
  }
  const s = p.students;
  if (s.roster) {
    out.push({
      tone: s.active === 0 ? (t.first || taughtOtherwise ? 'info' : 'bad') : 'good',
      text: s.active
        ? `Guruhdagi ${s.roster} talabadan ${s.active} tasi dars vaqtida iMentor’da ishlagan (bir vaqtda eng ko‘pi ${s.peak}), birinchisi ${hm(s.first_seen)} da.`
        : `Guruhdagi ${s.roster} talabadan birortasi ham dars vaqtida iMentor’da ishlamagan.`,
    });
  }
  const r = p.room_day;
  if (r) {
    if (r.others_used) out.push({ tone: 'good', text: `Xona monitori ishlagan: shu kuni bu xonada boshqa o‘qituvchilarning ${r.others_done} darsidan ${r.others_used} tasi iMentor’da o‘tilgan.` });
    else if (r.own_used) out.push({ tone: 'good', text: `Xona monitori ishlagan: shu kuni shu xonada o‘zining boshqa ${r.own_used} darsini iMentor’da o‘tgan.` });
    else if ((r.others_done ?? 0) >= 2) out.push({ tone: 'warn', text: `Shu kuni bu xonada boshqa o‘qituvchilarning ${r.others_done} darsidan birortasi ham iMentor’da o‘tilmagan — monitorni tekshirish kerak.` });
  }
  const h = p.history;
  if (h && h.lessons) out.push({ tone: (h.percent ?? 0) >= 70 ? 'good' : (h.percent ?? 0) >= 40 ? 'warn' : 'bad', text: `Oxirgi ${h.days} kunda nazoratdagi ${h.lessons} darsidan ${h.done} tasini iMentor’da o‘tgan (${h.percent}%).` });
  if (s.tab_switchers) out.push({ tone: 'warn', text: `${s.tab_switchers} talaba test paytida 5 va undan ko‘p marta boshqa oynaga o‘tgan.` });
  return out;
}

const TONE: Record<Fact['tone'], { icon: LucideIcon; cls: string }> = {
  good: { icon: CheckCircle2, cls: 'text-emerald-600' },
  warn: { icon: AlertTriangle, cls: 'text-amber-500' },
  bad: { icon: XCircle, cls: 'text-rose-600' },
  info: { icon: Info, cls: 'text-slate-400' },
};

export function ProofFacts({ p, verdict, graded = 0, extra = [] }: { p: Proof; verdict?: string; graded?: number; extra?: Fact[] }) {
  const facts = [...proofFacts(p, verdict, graded), ...extra];
  // Avval kamchiliklar, keyin ogohlantirish, keyin tasdiqlar — rektor eng muhimini birinchi ko'rsin.
  const order = { bad: 0, warn: 1, good: 2, info: 3 } as const;
  const sorted = [...facts].sort((a, b) => order[a.tone] - order[b.tone]);
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] sm:p-5">
      <h3 className="mb-3 flex flex-wrap items-center gap-2 text-[15px] font-bold text-slate-900">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white"><FileSearch size={15} /></span>
        Dalillar xulosasi
        <span className="text-[12.5px] font-normal text-slate-400">dars {hm(p.scheduled.from)}–{hm(p.scheduled.to)}, {p.scheduled.minutes} daqiqa</span>
      </h3>
      <ul className="grid gap-x-8 gap-y-2 lg:grid-cols-2">
        {sorted.map((f, i) => {
          const T = TONE[f.tone];
          return (
            <li key={i} className="flex items-start gap-2 text-[14px] leading-snug text-slate-800">
              <T.icon size={17} className={`mt-[1px] shrink-0 ${T.cls}`} /> <span>{f.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Daqiqama-daqiqa chiziq. `pages` — bo'limlar bo'yicha daqiqa (izohda ko'rsatiladi). */
export function ProofTimeline({ p, pages }: { p: Proof; pages: Array<{ page: string; label: string; minutes: number }> }) {
  const rows = p.timeline;
  if (!rows.length) return null;
  const peak = Math.max(1, ...rows.map((r) => r.students));
  const anyTeacher = rows.some((r) => r.page);
  const anyStudents = rows.some((r) => r.students > 0);
  // Belgilar: har 10 daqiqada, lekin birinchisi bilan ustma-ust tushmasin.
  const tick = (i: number) => {
    const m = new Date(rows[i].t).getMinutes();
    return m % 10 === 0 || (i === 0 && m % 10 <= 6);
  };
  const startIdx = rows.findIndex((r) => r.in_lesson);
  const endIdx = rows.length - 1 - [...rows].reverse().findIndex((r) => r.in_lesson);
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold text-slate-900">Daqiqama-daqiqa</h3>
        <span className="text-[12.5px] text-slate-400">har katak — 1 daqiqa · och rang — darsdan oldin/keyin</span>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[640px]">
          <div className="flex items-center gap-2">
            <span className="w-[92px] shrink-0 text-[12.5px] font-semibold text-slate-600">O‘qituvchi</span>
            <div className="relative flex h-9 flex-1 items-stretch gap-px">
              {rows.map((r) => (
                <span
                  key={r.t}
                  title={`${hm(r.t)} — ${r.page ? PAGE_LABEL[r.page] || r.page : r.open ? 'ekranda ochiq, harakatsiz' : 'harakat yo‘q'}`}
                  className={`flex-1 rounded-[2px] ${r.in_lesson ? '' : 'opacity-40'}`}
                  style={r.page ? { background: PAGE_COLOR[r.page] || '#475569' }
                    : r.open ? { background: 'repeating-linear-gradient(135deg, #c4b5fd 0 3px, #ede9fe 3px 6px)' }
                      : { background: r.in_lesson ? '#fee2e2' : '#f1f5f9' }}
                />
              ))}
              {/* Dars boshlanishi va tugashi */}
              {startIdx > 0 && <span className="pointer-events-none absolute inset-y-[-4px] w-[2px] bg-slate-800" style={{ left: `${(100 * startIdx) / rows.length}%` }} />}
              {endIdx >= 0 && endIdx < rows.length - 1 && <span className="pointer-events-none absolute inset-y-[-4px] w-[2px] bg-slate-800" style={{ left: `${(100 * (endIdx + 1)) / rows.length}%` }} />}
            </div>
          </div>
          <div className="mt-2 flex items-end gap-2">
            <span className="w-[92px] shrink-0 pb-0.5 text-[12.5px] font-semibold text-slate-600">Talabalar{anyStudents ? <span className="block text-[11px] font-normal text-slate-400">eng ko‘pi {peak}</span> : null}</span>
            <div className="flex h-10 flex-1 items-end gap-px border-b border-slate-200">
              {rows.map((r) => (
                <span key={r.t} title={`${hm(r.t)} — ${r.students} talaba faol`} className={`flex-1 rounded-t-[2px] ${r.in_lesson ? 'bg-indigo-400' : 'bg-indigo-200'}`}
                  style={{ height: `${r.students ? Math.max(10, (100 * r.students) / peak) : 0}%` }} />
              ))}
            </div>
          </div>
          <div className="mt-1 flex gap-2 text-[11px] text-slate-400">
            <span className="w-[92px] shrink-0" />
            <div className="flex h-4 flex-1">
              {rows.map((r, i) => (
                <span key={r.t} className="relative flex-1">
                  {tick(i) && <span className="absolute left-0 whitespace-nowrap rx-num">{hm(r.t)}</span>}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-slate-700">
        {pages.map((k) => (
          <span key={k.page} className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: PAGE_COLOR[k.page] || '#475569' }} />
            {k.label} <b className="rx-num">{k.minutes} daq</b>
          </span>
        ))}
        {rows.some((r) => r.open) && (
          <span className="inline-flex items-center gap-1.5 text-slate-600">
            <span className="h-3 w-3 rounded-sm" style={{ background: 'repeating-linear-gradient(135deg, #c4b5fd 0 2px, #ede9fe 2px 4px)' }} />ekranda ochiq, harakatsiz
          </span>
        )}
        {anyTeacher && <span className="inline-flex items-center gap-1.5 text-slate-500"><span className="h-3 w-3 rounded-sm bg-rose-100 ring-1 ring-rose-200" />harakat yo‘q</span>}
        {!anyTeacher && <span className="text-slate-500">O‘qituvchi hisobida bu oraliqda harakat qayd etilmagan.</span>}
        {!anyStudents && <span className="text-slate-500">Guruh talabalari bu oraliqda iMentor’da ko‘rinmagan.</span>}
      </div>
    </section>
  );
}

const CONTENT: Record<string, string> = { video: 'Video', handout: 'Tarqatma', presentation: 'Taqdimot', lecture: 'Ma’ruza', case: 'Keys' };

type J = Proof['journal'][number] & { count?: number };

function journalText(j: J): string {
  switch (j.kind) {
    case 'open': return `«${PAGE_LABEL[j.page || ''] || j.page}» bo‘limini ochdi`;
    case 'gap': return (j.open_minutes ?? 0) >= (j.minutes ?? 0) - 1
      ? `${j.minutes} daqiqa harakatsiz, iMentor ekranda ochiq turgan (${hm(j.at)}–${hm(j.to)})`
      : `${j.minutes} daqiqa iMentor’da harakat yo‘q (${hm(j.at)}–${hm(j.to)})${j.open_minutes ? `, ${j.open_minutes} daqiqasi ekranda ochiq` : ''}`;
    case 'qr': return 'Xona kompyuteriga QR-kod bilan kirdi';
    case 'login': return 'Yuzi orqali tanilib kirdi';
    case 'logout': return 'Tizimdan chiqdi';
    case 'live_test': return `Jonli test boshladi${j.topic ? `: «${j.topic}»` : ''}`;
    case 'live_test_opened': return 'Jonli test oynasini ochdi';
    case 'submit': return `${j.name || 'Talaba'} testni topshirdi — ${j.score}/${j.total}`;
    case 'content_view': return `${CONTENT[j.content || ''] || 'Material'}ni ochdi${j.title ? `: «${j.title}»` : ''}`;
    default: return `${j.kind}${j.page ? ` · ${PAGE_LABEL[j.page] || j.page}` : ''}`;
  }
}

/** Ketma-ket takrorlar bitta qatorga yig'iladi («Test bo'limini ochdi ×3»). */
export function compactJournal(rows: Proof['journal']): J[] {
  const out: J[] = [];
  for (const j of rows) {
    const prev = out[out.length - 1];
    const same = prev && prev.kind === j.kind && prev.who === j.who && prev.page === j.page && prev.title === j.title
      && j.kind !== 'submit' && j.kind !== 'gap'
      && new Date(j.at).getTime() - new Date(prev.at).getTime() < 3 * 60 * 1000;
    if (same) prev.count = (prev.count ?? 1) + 1;
    else out.push({ ...j });
  }
  return out;
}

export function ProofJournal({ p }: { p: Proof }) {
  const [all, setAll] = useState(false);
  const rows = useMemo(() => compactJournal(p.journal), [p.journal]);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] sm:p-5">
      <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-slate-900">
        <ListOrdered size={17} className="text-slate-500" /> Hodisalar jurnali
        <span className="text-[12.5px] font-normal text-slate-400">{rows.length} ta qayd, vaqt tartibida</span>
      </h3>
      <ol className="gap-x-8 lg:columns-2">
        {shown.map((j, i) => (
          <li key={i} className={`flex break-inside-avoid items-baseline gap-2.5 border-b border-slate-100 py-1.5 text-[13.5px] ${j.kind === 'gap' ? 'text-amber-800' : 'text-slate-800'}`}>
            <span className="w-11 shrink-0 font-semibold text-slate-500 rx-num">{hm(j.at)}</span>
            <span className={`h-2 w-2 shrink-0 translate-y-[-1px] rounded-full ${j.who === 'teacher' ? 'bg-slate-700' : 'bg-indigo-400'}`} title={j.who === 'teacher' ? 'O‘qituvchi' : 'Talaba'} />
            <span className="min-w-0">{journalText(j)}{j.count ? <span className="text-slate-400"> ×{j.count}</span> : null}</span>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-700" /> o‘qituvchi</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-400" /> talaba</span>
        {rows.length > 10 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="rx-no-print inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-700">
            <ChevronDown size={14} className={all ? 'rotate-180' : ''} /> {all ? 'Qisqartirish' : `Hammasini ko‘rsatish (${rows.length})`}
          </button>
        )}
      </div>
    </section>
  );
}
