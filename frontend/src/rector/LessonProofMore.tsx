import { useState } from 'react';
import { BarChart3, ChevronDown, DoorOpen, History, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { LessonProof as Proof } from './rectorApi';
import { lateText } from './LessonProof';
import { lessonPhase } from './lessonPhase';

/**
 * Dalillarning ikkinchi qatlami (2026-11-16): xona isboti, o'qituvchining 30 kunlik odati, test tahlili.
 */

function Card({ title, icon: Icon, children, right }: { title: string; icon: LucideIcon; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
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

/** Familiya va ism — otasining ismisiz (jadvalda sig'ishi uchun). */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.slice(0, 2).join(' ') || full;
}

/**
 * Xona isboti. Boshqa O'QITUVCHILARNING darslari va shu o'qituvchining o'z darslari ALOHIDA sanaladi:
 * ilgari hammasi "boshqa darslar" deb ko'rsatilardi (2026-11-16 tuzatish).
 */
export function RoomDay({ r, taught, date = '' }: { r: NonNullable<Proof['room_day']>; taught: boolean; date?: string }) {
  const othersDone = r.others_done ?? 0;
  const othersUsed = r.others_used ?? 0;
  const ownUsed = r.own_used ?? 0;
  let tone = 'bg-slate-50 text-slate-600';
  let verdict = 'Shu kuni bu xonada boshqa tugagan dars yo‘q — xona haqida xulosa qilib bo‘lmaydi.';
  if (othersUsed) {
    tone = 'bg-emerald-50 text-emerald-900';
    verdict = `Monitor ishlagan: shu kuni bu xonada boshqa o‘qituvchilarning ${othersDone} darsidan ${othersUsed} tasi iMentor’da o‘tilgan.${taught ? '' : ' «Monitor ishlamadi» degan bahona o‘rinsiz.'}`;
  } else if (ownUsed) {
    tone = 'bg-emerald-50 text-emerald-900';
    verdict = `Monitor ishlagan: shu kuni shu xonada o‘zining boshqa ${ownUsed} darsini iMentor’da o‘tgan.${taught ? '' : ' Demak bu darsda ham ishlatishi mumkin edi.'}`;
  } else if (othersDone >= 2) {
    tone = 'bg-amber-50 text-amber-900';
    verdict = `Shu kuni bu xonada boshqa o‘qituvchilarning ${othersDone} darsidan birortasi ham iMentor’da o‘tilmagan — avval monitor jihozini tekshiring.`;
  } else if (othersDone + (r.own_done ?? 0) > 0) {
    verdict = 'Shu kuni bu xonadagi boshqa darslarda ham iMentor ishlatilmagan, lekin darslar kam — xona haqida qat’iy xulosa qilib bo‘lmaydi.';
  }
  return (
    <Card title={`Xona isboti — ${r.room || r.monitor_id}`} icon={DoorOpen}>
      <p className={`rounded-xl px-3 py-2 text-[13.5px] leading-snug ${tone}`}>{verdict}</p>
      {r.lessons.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-100">
          {r.lessons.map((x, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="w-[86px] shrink-0 text-slate-500 rx-num">{x.para} · {x.start_time}</span>
              <span className="min-w-0 flex-1 truncate">
                <b className="text-slate-800">{x.own ? 'O‘zi' : x.teacher_name}</b> <span className="text-slate-500">· {x.subject}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold ${x.pending ? 'bg-sky-100 text-sky-700' : x.used ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>
                {x.pending ? (date && lessonPhase(date, x.start_time, x.end_time) === 'upcoming' ? 'boshlanmagan' : 'davom etmoqda') : x.used ? `o‘tilgan · ${x.minutes} daq` : 'o‘tilmagan'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function HistoryCard({ h, p, minutes }: { h: NonNullable<Proof['history']>; p: Proof; minutes: number }) {
  if (!h.lessons) return null;
  const late = p.teacher.late_minutes;
  const rows = [
    { label: 'iMentor’da ishlagan', now: `${minutes} daq`, avg: `${h.avg_minutes} daq`, worse: minutes < (h.avg_minutes ?? 0) - 10 },
    { label: 'iMentor’ni ochgan vaqti', now: late === null ? 'ochmagan' : lateText(late), avg: h.median_late === null || h.median_late === undefined ? '—' : lateText(h.median_late),
      worse: late === null || (h.median_late != null && late > h.median_late + 5 && late > 5) },
  ];
  return (
    <Card title={`Oxirgi ${h.days} kundagi odati bilan solishtirish`} icon={History}>
      <p className="mb-3 text-[13.5px] leading-snug text-slate-700">
        Nazoratdagi <b>{h.lessons}</b> ta darsdan <b>{h.done}</b> tasini iMentor’da o‘tgan (<b>{h.percent}%</b>), {h.opened} tasida iMentor’ni ochgan.
      </p>
      <table className="w-full text-[13.5px]">
        <thead className="text-left text-[12px] font-semibold uppercase tracking-wide text-slate-400">
          <tr><th className="py-1.5" /><th className="py-1.5 text-right">Shu dars</th><th className="py-1.5 text-right">Odatda</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-slate-100">
              <td className="py-2 text-slate-600">{r.label}</td>
              <td className={`py-2 text-right font-bold rx-num ${r.worse ? 'text-rose-700' : 'text-slate-900'}`}>{r.now}</td>
              <td className="py-2 text-right text-slate-500 rx-num">{r.avg}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function TestAnalysis({ it }: { it: NonNullable<Proof['integrity']> }) {
  const [all, setAll] = useState(false);
  if (!it.students) return null;
  const qs = it.questions.filter((q) => q.answered > 0);
  if (!qs.length) return null;
  const shown = all ? qs : qs.slice(0, 4);
  const clean = it.same_wrong_pairs.length === 0 && it.fast.length === 0;
  return (
    <Card title="Test tahlili" icon={BarChart3} right={<span className="text-[12.5px] text-slate-400">{it.students} talaba · {qs.length} savol</span>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div>
          <p className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-slate-400">Savollar — eng ko‘p xato qilinganidan</p>
          <ul className="space-y-2.5">
            {shown.map((q) => {
              const pct = q.percent ?? 0;
              const tone = pct < 40 ? 'rose' : pct < 70 ? 'amber' : 'emerald';
              return (
                <li key={q.question} className="text-[13px]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="line-clamp-2 text-slate-700" title={q.question}>{q.question}</span>
                    <span className={`shrink-0 text-right font-bold rx-num ${tone === 'rose' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {q.correct}/{q.answered}<span className="block text-[11px] font-normal text-slate-400">to‘g‘ri</span>
                    </span>
                  </div>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span className={`block h-full rounded-full ${tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
          {qs.length > 4 && (
            <button type="button" onClick={() => setAll((v) => !v)} className="rx-no-print mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-700">
              <ChevronDown size={14} className={all ? 'rotate-180' : ''} /> {all ? 'Qisqartirish' : `Hamma savollar (${qs.length})`}
            </button>
          )}
        </div>
        <div className="space-y-3">
          <p className="text-[12.5px] font-semibold uppercase tracking-wide text-slate-400">Halollik tekshiruvi</p>
          {clean && (
            <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[13.5px] text-emerald-900">
              <ShieldCheck size={17} className="mt-[1px] shrink-0 text-emerald-600" />
              Ko‘chirish belgisi topilmadi: javoblar bir-biridan mustaqil, hech kim o‘qimasdan belgilamagan.
            </p>
          )}
          {it.same_wrong_pairs.length > 0 && (
            <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-[13.5px] text-amber-950">
              <p className="mb-1.5 flex items-center gap-1.5 font-semibold"><ShieldAlert size={16} className="text-amber-600" /> Ehtimoliy ko‘chirish — {it.same_wrong_pairs.length} juftlik</p>
              <ul className="space-y-1.5">
                {it.same_wrong_pairs.map((x, i) => (
                  <li key={i}>
                    <b>{shortName(x.a)}</b> va <b>{shortName(x.b)}</b>: {x.same_wrong} ta savolda aynan bir xil xato variant
                    {x.expected != null && <span className="text-amber-800/80"> (tasodifan kutilgani ≈ {x.expected})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {it.fast.length > 0 && (
            <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-[13.5px] text-amber-950">
              <p className="mb-1.5 flex items-center gap-1.5 font-semibold"><ShieldAlert size={16} className="text-amber-600" /> O‘qimasdan belgilagan — {it.fast.length} talaba</p>
              <ul className="space-y-1">
                {it.fast.map((x) => (
                  <li key={x.student_id}><b>{shortName(x.name || x.student_id)}</b>: {x.questions} savolga {x.seconds} soniya, {x.score} tasi to‘g‘ri</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[12px] leading-snug text-slate-400">
            Ko‘chirish belgisi: ikki talabaning bir xil xatolari tasodifan kutilganidan ancha ko‘p bo‘lsa. Qiyin savolda ko‘pchilik bir xil xato qilishi hisobga olinadi.
          </p>
        </div>
      </div>
    </Card>
  );
}
