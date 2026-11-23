/**
 * Test rejasi (rektor talabi, 2026-10-21):
 *  - 10 savol: 4 ta qiyin, 4 ta o'rta, 2 ta oson;
 *  - bugungi mavzu asosiy; o'tilgan mavzular bilan BOG'LANADI;
 *  - hali o'tilmagan mavzulardan savol TUSHMAYDI;
 *  - har savolda bitta so'roq, 5 variant, bitta to'g'ri javob.
 *
 * Xarajat: shu fan va mavzuda avval yaratilgan, tekshiruvdan o'tgan savollar
 * zaxiradan (`/prepared-content/question-pool/`) olinadi — AI faqat
 * yetishmaganini yozadi. Bu modul — AI'siz qismi: daraja, saralash, tekshiruv.
 */
import type { QuestionLevel, TestQuestion } from '../services/aiService';
import type { AppLanguage } from '../i18n/language';
import type { SubjectDomain } from './subjectDomain';
import { anyUzbekLeftover } from './outputLanguage';
import { UNGRADABLE, questionFlaws } from './testQuality';

export const LEVELS: QuestionLevel[] = ['hard', 'medium', 'easy'];

export type LevelCounts = Record<QuestionLevel, number>;

export type TestPlan = {
  /** Shu so'rovda nechta savol qaysi darajada. */
  levels: LevelCounts;
  /** O'tilgan mavzular (bog'lash uchun), sillabus tartibida. */
  taught: string[];
  /** Hali o'tilmagan mavzular — ulardan savol TUSHMASIN. */
  later: string[];
  /** Nechta savol o'tilgan mavzu bilan bog'lansin. */
  linked: number;
  /**
   * Aslida nechtasi kerak (2026-10-22, xarajat). So'rovda bir nechta ortiqcha
   * savol yoziladi: tashlanganlar o'rnini qoplaydi, qolgani zaxiraga tushadi.
   * Qo'shimcha to'ldirish chaqiruvi faqat yaroqli savollar shu sondan kam bo'lsa.
   */
  need?: number;
};

export type Composition = { pure: LevelCounts; link: LevelCounts };

/** 10 savollik test: o'tilgan mavzu bo'lsa 7 bugungi + 3 bog'lovchi, bo'lmasa 10 bugungi. */
export function planTargets(hasTaught: boolean): Composition {
  return hasTaught
    ? { pure: { hard: 3, medium: 3, easy: 1 }, link: { hard: 1, medium: 1, easy: 1 } }
    : { pure: { hard: 4, medium: 4, easy: 2 }, link: { hard: 0, medium: 0, easy: 0 } };
}

/**
 * Foydalanuvchi qarori (2026-10-26): har testda faqat `count` ta savol YANGI yoziladi, qolgani
 * shu mavzu bankidan. Yangilari avval qiyin o'rinlarga (bugungi mavzu, keyin bog'lovchi), so'ng
 * o'rta va osonga. Natija: `fresh` — AI yozadigan, `bank` — bazadan olinadigan o'rinlar.
 */
export function splitNewQuestions(targets: Composition, count: number): { fresh: Composition; bank: Composition } {
  const fresh: Composition = { pure: { hard: 0, medium: 0, easy: 0 }, link: { hard: 0, medium: 0, easy: 0 } };
  const bank: Composition = { pure: { ...targets.pure }, link: { ...targets.link } };
  let left = Math.max(0, Math.round(count) || 0);
  for (const level of LEVELS) {
    for (const part of ['pure', 'link'] as const) {
      const take = Math.min(left, bank[part][level]);
      bank[part][level] -= take;
      fresh[part][level] += take;
      left -= take;
    }
  }
  return { fresh, bank };
}

const NUMBER_WITH_UNIT = /\d+(?:[.,]\d+)?\s*(?:%|°|mm|sm|cm|mg|g\b|g\/|kg|ml|l\b|mmol|mkmol|µmol|u\/l|ед|мм|мг|мл|ммоль|\/min|\/daq|bpm|soat|kun|hafta|yil|час|дн|hour|day|week|year)/gi;

