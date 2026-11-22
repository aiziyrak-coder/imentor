import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Download, Search, X } from 'lucide-react';
import type { GradedNotOpened, ReportFilters } from './rectorApi';
import type { Person } from './PersonPanel';
import { Avatar } from './RectorViz';
import { downloadCsv, safeFileName } from './csv';
import { hm } from './LessonProof';

/**
 * «HEMIS'da baho qo'yilgan, iMentor ochilmagan» darslar — butun institut (2026-11-16).
 * Ro'yxat har kuni 02:30 va 19:30 da serverda yig'iladi (HEMIS'dan faqat o'qish).
 */

const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
function day(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}-${MONTHS[(m || 1) - 1]}`;
}

export default function GradedNotOpenedPage({ data, filters, onOpenPerson, onBack }: {
  data: GradedNotOpened | null;
  filters: ReportFilters;
  onOpenPerson: (p: Person) => void;
  onBack: () => void;
}) {
  const [q, setQ] = useState('');
  const [teacher, setTeacher] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onBack();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onBack]);

  const items = data?.items ?? [];
  const byTeacher = useMemo(() => {
    const m = new Map<string, { key: string; name: string; department: string; lessons: number; grades: number }>();
    for (const i of items) {
      const t = m.get(i.teacher_key) || { key: i.teacher_key, name: i.teacher_name, department: i.department, lessons: 0, grades: 0 };
      t.lessons += 1;
      t.grades += i.graded;
      m.set(i.teacher_key, t);
    }
    return [...m.values()].sort((a, b) => b.lessons - a.lessons || b.grades - a.grades);
  }, [items]);
  const needle = q.trim().toLowerCase();
  const rows = items.filter((i) => (!teacher || i.teacher_key === teacher)
    && (!needle || `${i.teacher_name} ${i.department} ${i.subject} ${i.group}`.toLowerCase().includes(needle)));
  const grades = items.reduce((a, i) => a + i.graded, 0);

  const csv = () => downloadCsv(
    safeFileName(`hemis-baho-imentor-ochilmagan-${filters.from}-${filters.to}`),
    ['Sana', 'Para', 'Vaqt', 'O‘qituvchi', 'Kafedra', 'Fan', 'Guruh', 'Xona', 'HEMIS baho', 'Guruhda talaba'],
    rows.map((i) => [i.date, i.para, `${i.start_time}-${i.end_time}`, i.teacher_name, i.department, i.subject, i.group, i.room, i.graded, i.roster]),
  );

  return (
    <div className="rx-rise space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack}
          className="ios-press inline-flex items-center gap-1 rounded-full bg-white px-3.5 py-2 text-[15px] font-semibold text-indigo-600 shadow-sm ring-1 ring-slate-200">
          <ArrowLeft size={17} /> Orqaga
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-bold tracking-tight text-slate-900">HEMIS’da baho qo‘yilgan, lekin iMentor ochilmagan darslar</h2>
          <p className="text-[14px] text-slate-500">
            {data?.ready
              ? <>{items.length} dars · {byTeacher.length} o‘qituvchi · {grades} ta baho · oxirgi tekshiruv {data.at ? `${new Date(data.at).toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit' })} ${hm(data.at)}` : '—'}</>
              : 'Ro‘yxat hali yig‘ilmagan — server har kuni 02:30 va 19:30 da tekshiradi.'}
          </p>
        </div>
        {rows.length > 0 && (
          <button type="button" onClick={csv} className="ios-press inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[14px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
            <Download size={16} /> Excel (CSV)
          </button>
        )}
      </div>

      <p className="flex items-start gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-[14px] leading-relaxed text-rose-900 ring-1 ring-rose-100">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600" />
        <span>
          Bu darslarda dars vaqtida o‘qituvchining iMentor’da birorta ham harakati, jonli testi yoki QR kirishi yo‘q, guruh talabalari ham ishlamagan —
          lekin HEMIS’da shu darsga talabalarga baho qo‘yilgan. Dars monitorli xonada bo‘lgan. Dars o‘tilganmi va baho qanday asosda qo‘yilgani so‘ralishi kerak.
          {data?.partial && <b> Tanlangan davrning boshi tekshirilgan oraliqdan ({data.scan_from}) oldin — faqat oxirgi 14 kun ko‘rsatilmoqda.</b>}
        </span>
      </p>

      {byTeacher.length > 0 && (
        <section className="ios-card p-4">
          <h3 className="mb-2.5 text-[15px] font-bold text-slate-900">O‘qituvchilar bo‘yicha</h3>
          <div className="flex flex-wrap gap-2">
            {byTeacher.map((t) => (
              <button key={t.key} type="button" onClick={() => setTeacher(teacher === t.key ? null : t.key)}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13.5px] ring-1 transition ${teacher === t.key ? 'bg-rose-600 text-white ring-rose-600' : 'bg-white text-slate-800 ring-slate-200 hover:ring-rose-300'}`}
                title={t.department}>
                <b>{t.name}</b>
                <span className={`rounded-full px-1.5 text-[12px] font-bold ${teacher === t.key ? 'bg-white/25' : 'bg-rose-100 text-rose-700'}`}>{t.lessons}</span>
              </button>
            ))}
            {teacher && (
              <button type="button" onClick={() => setTeacher(null)} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-[13px] font-semibold text-slate-600">
                <X size={14} /> Hammasi
              </button>
            )}
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section className="ios-card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
            <Search size={16} className="text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="O‘qituvchi, kafedra, fan yoki guruh"
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-slate-400" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[14px]">
              <thead className="bg-slate-50 text-left text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Dars</th>
                  <th className="px-3 py-2">O‘qituvchi</th>
                  <th className="px-3 py-2">Fan · guruh</th>
                  <th className="px-3 py-2">Xona</th>
                  <th className="px-4 py-2 text-right">HEMIS baho</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.lesson_id} className="border-t border-slate-100 hover:bg-rose-50/40">
                    <td className="px-4 py-2.5 rx-num">
                      <b className="text-slate-900">{day(i.date)}, {i.para}</b>
                      <span className="block text-[12.5px] text-slate-500">{i.weekday} · {i.start_time}–{i.end_time}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => onOpenPerson({ kind: 'teacher', key: i.teacher_key, name: i.teacher_name })}
                        className="flex items-center gap-2 text-left hover:text-indigo-700">
                        <Avatar name={i.teacher_name} size={30} />
                        <span>
                          <b className="block text-slate-900">{i.teacher_name}</b>
                          <span className="block max-w-[240px] truncate text-[12.5px] text-slate-500">{i.department}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="block max-w-[260px] truncate text-slate-800" title={i.subject}>{i.subject}</span>
                      <span className="text-[12.5px] text-slate-500">{i.group} · {i.lesson_type}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{i.room}</td>
                    <td className="px-4 py-2.5 text-right">
                      <b className="text-[17px] text-rose-700 rx-num">{i.graded}</b>
                      <span className="text-[12.5px] text-slate-400"> / {i.roster || '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {data?.ready && items.length === 0 && (
        <p className="ios-card px-4 py-10 text-center text-[15px] text-emerald-700">Bu davrda bunday dars topilmadi.</p>
      )}
    </div>
  );
}
