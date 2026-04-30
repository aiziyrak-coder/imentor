export type AppLanguage = 'uz' | 'ru' | 'en';

export const APP_LANGUAGE_STORAGE_KEY = 'imentor-ui-language-v1';

export function getAppLanguage(): AppLanguage {
  try {
    const raw = (localStorage.getItem(APP_LANGUAGE_STORAGE_KEY) || '').trim().toLowerCase();
    if (raw === 'uz' || raw === 'ru' || raw === 'en') return raw;
  } catch {
    // ignore
  }
  return 'uz';
}

export function setAppLanguage(lang: AppLanguage): void {
  try {
    localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // ignore
  }
}

export function localeForLanguage(lang: AppLanguage): string {
  if (lang === 'ru') return 'ru-RU';
  if (lang === 'en') return 'en-US';
  return 'uz-UZ';
}

export function inferPdfLanguage(text: string): AppLanguage {
  const sample = text.slice(0, 8000).toLowerCase();

  const cyr = (sample.match(/[а-яё]/g) || []).length;
  const lat = (sample.match(/[a-z]/g) || []).length;

  const ruHints = ['лекция', 'практика', 'тема', 'содержание', 'дисциплина'];
  const enHints = ['lecture', 'practical', 'topic', 'syllabus', 'course'];

  const ruScore = ruHints.reduce((acc, w) => acc + (sample.includes(w) ? 2 : 0), 0) + (cyr > lat ? 2 : 0);
  const enScore = enHints.reduce((acc, w) => acc + (sample.includes(w) ? 2 : 0), 0) + (lat > cyr ? 1 : 0);

  if (ruScore >= enScore + 2) return 'ru';
  if (enScore >= ruScore + 2) return 'en';

  const uzHints = ["ma'ruza", 'amaliy', 'mavzu', 'sillabus'];
  const uzScore = uzHints.reduce((acc, w) => acc + (sample.includes(w) ? 2 : 0), 0);
  if (uzScore >= 2) return 'uz';

  return cyr > lat ? 'ru' : 'en';
}

export function languageLabel(lang: AppLanguage): string {
  if (lang === 'ru') return 'Русский';
  if (lang === 'en') return 'English';
  return 'O\'zbek';
}