/** Daraja ko'rsatilmagan savol uchun: stem uzunligi va o'lchovlar soni bo'yicha. */
export function estimateLevel(q: Pick<TestQuestion, 'question' | 'level'>): QuestionLevel {
  if (q.level && LEVELS.includes(q.level)) return q.level;
  const text = q.question || '';
  const words = text.split(/\s+/).filter(Boolean).length;
  const data = (text.match(NUMBER_WITH_UNIT) || []).length;
  if (words >= 60 || data >= 4) return 'hard';
  if (words < 35 && data <= 1) return 'easy';
  return 'medium';
}

/** Zaxira yoki AI savoli testga yaraydimi (shakl, til, bitta so'roq). */
export function questionUsable(q: TestQuestion, language: AppLanguage): boolean {
  if (!q?.question?.trim() || (q.options || []).length !== 5) return false;
  if ((q.question.match(/[?？]/g) || []).length > 1) return false;
  const flaws = questionFlaws(q);
  if (flaws.some((f) => UNGRADABLE.has(f) || f === 'ikki_savol')) return false;
  if (language !== 'en' && hasEnglishPhrase([q.question, ...(q.options || [])].join(' '))) return false;
  return !anyUzbekLeftover([q.question, q.explanation, ...(q.options || [])], language);
}

/** O'zbek/rus savolda ko'chirilgan inglizcha ibora (2026-11-23: "osmoles per kilogram of water"). Bitta atama
 * (pH, DNA) emas — kamida ikkita inglizcha yordamchi so'z. */
const EN_GLUE = /\b(of|the|per|and|is|are|with|for|which|that|from)\b/gi;
export function hasEnglishPhrase(text: string): boolean {
  return (text.match(EN_GLUE) || []).length >= 2;
}

const STOP = new Set([
  'va', 'bilan', 'uchun', 'hamda', 'ularning', 'uning', 'turlari', 'asoslari', 'tamoyillari', 'usullari',
  'and', 'the', 'of', 'in', 'with', 'principles', 'methods', 'types',
  'и', 'в', 'с', 'при', 'их', 'методы', 'принципы', 'виды',
]);

/**
 * Ko'p mavzu nomida uchraydigan umumiy so'zlar — biror mavzuga xos emas. 2026-10-21:
 * "faolligi", "laboratoriya", "natijasi", "orqali" kabi so'zlar tufayli bazadagi
 * 80 savoldan 73 tasi "o'tilmagan mavzu" deb tashlanib, o'rniga pulli generatsiya
 * qilinardi.
 *
 * 2026-10-26: klinik stemning o'zida doim bo'ladigan so'zlar ham ("34 haftada", "keyingi
 * qadam", "arterial bosim", "holatini baholash", "homilador ayol"). Akusherlik testida
 * 13 savolning 13 tasi "Homiladorlikning 22 haftadan keyingi muddatlarida qon ketishi"
 * mavzusiga tegishli deb tashlanib, test 4–6 marta qayta yozilardi (5 daqiqagacha).
 */
const GENERIC_WORD =
  /^(?:faollig|laborator|metaboli|buzilish|natija|aniqla|qilish|orqali|miqdor|patolog|kasallik|diagnost|davola|profilakt|klinik|belgila|tizimi|hujayra|organizm|ahamiyat|xususiyat|ko.rsatkich|tekshir|zamonav|amaliy|nazariy|ta.sir|funktsi|funksi|function|disease|diagnos|treatme|clinica|patholo|metabol|disorde|laborat|activit|результ|наруш|диагнос|лечени|клинич|патолог|метабол|заболев|функци|исследов|hafta|keyin|holat|baho|bosim|arteria|muddat|ayol|bemor|week|follow|assessm|pressur|conditi|patient|недел|следующ|состоян|оценк|давлен|артери|пациен|больн|женщин)/;

