import type { TeacherRow } from './rectorApi';
import type { Status } from './RectorUi';

/**
 * Rektor hisobotining umumiy yordamchilari: bo'lim nomlari, modullar bo'yicha
 * daqiqalar, o'qituvchi holati va baho darajalari. (Eski bo'lim komponentlari
 * — umumiy manzara, o'qituvchilar, kafedralar, talabalar, darslar — 2026-11-17
 * da olib tashlandi: ular hech qayerda ishlatilmasdi.)
 */

/**
 * Bo'lim nomlari — bazada texnik kalit (`syllabus`, `lectures`) bo'lib
 * turadi. Rektor hisobotida ular odam o'qiydigan nomga aylanadi.
 */
const PAGE_LABEL: Record<string, string> = {
  syllabus: 'Mening fanlarim',
  lectures: "Ma'ruza matni",
  presentation: 'Taqdimotlar',
  videos: 'Videolar',
  handouts: 'Tarqatma materiallar',
  cases: 'Keys yaratish',
  tests: 'Test yaratish',
  'content-catalog': 'Keys va testlar bazasi',
  'my-tests': 'Mening testlarim',
  profile: 'Profil',
  'admin-dashboard': 'Boshqaruv paneli',
  'admin-staff': 'Hodimlar',
  'admin-staff-location': 'Joylashuv (GPS)',
  'admin-syllabuses': 'Sillabuslar',
  'admin-online-edu': "Online ta'lim",
  'admin-videos': 'Videolar (admin)',
  'admin-handouts': 'Tarqatmalar (admin)',
  'admin-books': 'Kitoblar',
  'admin-cases': 'Keyslar (admin)',
  'admin-tests': 'Testlar (admin)',
  other: 'Boshqa',
};

export function pageLabel(key: string): string {
  return PAGE_LABEL[key] || key;
}

/**
 * Rektor "qaysi moduldan necha daqiqa" deb so'raydi — bu ustunlar shu
 * savolga javob. Qolgan bo'limlar (profil va h.k.) "Boshqa"ga qo'shiladi.
 */
export const MODULES: Array<{ key: string; label: string; pages: string[] }> = [
  { key: 'syllabus', label: 'Fanlarim', pages: ['syllabus'] },
  { key: 'lectures', label: "Ma'ruza", pages: ['lectures'] },
  { key: 'presentation', label: 'Taqdimot', pages: ['presentation'] },
  { key: 'cases', label: 'Keys', pages: ['cases'] },
  { key: 'tests', label: 'Test', pages: ['tests', 'my-tests', 'content-catalog'] },
  { key: 'handouts', label: 'Tarqatma', pages: ['handouts'] },
  { key: 'videos', label: 'Video', pages: ['videos'] },
];

const MODULE_PAGES = new Set(MODULES.flatMap((m) => m.pages));

/** O'qituvchining modullar bo'yicha daqiqalari (+ `other`). */
export function moduleMinutes(pages: TeacherRow['pages']): Record<string, number> {
  const out: Record<string, number> = { other: 0 };
  for (const m of MODULES) out[m.key] = 0;
  for (const p of pages || []) {
    const mod = MODULES.find((m) => m.pages.includes(p.page));
    if (mod) out[mod.key] += p.minutes;
    else if (!MODULE_PAGES.has(p.page)) out.other += p.minutes;
  }
  return out;
}

/**
 * O'qituvchi holati bitta rangda:
 *   qizil   — oraliqda umuman ishlamagan, garchi jadval bo'yicha darsi bo'lgan bo'lsa ham;
 *   sariq   — kirgan, lekin na dars o'tgan, na material qo'shgan;
 *   yashil  — dars o'tgan yoki material qo'shgan;
 *   kulrang — baholanmaydi: hisobi bog'lanmagan YOKI bu kunlarda jadval bo'yicha darsi yo'q
 *             (darsi yo'q kuni kirmagan o'qituvchi "ishlamagan" emas — 2026-09-22 shikoyati).
 */
export function teacherStatus(r: TeacherRow): Status {
  if (r.schedule_linked === false) return 'none';
  if (!r.is_active) return r.scheduled_lessons === 0 ? 'none' : 'bad';
  if (r.lessons_total > 0 || r.created_total > 0) return 'good';
  return 'warn';
}

export const TEACHER_STATUS_SHORT: Record<Status, string> = {
  bad: 'Ishlamagan',
  warn: 'Faqat kirgan',
  good: 'Ishlagan',
  none: 'Hisob biriktirilmagan',
};

export const TEACHER_STATUS_TEXT: Record<Status, string> = {
  bad: 'Oraliqda iMentorga umuman kirmagan',
  warn: 'Kirgan, lekin dars ham o‘tmagan, material ham qo‘shmagan',
  good: 'Dars o‘tgan yoki material qo‘shgan',
  none: 'Jadvalda bor, iMentor hisobi bilan bog‘lanmagan. Faollik baholanmaydi.',
};

/** Kulrang holatning sababi: darsi yo'q kuni kirmagan yoki hisobi bog'lanmagan. */
function isNoLesson(r: TeacherRow): boolean {
  return r.schedule_linked !== false && !r.is_active && r.scheduled_lessons === 0;
}

export function teacherStatusShort(r: TeacherRow): string {
  return isNoLesson(r) ? 'Darsi yo‘q' : TEACHER_STATUS_SHORT[teacherStatus(r)];
}

export function teacherStatusText(r: TeacherRow): string {
  return isNoLesson(r)
    ? 'Monitor jadvali bo‘yicha bu kunlarda darsi yo‘q — baholanmaydi'
    : TEACHER_STATUS_TEXT[teacherStatus(r)];
}

/** Baho svetofor rangida: a'lo va yaxshi — yashil, qoniqarli — sariq, qoniqarsiz — qizil. */
export const BAND_LABEL: Record<string, { label: string; status: Status }> = {
  alo: { label: "A'lo", status: 'good' },
  yaxshi: { label: 'Yaxshi', status: 'good' },
  qoniqarli: { label: 'Qoniqarli', status: 'warn' },
  qoniqarsiz: { label: 'Qoniqarsiz', status: 'bad' },
};
