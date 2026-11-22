import { useEffect, useState } from 'react';
import { Check, QrCode, Wifi, WifiOff, X } from 'lucide-react';
import { fetchTeacherDossier, type DossierFlag, type DossierRow, type ReportFilters, type ScheduledLessonRow, type TeacherDossier as Data } from './rectorApi';
import { Spinner } from './RectorUi';
import { hm, lateText } from './LessonProof';

/**
 * O'qituvchining dalillar jadvali (2026-11-16): har nazoratdagi darsi bir qatorda, aniq raqamlar bilan.
 * Belgi bosilsa — faqat shunday darslar qoladi; qator bosilsa — o'sha darsning to'liq dalillari ochiladi.
 */

export const FLAG_LABEL: Record<DossierFlag, { label: string; cls: string }> = {
  graded_not_opened: { label: 'HEMIS’da baho bor, iMentor ochilmagan', cls: 'bg-rose-600 text-white' },
  not_opened: { label: 'iMentor ochilmagan', cls: 'bg-rose-100 text-rose-800' },
  short: { label: 'Chala — 40 daqiqaga yetmagan', cls: 'bg-amber-100 text-amber-800' },
  misuse: { label: 'Test/keys yo‘q yoki 10 daqiqadan kam', cls: 'bg-amber-100 text-amber-800' },
  late: { label: '10 daqiqadan ko‘p kech ochgan', cls: 'bg-amber-100 text-amber-800' },
  outside: { label: 'Tashqi tarmoqdan', cls: 'bg-violet-100 text-violet-800' },
};

const ORDER: DossierFlag[] = ['graded_not_opened', 'not_opened', 'short', 'misuse', 'late', 'outside'];