/** Mavzu nomidagi o'ziga xos so'zlar (o'zagi 7+ harf — "glyukoza" ≠ "glyukoneogenez"). */
function topicWords(title: string): string[] {
  const words = (title || '')
    .toLowerCase()
    .replace(/[^\p{L}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 7 && !STOP.has(w) && !GENERIC_WORD.test(w));
  return [...new Set(words.map((w) => w.slice(0, Math.max(7, w.length - 2))))];
}

/**
 * Savol hali O'TILMAGAN mavzuga tegishlimi: BITTA o'tilmagan mavzu nomining o'ziga
 * xos (bugungi va o'tilgan mavzularda yo'q) so'zlaridan kamida ikkitasi savolda bor.
 * Ehtiyotkor qoida: shubhali bo'lsa — savol qoladi.
 */
export function mentionsLaterTopic(q: TestQuestion, later: string[], known: string[]): boolean {
  if (!later.length) return false;
  // O'zak 7 harf bo'yicha solishtiriladi: "homiladorlikda" (bugungi) va "homilador" (keyingi)
  // bir so'z — ilgari uzunroq o'zak boshqa deb sanalib, bugungi mavzu so'zi "keyingi" bo'lib qolardi.
  const own = new Set(known.flatMap(topicWords).map((s) => s.slice(0, 7)));
  const text = `${q.question} ${(q.options || [])[q.correctOptionIndex] || ''}`.toLowerCase();
  return later.some((title) => topicWords(title).filter((s) => !own.has(s.slice(0, 7)) && text.includes(s)).length >= 2);
}

/** Bog'lovchi savolning `link` i haqiqatan O'TILGAN mavzumi. */
export function linkedTaught(q: TestQuestion, taught: string[]): string | null {
  const link = (q.link || '').trim().toLowerCase();
  if (!link) return null;
  const hit = taught.find((t) => {
    const a = t.trim().toLowerCase();
    return a === link || a.startsWith(link) || link.startsWith(a.slice(0, Math.min(40, a.length)));
  });
  return hit ?? null;
}

export type Picked = { chosen: TestQuestion[]; missing: Composition; rest: TestQuestion[] };

/** Zaxiradan rejaga mos savollarni tanlaydi; nima yetishmasligini qaytaradi. */
export function pickByPlan(pool: TestQuestion[], target: Composition, taught: string[]): Picked {
  const missing: Composition = { pure: { ...target.pure }, link: { ...target.link } };
  const chosen: TestQuestion[] = [];
  const rest: TestQuestion[] = [];
  for (const q of pool) {
    const level = estimateLevel(q);
    const link = linkedTaught(q, taught);
    const bucket = link ? missing.link : missing.pure;
    if (bucket[level] > 0) {
      bucket[level] -= 1;
      // O'tilgan mavzu bo'lmagan "bog'lanish" yozuvi savolda qolmasin.
      const { link: _drop, ...rest } = q;
      chosen.push({ ...rest, level, ...(link ? { link } : {}) });
    } else {
      rest.push(q);
    }
  }
  // 2-o'tish (2026-10-21, xarajat): aniq o'rin topilmagan savol — yaqin o'ringa.
  // Qiyinroq savol osonroq o'ringa tushadi (hech qachon aksincha — "qiyin" o'rni
  // faqat qiyin savol bilan to'ladi); bog'lovchi o'ringa istalgan darajadagi
  // bog'lovchi savol. Ilgari bu bo'shliqlar uchun har safar yangi generatsiya
  // chaqirilardi, bazada mos savol tursa ham.
  const rank: Record<QuestionLevel, number> = { easy: 0, medium: 1, hard: 2 };
  // LEVELS tartibi (qiyin → oson): eng yaqin osonroq o'rin birinchi.
  const slotFor = (bucket: LevelCounts, level: QuestionLevel, anyLevel: boolean): QuestionLevel | null =>
    bucket[level] > 0 ? level : (LEVELS.find((s) => bucket[s] > 0 && (anyLevel || rank[s] < rank[level])) ?? null);
  const leftover: TestQuestion[] = [];
  for (const q of rest) {
    const level = estimateLevel(q);
    const link = linkedTaught(q, taught);
    const bucket = link ? missing.link : missing.pure;
    const slot = slotFor(bucket, level, Boolean(link));
    if (slot) {
      bucket[slot] -= 1;
      const { link: _drop, ...plain } = q;
      chosen.push({ ...plain, level, ...(link ? { link } : {}) });
    } else {
      leftover.push(q);
    }
  }
  return { chosen, missing, rest: leftover };
}

export function countOf(c: LevelCounts): number {
  return c.hard + c.medium + c.easy;
}

/** Testda tartib: osondan qiyinga. */
export function orderByLevel(questions: TestQuestion[]): TestQuestion[] {
  const rank: Record<QuestionLevel, number> = { easy: 0, medium: 1, hard: 2 };
  return [...questions].sort((a, b) => rank[estimateLevel(a)] - rank[estimateLevel(b)]);
}

const LEVEL_TEXT: Record<SubjectDomain, Record<QuestionLevel, string>> = {
  // 2026-10-21: "saviya past, USMLE 10+" — har daraja bir pog'ona qattiqroq.
  clinical: {
    hard: 'hard — USMLE Step 2 CK / Step 3 (NBME hard): 70–120 words; age, complaint with its timing, comorbidity and current medication, vitals and at least 3 labs with units, one finding is a deliberate trap; three reasoning steps (findings → diagnosis or mechanism → next best step, contraindication or complication)',
    medium: 'medium — USMLE Step 1/2 CK: 50–75 word vignette with at least three findings, one of them a distractor; two reasoning steps',
    easy: 'easy — USMLE Step 1 style: 35–50 word vignette with two findings; applying one principle, never a definition or a recall question',
  },
  biomedical: {
    hard: 'hard — 45–90 words; a specimen/experiment/mechanism with 3+ real measurements read together',
    medium: 'medium — 35–60 words; a condition with two findings, one is a distractor',
    easy: 'easy — 25–40 words; one clear finding or structure, still a reasoning question, never a definition',
  },
  academic: {
    hard: 'hard — 45–90 words; a concrete task with 3 constraints/figures read together',
    medium: 'medium — 35–60 words; a task with two conditions',
    easy: 'easy — 25–40 words; a short applied task, never a definition',
  },
};

/**
 * Oddiy farmakologiya darajalari (2026-11-18, `isBasicPharmacology`): biomedical qoidadagi "tajriba/preparat
 * + 3 o'lchov" o'rniga — dori, mexanizm, ko'rsatma, nojo'ya va o'zaro ta'sir. Kafedrada laboratoriya yo'q.
 */
const PHARMACOLOGY_LEVEL_TEXT: Record<QuestionLevel, string> = {
  hard: 'hard — 45–80 words; a short applied drug situation read in two steps (which drug or group fits and why another is contraindicated, or an adverse effect / interaction, its mechanism and the remedy); NO animal experiment, isolated organ or laboratory-measurement puzzle',
  medium: 'medium — 30–55 words; mechanism of action → effect, indication, contraindication, adverse effect or interaction of a named drug or group',
  easy: 'easy — 18–40 words; group, mechanism or main use of a named drug, still applied, never a bare definition',
};

/** Model uchun reja. ATAYLAB INGLIZCHA — o'zbekcha ko'rsatma natijani o'zbekchaga tortadi. */
export function buildTestPlanPrompt(
  plan: TestPlan,
  requestedCount: number,
  domain: SubjectDomain,
  pharmacology = false,
): string {
  const total = Math.max(1, countOf(plan.levels));
  const scale = (n: number) => Math.round((n * requestedCount) / total);
  const hard = scale(plan.levels.hard);
  const medium = scale(plan.levels.medium);
  const easy = Math.max(0, requestedCount - hard - medium);
  const linked = Math.min(requestedCount, Math.round((plan.linked * requestedCount) / total));
  const text = pharmacology ? PHARMACOLOGY_LEVEL_TEXT : (LEVEL_TEXT[domain] ?? LEVEL_TEXT.clinical);
  const short = (t: string) => (t.length > 90 ? `${t.slice(0, 90)}…` : t);
  const lines = [
    'TEST PLAN (mandatory):',
    `- Write exactly ${hard} questions with "level":"hard", ${medium} with "level":"medium", ${easy} with "level":"easy".`,
    `- Levels: ${text.hard}; ${text.medium}; ${text.easy}.`,
    '- Every question: exactly ONE question sentence with ONE question mark; 5 options of the same kind; exactly ONE correct.',
  ];
  if (linked > 0 && plan.taught.length) {
    lines.push(
      `- Exactly ${linked} question(s) must CONNECT today's topic with ONE previously taught topic from this list ` +
        `(copy its title exactly into "link"): ${plan.taught.slice(-12).map((t, i) => `${i + 1}) ${short(t)}`).join('; ')}. ` +
        'All other questions: "link":"".',
    );
  } else {
    lines.push('- "link":"" for every question.');
  }
  if (plan.later.length) {
    lines.push(
      `- These topics have NOT been taught yet — never ask about them or use them as the answer: ` +
        `${plan.later.slice(0, 20).map(short).join('; ')}.`,
    );
  }
  return lines.join('\n');
}
