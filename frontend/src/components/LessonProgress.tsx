import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import type { SyllabusTopicContext } from '../utils/syllabusTopicContext';
import type { AppLanguage } from '../i18n/language';
import { listPreparedForTopicResult, type PreparedContentKind } from '../utils/preparedContentStore';

/**
 * Dars bo'limlari indikatori (2026-11-23, o'qituvchilar so'rovi: "taqdimotda, keys muhokamasida
 * ko'p qolib ketyapmiz"). Har bo'lim sahifasida kichik panel: shu bo'limga ajratilgan vaqtdan
 * qancha o'tgani (yashil → sariq → qizil) va darsning barcha bo'limlari holati.
 * Vaqt faqat sahifa ochiq va ko'rinib turganda sanaladi; mavzu bo'yicha brauzerda saqlanadi.
 */

export type LessonSection = 'lectures' | 'presentation' | 'videos' | 'handouts' | 'cases' | 'tests';

/** Bir para = 80 daqiqa. Amaliy darsda keys va test asosiy; ma'ruzada matn va taqdimot. */
const PLANS: Record<'practical' | 'lecture', Array<[LessonSection, number]>> = {
  practical: [['lectures', 10], ['presentation', 15], ['videos', 5], ['handouts', 5], ['cases', 20], ['tests', 20]],
  lecture: [['lectures', 35], ['presentation', 30], ['videos', 5], ['tests', 10]],
};

const LABELS: Record<AppLanguage, Record<LessonSection | 'title' | 'min' | 'sec' | 'over' | 'done' | 'ready', string>> = {
  uz: { lectures: "Ma'ruza", presentation: 'Taqdimot', videos: 'Video', handouts: 'Tarqatma', cases: 'Keys', tests: 'Test',
    title: 'Dars rejasi', min: 'daq', sec: 'son', over: "Vaqt tugadi — keyingi bo'limga o'ting", done: 'Bajarildi',
    ready: 'tayyor' },
  ru: { lectures: 'Лекция', presentation: 'Презентация', videos: 'Видео', handouts: 'Раздатка', cases: 'Кейс', tests: 'Тест',
    title: 'План занятия', min: 'мин', sec: 'сек', over: 'Время вышло — переходите к следующему разделу', done: 'Выполнено',
    ready: 'готово' },
  en: { lectures: 'Lecture', presentation: 'Slides', videos: 'Video', handouts: 'Handout', cases: 'Case', tests: 'Test',
    title: 'Lesson plan', min: 'min', sec: 's', over: 'Time is up — move to the next section', done: 'Done',
    ready: 'ready' },
};

const keyFor = (t: SyllabusTopicContext) =>
  `imentor-lesson-progress:${t.syllabusId}:${t.variantLabel}:${t.id}:${new Date().toISOString().slice(0, 10)}`;

function load(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function save(key: string, data: Record<string, number>) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* saqlab bo'lmasa ham indikator ishlaydi */
  }
}

export function isLessonSection(view: string): view is LessonSection {
  return ['lectures', 'presentation', 'videos', 'handouts', 'cases', 'tests'].includes(view);
}

