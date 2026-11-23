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

/** Para boshlanish vaqtlari (Toshkent). Hisoblagich har para uchun alohida (2026-11-23: bir mavzu 1-parada bir
 * guruhga, 2-parada boshqasiga o'tilsa vaqt noldan boshlanmay, "21 daq / 10 daq" bo'lib qolardi). */
const PARA_STARTS = ['08:00', '09:30', '11:00', '13:00', '14:30', '16:00', '17:30'];

function paraSlot(now = new Date()): string {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(now);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(now);
  // 10 daqiqa oldin ochilsa ham o'sha paraga yoziladi.
  const [h, m] = hm.split(':').map(Number);
  const mins = h * 60 + m + 10;
  let slot = 0;
  PARA_STARTS.forEach((s, i) => {
    const [sh, sm] = s.split(':').map(Number);
    if (mins >= sh * 60 + sm) slot = i + 1;
  });
  return `${day}:p${slot}`;
}

const keyFor = (t: SyllabusTopicContext, slot: string) =>
  `imentor-lesson-progress:${t.syllabusId}:${t.variantLabel}:${t.id}:${slot}`;

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
  mode = 'tracker',
}: {
  topic: SyllabusTopicContext;
  section?: LessonSection;
  language: AppLanguage;
  onOpen?: (section: LessonSection) => void;
  /** 2026-11-23 ("vaqt darsda xayolni olyapti"): `tracker` — dars sahifalarida KO'RINMAYDI, faqat vaqtni sanaydi;
   * `card` — Profil sahifasidagi "Bugungi dars rejasi" kartasi. */
  mode?: 'tracker' | 'card';
}) {
  // Para almashganda (sahifa ochiq qolsa ham) hisoblagich yangi paraga o'tadi.
  const [slot, setSlot] = useState(() => paraSlot());
  useEffect(() => {
    const id = window.setInterval(() => setSlot(paraSlot()), 30000);
    return () => window.clearInterval(id);
  }, []);
  const key = keyFor(topic, slot);
  const [spent, setSpent] = useState<Record<string, number>>(() => load(key));
  const plan = PLANS[topic.type === 'lecture' ? 'lecture' : 'practical'];
  const L = LABELS[language] ?? LABELS.uz;

  useEffect(() => setSpent(load(key)), [key]);
  // Kartada — trekker yozgan qiymatlarni qayta o'qib turadi.
  useEffect(() => {
    if (mode !== 'card') return undefined;
    const id = window.setInterval(() => setSpent(load(key)), 5000);
    return () => window.clearInterval(id);
  }, [key, mode]);

  // Bo'lim uchun material shu mavzuda yaratilgan bo'lsa — bajarilgan (2026-11-23 shikoyati: faqat
  // vaqt sanalib, ma'ruza/taqdimot/test tayyor bo'lsa ham "0/6" ko'rinardi). Bo'lim almashganda yangilanadi.
  const [made, setMade] = useState<Partial<Record<LessonSection, boolean>>>({});
  useEffect(() => {
    if (mode !== 'card') return undefined;
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
  }, [key, mode, topic]);

  // Har soniyada joriy bo'limga vaqt qo'shiladi (sahifa ko'rinib turgan bo'lsa); har 5 s saqlanadi.
  useEffect(() => {
    if (mode !== 'tracker' || !section) return undefined;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setSpent((prev) => {
        const next = { ...prev, [section]: (prev[section] || 0) + 1 };
        if (next[section] % 5 === 0) save(key, next);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [key, section, mode]);

  // "23 son" / "6 daq" (2026-11-23: "0:23" 23 daqiqa deb o'qilardi).
  const mins = (s: number) => (s < 60 ? `${s} ${L.sec}` : `${Math.floor(s / 60)} ${L.min}`);
  // ✓ — faqat VAQT bajarilganda (ajratilganining yarmi). Material tayyorligi alohida belgi.
  const isDone = (s: LessonSection, m: number) => (spent[s] || 0) >= m * 60 * 0.5;
  const doneCount = useMemo(
    () => plan.filter(([s, m]) => (spent[s] || 0) >= m * 60 * 0.5).length,
    [plan, spent],
  );

  if (mode === 'tracker') return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 text-[13px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[17px] font-bold text-slate-900">
          <Clock size={16} /> {L.title}
        </h3>
        <span className="text-slate-500">
          {doneCount}/{plan.length} · {L.done.toLowerCase()}
        </span>
      </div>
      <p className="mt-1 text-slate-500">{topic.title}</p>
      <ul className="mt-3 space-y-2">
        {plan.map(([s, m]) => {
          const u = spent[s] || 0;
          const r = Math.min(1, u / (m * 60));
          const over = u > m * 60;
          return (
            <li key={s}>
              <button
                type="button"
                onClick={() => onOpen?.(s)}
                className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    {isDone(s, m) ? (
                      <CheckCircle2 size={14} className="text-emerald-600" />
                    ) : (
                      <span className="inline-block h-3.5 w-3.5 rounded-full border border-slate-300" />
                    )}
                    {L[s]}
                    {made[s] && (
                      <span className="rounded bg-blue-50 px-1 text-[10px] font-medium text-blue-700">{L.ready}</span>
                    )}
                  </span>
                  <span className={`tabular-nums ${over ? 'text-red-600' : 'text-slate-500'}`}>
                    {mins(u)} / {m} {L.min}
                  </span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full ${over ? 'bg-red-500' : r >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${r * 100}%` }}
                  />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
