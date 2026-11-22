/**
 * AI javobining TILINI tekshirish.
 *
 * Eng ko'p uchraydigan xato: rus tili so'ralganda model o'zbekcha matnni
 * tarjima qilmasdan kirilga TRANSLITERATSIYA qiladi ("Беморнинг исми Лайло,
 * 28 ёшда…"). Bunday matn kirilcha bo'lgani uchun oddiy "kirilmi?" tekshiruvidan
 * o'tib ketardi va foydalanuvchiga rus tili sifatida ko'rsatilardi.
 */
import type { AppLanguage } from '../i18n/language';

/** Lotin yozuvidagi o'zbek matni markerlari. */
const UZ_LATIN_MARKERS = [
  'bemor',
  'yoshli',
  'qaysi',
  'ushbu',
  'hisoblanadi',
  'murojaat',
  'aniqlanadi',
  'tavsiya',
  "bo'lib",
  'shifokorga',
  'davosida',
  'maqbul',
];

/** Kiril yozuvidagi o'zbek matni markerlari (rus tilida uchramaydi). */
const UZ_CYRILLIC_MARKERS = [
  'ёшли',
  'бўлиб',
  'бўлган',
  'қайси',
  'ушбу',
  'билан',
  'ҳисобланади',
  'терисида',
  'касаллиги',
  'аниқланади',
  'кузатилади',
  'мустаҳкам',
  'келди',
];

/** Faqat o'zbek kirilida bor harflar — rus alifbosida yo'q: қ ғ ҳ ў */
const UZ_ONLY_CYRILLIC_LETTERS = /[қҚғҒҳҲўЎ]/;

/**
 * Matn ichidagi manba havolasi — kitob nomi asl tilida qoladi: "(Источник: … Коммунал гигиена
 * қўлланма, 213-бет)". 2026-10-30: shu bitta "қ" to'g'ri ruscha matnni "o'zbekcha" qilib qo'yardi.
 * Server ham shu qoidani ishlatadi (`case_i18n._INLINE_SOURCE`, `_REFERENCE_HEADING`).
 */
const INLINE_SOURCE =
  /[([]\s*(?:manba|manbalar|adabiyot|источник|источники|литература|source|sources|ref\.?|references?)\s*[:.][^)\]]*[)\]]/gi;