function dd(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

function toLesson(r: DossierRow): ScheduledLessonRow {
  return {
    id: r.id, date: r.date, weekday: r.weekday, para: r.para, start_time: r.start_time, end_time: r.end_time,
    teacher_name: '', teacher_key: '', department: '', subject: r.subject, group: r.group, lesson_type: r.lesson_type,
    room: r.room, building: '', monitor_id: 'M', used: r.used, counted: true, students: r.tested, minutes: r.minutes,
    verdict: r.verdict as ScheduledLessonRow['verdict'], hemis_id: '', auditorium_code: '', monitor_room: '', monitor_department: '', synced_at: null,
  };
}

export default function TeacherDossier({ teacherKey, filters, onOpen }: { teacherKey: string; filters: ReportFilters; onOpen: (l: ScheduledLessonRow) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [flag, setFlag] = useState<DossierFlag | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    fetchTeacherDossier(teacherKey, filters)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError('Dalillar jadvalini yuklab bo‘lmadi.'));
    return () => {
      alive = false;
    };
  }, [teacherKey, filters.from, filters.to]);

  if (error) return <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>;
  if (!data) return <div className="py-6"><Spinner /><p className="mt-2 text-center text-[12.5px] text-slate-400">Har dars uchun dalillar va HEMIS baholari yig‘ilmoqda…</p></div>;
  const s = data.summary;
  if (!s.lessons) return <p className="rounded-2xl bg-white px-4 py-6 text-center text-[14px] text-slate-500 ring-1 ring-slate-900/[0.06]">Bu davrda nazoratdagi darsi yo‘q.</p>;
  const rows = flag ? data.rows.filter((r) => r.flags.includes(flag)) : data.rows;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'iMentor’da o‘tilgan', value: `${s.used}/${s.lessons}` },
          { label: 'iMentor’ni odatda ochadi', value: s.median_late == null ? '—' : lateText(s.median_late) },
          { label: 'Dars vaqtida faol (o‘rtacha)', value: `${s.avg_coverage}%` },
          { label: 'QR bilan xona kompyuterida', value: `${s.qr} dars` },
        ].map((t) => (
          <div key={t.label} className="rounded-2xl bg-white px-3 py-2.5 ring-1 ring-slate-900/[0.06]">
            <p className="text-[12px] text-slate-500">{t.label}</p>
            <p className="text-[20px] font-bold text-slate-900 rx-num">{t.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ORDER.filter((f) => (s.flags?.[f] ?? 0) > 0).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFlag(flag === f ? null : f)}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ${FLAG_LABEL[f].cls} ${flag === f ? 'ring-2 ring-slate-900' : flag ? 'opacity-50' : ''}`}
          >
            {FLAG_LABEL[f].label} · {s.flags?.[f]}
          </button>
        ))}
        {flag && <button type="button" onClick={() => setFlag(null)} className="rounded-full bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 ring-1 ring-slate-200">Hammasi</button>}
      </div>
      {data.hemis_error && <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">HEMIS ba’zi darslar uchun javob bermadi — o‘sha darslarda baho soni bo‘sh.</p>}

      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-900/[0.06]">
        <table className="w-full min-w-[920px] text-[13px]">
          <thead className="bg-slate-50 text-left text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Dars</th>
              <th className="px-2 py-2 text-center">Holat</th>
              <th className="px-2 py-2 text-right" title="iMentor'ni soat nechada ochgani — dars boshlanishiga nisbatan">iMentor’ni ochdi</th>
              <th className="px-2 py-2 text-right" title="Rejadagi dars daqiqalarining necha foizida iMentor'da faol">Dars vaqtida faol</th>
              <th className="px-2 py-2 text-right" title="Dars ichida iMentor'da harakat bo'lmagan eng uzun oraliq">Eng uzun tanaffus</th>
              <th className="px-2 py-2 text-center">Tarmoq</th>
              <th className="px-2 py-2 text-right" title="Guruh talabalaridan dars vaqtida iMentor'da faol bo'lganlar">Talaba</th>
              <th className="px-2 py-2 text-right">Test</th>
              <th className="px-3 py-2 text-right" title="HEMIS'da shu darsga qo'yilgan baholar soni">HEMIS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const red = r.flags.includes('graded_not_opened');
              return (
                <tr key={r.id} onClick={() => onOpen(toLesson(r))} className={`cursor-pointer border-t border-slate-100 hover:bg-indigo-50/50 ${red ? 'bg-rose-50' : ''}`}>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-slate-900 rx-num">{dd(r.date)} · {r.para}</span>
                    <span className="block max-w-[220px] truncate text-[12px] text-slate-500" title={`${r.subject} · ${r.group}`}>{r.group} · {r.subject}</span>
                  </td>
                  <td className="px-2 py-2 text-center">
                    {r.used ? <Check size={17} className="inline text-emerald-600" /> : r.trace ? <span className="text-[12px] font-bold text-amber-600">chala</span> : <X size={17} className="inline text-rose-600" />}
                    <span className="block text-[11px] text-slate-400 rx-num">{r.minutes} daq</span>
                  </td>
                  <td className={`px-2 py-2 text-right rx-num ${r.flags.includes('not_opened') ? 'text-rose-600' : (r.late ?? 0) > 10 ? 'font-bold text-amber-700' : 'text-slate-700'}`}>
                    {r.first
                      ? <>{hm(r.first)}<span className="block text-[11px] font-normal text-slate-400">{lateText(r.late ?? 0).replace('daqiqa', 'daq')}</span></>
                      : r.trace
                        ? <span className="text-[12px] text-slate-500" title="O'qituvchi hisobida qayd yo'q; dars talabalar testi yoki ketma-ket paralar bo'yicha hisoblangan">o‘z hisobida yo‘q</span>
                        : 'ochmagan'}
                  </td>
                  <td className={`px-2 py-2 text-right font-semibold rx-num ${!r.first ? 'text-slate-300' : r.coverage >= 50 ? 'text-emerald-700' : r.coverage >= 25 ? 'text-amber-700' : 'text-rose-700'}`}>{r.first ? `${r.coverage}%` : '—'}</td>
                  <td className="px-2 py-2 text-right rx-num text-slate-500">{r.first ? `${r.max_gap} daq` : '—'}</td>
                  <td className="px-2 py-2 text-center">
                    <span className="inline-flex items-center gap-1">
                      {r.network === 'campus' ? <Wifi size={15} className="text-emerald-600" /> : r.network === 'outside' ? <WifiOff size={15} className="text-violet-600" /> : <span className="text-slate-300">—</span>}
                      {r.qr && <QrCode size={15} className="text-sky-600" />}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right rx-num text-slate-700">{r.students_active}/{r.roster}</td>
                  <td className="px-2 py-2 text-right rx-num text-slate-700">{r.tested || '—'}</td>
                  <td className={`px-3 py-2 text-right rx-num ${red ? 'font-bold text-rose-700' : r.hemis_graded ? 'text-slate-800' : 'text-slate-300'}`}>{r.hemis_graded == null ? '—' : r.hemis_graded}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-slate-400">
        <Wifi size={12} className="inline text-emerald-600" /> institut tarmog‘i · <WifiOff size={12} className="inline text-violet-600" /> tashqi tarmoq ·{' '}
        <QrCode size={12} className="inline text-sky-600" /> xona kompyuteriga QR bilan kirgan · HEMIS — shu darsga qo‘yilgan baholar soni. Qatorni bosing — o‘sha darsning to‘liq dalillari ochiladi.
      </p>
    </div>
  );
}