export default function LessonProgress({
  topic,
  section,
  language,
  onOpen,
}: {
  topic: SyllabusTopicContext;
  section: LessonSection;
  language: AppLanguage;
  onOpen?: (section: LessonSection) => void;
}) {
  const key = keyFor(topic);
  const [spent, setSpent] = useState<Record<string, number>>(() => load(key));
  const [open, setOpen] = useState(false);
  const plan = PLANS[topic.type === 'lecture' ? 'lecture' : 'practical'];
  const L = LABELS[language] ?? LABELS.uz;

  useEffect(() => setSpent(load(key)), [key]);

  // Bo'lim uchun material shu mavzuda yaratilgan bo'lsa — bajarilgan (2026-11-23 shikoyati: faqat
  // vaqt sanalib, ma'ruza/taqdimot/test tayyor bo'lsa ham "0/6" ko'rinardi). Bo'lim almashganda yangilanadi.
  const [made, setMade] = useState<Partial<Record<LessonSection, boolean>>>({});
  useEffect(() => {
    let alive = true;
    const kinds: Array<[LessonSection, PreparedContentKind]> = [
      ['lectures', 'lecture'], ['presentation', 'presentation'], ['cases', 'case'], ['tests', 'test'],
    ];
    void Promise.all(
      kinds.map(async ([s, k]) => {
        const r = await listPreparedForTopicResult(k, topic).catch(() => null);
        return [s, Boolean(r?.ok && r.items.length)] as const;
      }),
    ).then((rows) => {
      if (alive) setMade(Object.fromEntries(rows));
    });
    return () => {
      alive = false;
    };
  }, [key, section, topic]);

  // Har soniyada joriy bo'limga vaqt qo'shiladi (sahifa ko'rinib turgan bo'lsa); har 5 s saqlanadi.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setSpent((prev) => {
        const next = { ...prev, [section]: (prev[section] || 0) + 1 };
        if (next[section] % 5 === 0) save(key, next);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [key, section]);

  const budget = (plan.find(([s]) => s === section)?.[1] ?? 10) * 60;
  const used = spent[section] || 0;
  const ratio = used / budget;
  const color = ratio >= 1 ? 'bg-red-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500';
  const text = ratio >= 1 ? 'text-red-700' : ratio >= 0.8 ? 'text-amber-700' : 'text-emerald-700';
  // "23 son" / "6 daq" (2026-11-23: "0:23" 23 daqiqa deb o'qilardi).
  const mins = (s: number) => (s < 60 ? `${s} ${L.sec}` : `${Math.floor(s / 60)} ${L.min}`);
  // ✓ — faqat VAQT bajarilganda (ajratilganining yarmi). Material tayyorligi alohida belgi (2026-11-23:
  // "galochka qo'yilgan, lekin 1 daqiqa ham bo'lmadi" — avval yaratilgan test ✓ qo'yardi).
  const isDone = (s: LessonSection, m: number) => (spent[s] || 0) >= m * 60 * 0.5;
  const doneCount = useMemo(
    () => plan.filter(([s, m]) => (spent[s] || 0) >= m * 60 * 0.5).length,
    [plan, spent],
  );

  return (
    <div className="fixed right-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom,0px))] md:bottom-12 z-40 print:hidden">
      <div className="w-60 rounded-xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur text-[11px]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full px-3 py-2 text-left"
          aria-expanded={open}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 font-semibold text-slate-700">
              <Clock size={12} /> {L[section]}
            </span>
            <span className={`font-semibold tabular-nums ${text}`}>
              {mins(used)} / {budget / 60} {L.min}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </div>
          {ratio >= 1 && <div className="mt-1 text-red-700">{L.over}</div>}
          <div className="mt-1 text-slate-500">
            {L.title}: {doneCount}/{plan.length}
          </div>
        </button>
        {open && (
          <ul className="border-t border-slate-100 px-3 py-2 space-y-1">
            {plan.map(([s, m]) => {
              const u = spent[s] || 0;
              const done = isDone(s, m);
              return (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => onOpen?.(s)}
                    className={`flex w-full items-center justify-between rounded px-1 py-0.5 hover:bg-slate-50 ${s === section ? 'font-semibold' : ''}`}
                  >
                    <span className="flex items-center gap-1">
                      {done ? <CheckCircle2 size={12} className="text-emerald-600" /> : <span className="inline-block h-3 w-3 rounded-full border border-slate-300" />}
                      {L[s]}
                      {made[s] && (
                        <span className="rounded bg-blue-50 px-1 text-[9px] font-medium text-blue-700">{L.ready}</span>
                      )}
                    </span>
                    <span className={`tabular-nums ${u > m * 60 ? 'text-red-600' : 'text-slate-500'}`}>
                      {mins(u)} / {m} {L.min}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