/** Adabiyotlar bo'limi sarlavhasi — undan keyingi kitob nomlari til tekshiruviga kirmaydi. */
const REFERENCE_HEADING =
  /^\s*(?:#+\s*)?(?:\d+[.)]\s*)?(?:foydalanilgan\s+adabiyotlar|adabiyotlar(?:\s+ro.yxati)?|список\s+литературы|использованная\s+литература|литература|references|bibliography)/im;

/** Til tekshiruvi uchun matn: manba havolalari va adabiyotlar ro'yxatisiz. */
export function withoutSources(text: string): string {
  let s = text || '';
  const heading = REFERENCE_HEADING.exec(s);
  if (heading) s = s.slice(0, heading.index);
  return s.replace(INLINE_SOURCE, ' ');
}

export function looksLikeUzbekText(text: string): boolean {
  const s = withoutSources(text).toLowerCase();
  if (UZ_LATIN_MARKERS.reduce((n, m) => n + (s.includes(m) ? 1 : 0), 0) >= 2) return true;
  if (UZ_ONLY_CYRILLIC_LETTERS.test(s)) return true;
  return UZ_CYRILLIC_MARKERS.reduce((n, m) => n + (s.includes(m) ? 1 : 0), 0) >= 2;
}

/**
 * Ruscha/inglizcha matnda QOLIB KETGAN o'zbekcha (2026-10-21).
 *
 * Butun javobning tili to'g'ri bo'lsa ham, bitta variant yoki izoh o'zbekcha
 * qolardi ("Qon ivish tezlashadi; qon ketishi kamayadi") — xalqaro fakultet
 * talabasi buni o'qiy olmaydi. Shuning uchun HAR satr alohida tekshiriladi.
 * Server tarjimasi ham xuddi shu qoidani ishlatadi (`case_i18n.uzbek_left`).
 */
const UZ_LEFTOVER =
  /\b(?:va|bilan|uchun|yoki|emas|kerak|lekin|chunki|esa|ushbu|qaysi|qanday|hisoblanadi|bemor\w*|kasallik\w*|davola\w*|tashxis\w*|yosh(?:li|da)|erkak|ayol|holat\w*|natija\w*|qon|siydik|yurak|jigar|buyrak|harorat\w*|nafas|shikoyat\w*|belgi\w*|sabab\w*|hujayra\w*|tomir\w*|oshadi|kamayadi|ortadi|tushadi|kuzatiladi|aniqlanadi|uchraydi|rivojlanadi|kechadi|ko['‘’`ʻ]tariladi|bo['‘’`ʻ]l\w*|qil\w*|o['‘’`ʻ]z\w*|og['‘’`ʻ]r\w*|ko['‘’`ʻ]r\w*|to['‘’`ʻ]g['‘’`ʻ]r\w*)\b/gi;
/** o‘pka, og‘riq — maxsus tutuq belgisi bilan (oddiy ' inglizcha "o'clock" ni tutmasin). */
const UZ_APOSTROPHE = /\b\w*[oOgG][‘’ʻ`]\w+/g;

export function uzbekLeftover(text: string, target: AppLanguage): boolean {
  if (target !== 'ru' && target !== 'en') return false;
  const s = withoutSources(text);
  const words = (s.match(/[\p{L}]{2,}/gu) || []).length;
  if (!words) return false;
  if (UZ_ONLY_CYRILLIC_LETTERS.test(s)) return true;
  const hits = (s.match(UZ_LEFTOVER) || []).length + (s.match(UZ_APOSTROPHE) || []).length;
  return hits >= 2 && hits / words >= 0.08;
}

/** Bir nechta satrdan birortasida o'zbekcha qolganmi (bo'sh qatorlar bo'yicha bo'lib). */
export function anyUzbekLeftover(texts: (string | undefined | null)[], target: AppLanguage): boolean {
  return texts.some((t) =>
    String(t || '')
      .split(/\n\s*\n|\n(?=#)/)
      .some((piece) => piece.trim() && uzbekLeftover(piece, target)),
  );
}

export function cyrillicCharCount(text: string): number {
  let n = 0;
  for (const ch of text || '') {
    const code = ch.charCodeAt(0);
    if (code >= 0x0400 && code <= 0x04ff) n += 1;
  }
  return n;
}

/** Matn so'ralgan tilda EMASLIGINI aniqlaydi (qisqa matnlarda tekshirmaydi). */
export function outputLanguageLooksWrong(text: string, targetLang: AppLanguage): boolean {
  const s = withoutSources(text).trim();
  if (s.length < 40) return false;
  const cyrRatio = cyrillicCharCount(s) / s.length;
  if (targetLang === 'ru') {
    if (looksLikeUzbekText(s)) return true;
    return cyrRatio < 0.25; // rus matni asosan kirilcha bo'lishi kerak
  }
  if (targetLang === 'uz') return cyrRatio > 0.2; // o'zbekcha lotinda yoziladi
  return looksLikeUzbekText(s) || cyrRatio > 0.05; // en
}

function languageName(lang: AppLanguage): string {
  if (lang === 'ru') return 'Russian';
  if (lang === 'en') return 'English';
  return 'Uzbek';
}

/**
 * Modelga chiqish tilini qat'iy belgilaydigan, promptga qo'shiladigan ko'rsatma.
 *
 * ATAYLAB INGLIZCHA: ko'rsatmaning o'zi o'zbekcha bo'lsa, model javobni ham
 * o'zbekchaga tortadi. Shu sababli bu yerda o'zbekcha misol ham keltirilmaydi.
 */
export function strictLanguageDirective(targetLang: AppLanguage): string {
  const name = languageName(targetLang);
  const base =
    `LANGUAGE REQUIREMENT: write the ENTIRE output in ${name}. ` +
    'Do not leave any sentence in another language, and never transliterate words ' +
    'from one language into another alphabet. ';
  if (targetLang === 'ru') {
    return (
      base +
      'The output must be genuine Russian medical prose as a Russian physician would write it. ' +
      'Writing Uzbek words in Cyrillic letters is NOT Russian and is forbidden; ' +
      'the letters қ, ғ, ҳ, ў must never appear.'
    );
  }
  if (targetLang === 'uz') {
    return base + 'Use the Latin Uzbek alphabet; do not use Cyrillic letters.';
  }
  return base;
}

const EN_WORDS = /\b(the|is|are|not|no|could|cannot|must|should|file|found|required|invalid|failed|please|too|already|only|this|your|access|denied|error|try|again|session|key|topic|subject|lang)\b/gi;
const UZ_WORDS = /\b(va|yoki|uchun|bilan|emas|yo['‘’ʻ]q|topilmadi|kerak|mumkin|fayl\w*|ruxsat\w*|mavzu\w*|fan\w*|qayta|urinib|bo['‘’ʻ]l\w*|qil\w*|tanlang|kiring|xato\w*|hajmi|juda|katta|saqlan\w*|o['‘’ʻ]chir\w*|tizim\w*)\b/gi;

/**
 * Server xabari (`detail`) interfeys tilidami — QISQA matnlar uchun ham.
 *
 * Server xabarlari asosan o'zbekcha, ba'zilari inglizcha. Interfeys rus yoki
 * ingliz tilida bo'lsa, boshqa tildagi xabar ko'rsatilmaydi — o'rniga
 * chaqiruvchining tarjima qilingan umumiy matni chiqadi.
 */
export function textFitsLanguage(text: string, lang: AppLanguage): boolean {
  const s = (text || '').trim();
  if (!s) return false;
  const letters = (s.match(/[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ]/g) || []).length;
  if (letters < 3) return true; // raqam/kod — tilga bog'liq emas
  const cyr = cyrillicCharCount(s);
  if (cyr / letters > 0.5) return lang === 'ru' && !UZ_ONLY_CYRILLIC_LETTERS.test(s);
  if (lang === 'ru') return false;
  const en = (s.match(EN_WORDS) || []).length;
  const uz = (s.match(UZ_WORDS) || []).length + (s.match(/[og]['‘’ʻ]/gi) || []).length;
  if (lang === 'uz') return uz > 0 && uz >= en;
  return en > uz;
}

/** Iqtibos qavsi (manba nomi o'zbekcha bo'lishi to'g'ri) — tegilmaydi. */
const CITATION_GLOSS = /\b(?:source|sources|manba|источник|источники|references|литература)\b|\bp\.\s*\d|\bpage\b|-bet\b|стр\./i;
/** O'zbekcha qo'shimchalar: -lari, -dagi, -ishi … ("-ning", "-gan" yo'q: screening, organ). */
const UZ_SUFFIX = /\b\w+(?:larning|lari|larida|laridan|dagi|ishi|lishi|ligi|sida|siga)\b/gi;

/**
 * Inglizcha/ruscha matndagi o'zbekcha qavsli izohlarni olib tashlaydi (2026-10-21):
 * "Effusion (tana bo‘shliqlarida suyuqlik to‘planishi) is…" — ma'ruza promptidagi
 * "atamalar o'zbek adabiyotidagi shaklda" qoidasi ingliz tilidagi ma'ruzaga ham
 * berilgan edi. Qavs ichida kamida ikki o'zbekcha belgi bo'lsa olinadi; manba
 * iqtiboslari va oddiy inglizcha/ruscha qavslar qoladi.
 */
export function stripUzbekGlosses(text: string, target: AppLanguage): string {
  if (target !== 'ru' && target !== 'en') return text;
  return (text || '').replace(/\s?\(([^()\n]{3,160})\)/g, (whole, inner: string) => {
    // Raqamli qavs — standart, yil yoki bo'lim iqtibosi ("O'zMSt 134-2024, 3.3.1"), izoh emas.
    if (CITATION_GLOSS.test(inner) || /\d/.test(inner)) return whole;
    const score =
      (inner.match(UZ_LEFTOVER) || []).length +
      (inner.match(UZ_APOSTROPHE) || []).length +
      (inner.match(UZ_SUFFIX) || []).length +
      (UZ_ONLY_CYRILLIC_LETTERS.test(inner) ? 2 : 0);
    return score >= 2 ? '' : whole;
  });
}
