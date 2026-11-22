import { CheckCircle2, Clock3, Scale, XCircle } from 'lucide-react';
import type { ScheduledLessonRow } from './rectorApi';

/**
 * «Baho asosi» (2026-11-19). Rektor: "mas'ullar «biz kirib ko'rdik, o'tyapti, tizim o'tmagan deyapti» deb
 * nolishyapti — hamma narsa fakt va izohi bilan tursin, asossiz ishlabdi dastur deya olmay qolmay".
 * Har shart alohida qatorda: talab, haqiqiy qiymat, bajarildimi. Raqamlar ro'yxat va dalillar bilan bir manbadan.
 */

export const NEED_MINUTES = 40;

type Row = { ok: boolean | null; title: string; fact: string };

export function basisRows(l: ScheduledLessonRow): Row[] {
  const min = l.minutes ?? 0;
  const md = l.modules;
  const rows: Row[] = [];
  if (l.verdict === 'students') {
    rows.push({ ok: true, title: 'iMentor’da dars o‘tilgan', fact: `talabalar o‘qituvchining jonli testida ishlagan (o‘zi ${min} daqiqa)` });
  } else if (l.verdict === 'block') {
    rows.push({ ok: true, title: 'iMentor’da dars o‘tilgan', fact: `ketma-ket ${l.block_size || 2} paraning boshqasida o‘tilgani bo‘yicha (shu parada ${min} daqiqa)` });
  } else if (l.verdict === 'group') {
    rows.push({ ok: false, title: `Kamida ${NEED_MINUTES} daqiqa iMentor’da ishlash`, fact: 'o‘qituvchining o‘z hisobida 0 daqiqa — faqat guruh talabalari faol' });
  } else {
    rows.push({
      ok: min >= NEED_MINUTES || l.verdict === 'full' || l.verdict === 'misuse',
      title: `Kamida ${NEED_MINUTES} daqiqa iMentor’da ishlash`,
      fact: min > 0 ? `${min} daqiqa ishlagan` : 'dars vaqtida ishlamagan',
    });
  }
  if (md) {
    const cyc = md.cycle > 1 ? ` (${md.cycle} paralik sikl bo‘yicha)` : '';
    if (md.open) {
      rows.push({ ok: null, title: 'Test va keys', fact: `sikl davom etmoqda — ${md.cycle} para tugagach tekshiriladi` });
    } else {
      rows.push({
        ok: md.test && md.test_minutes >= md.need_test,
        title: `Dars vaqtida test yaratish yoki o‘tkazish, kamida ${md.need_test} daqiqa`,
        fact: md.test ? `bor, test bo‘limida ${md.test_minutes} daqiqa${cyc}`
          : `yaratilmagan va o‘tkazilmagan${md.test_minutes ? ` — test bo‘limida ${md.test_minutes} daqiqa turgan, lekin natija yo‘q` : ''}${cyc}`,
      });
      rows.push({
        ok: md.case && md.case_minutes >= md.need_case,
        title: `Dars vaqtida keys yaratish yoki ishlatish, kamida ${md.need_case} daqiqa`,
        fact: md.case ? `bor, keys bo‘limida ${md.case_minutes} daqiqa${cyc}`
          : `yaratilmagan, javoblari ochilmagan${md.case_minutes ? ` — keys bo‘limida ${md.case_minutes} daqiqa turgan, lekin ishlatilmagan` : ''}${cyc}`,
      });
    }
  }
  return rows;
}

const VERDICT_TEXT: Record<string, string> = {
  full: 'Yashil — hamma shart bajarilgan.',
  students: 'Yashil — talabalar jonli testda ishlagan.',
  block: 'Yashil — ketma-ket paralar bo‘yicha.',
  misuse: 'Sariq — iMentor’da ishlagan, lekin test/keys sharti bajarilmagan.',
  short: `Sariq — ${NEED_MINUTES} daqiqaga yetmagan.`,
  group: 'Sariq — o‘qituvchi o‘zi ishlamagan, faqat talabalar faol.',
  none: 'Qizil — dars vaqtida iMentor ochilmagan.',
  pending: 'Dars hali tugamagan — tugagach baholanadi.',
};

export default function VerdictBasis({ l }: { l: ScheduledLessonRow }) {
  if (!l.counted || l.pending || !l.monitor_id) return null;
  const rows = basisRows(l);
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] sm:p-5" data-testid="verdict-basis">
      <h3 className="mb-1 flex flex-wrap items-center gap-2 text-[15px] font-bold text-slate-900">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white"><Scale size={15} /></span>
        Baho asosi
      </h3>
      <p className="mb-3 text-[13px] text-slate-600">{VERDICT_TEXT[l.verdict || ''] || ''}</p>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.title} className="flex items-start gap-2.5 py-2">
            {r.ok === null ? <Clock3 size={18} className="mt-[1px] shrink-0 text-sky-500" />
              : r.ok ? <CheckCircle2 size={18} className="mt-[1px] shrink-0 text-emerald-600" />
                : <XCircle size={18} className="mt-[1px] shrink-0 text-rose-600" />}
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-slate-800">{r.title}</span>
              <span className={`block text-[13px] ${r.ok === false ? 'text-rose-700' : 'text-slate-600'}`}>{r.fact}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] leading-snug text-slate-400">
        Hamma raqam iMentor qaydlaridan: o‘qituvchi hisobidagi faollik, yaratilgan test/keys va jonli testlar dars vaqtida
        (boshlanishidan 15 daqiqa oldin — tugaganidan 5 daqiqa keyin) olinadi. Pastda daqiqama-daqiqa dalil.
      </p>
    </section>
  );
}
