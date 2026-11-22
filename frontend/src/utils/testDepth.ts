/**
 * Test savolining MAZMUN darajasini tekshirish (rektor, 2026-10-13).
 *
 * `testQuality.ts` savolning SHAKLINI tekshiradi (bitta savol, javob sir,
 * variantlar teng). Lekin shakli to'g'ri savol ham yuzaki bo'lishi mumkin:
 *
 *   "Quyidagilardan qaysi biri gipertoniyaga xos?"  — bitta so'zni eslash;
 *   "Qaysi biri to'g'ri EMAS?"                      — inkor savol, chalkash;
 *   "Bemor keldi. Qaysi tashxis?"                   — ma'lumotsiz vignette.
 *
 * Shuning uchun bu yerda USMLE uslubidagi talablar tekshiriladi:
 *
 *  1. vignette ZICH bo'lsin — kamida ikki aniq ma'lumot (raqam+birlik yoki
 *     vaqt), aks holda fikrlash uchun tayanch yo'q;
 *  2. savol QARORGA olib borsin — "keyingi qadam", "eng ehtimoliy",
 *     "qaysi mexanizm", "nima mumkin emas" kabi;
 *  3. INKOR savol bo'lmasin ("qaysi biri EMAS") — u bilimni emas, diqqatni
 *     tekshiradi;
 *  4. variantlarda MUTLAQ so'z bo'lmasin ("har doim", "hech qachon") —
 *     ular javobni oshkor qiladi;
 *  5. izoh distraktorlarni RAD ETSIN — talaba xatosini shundan o'rganadi.
 *
 * Tekshiruv faqat ochiq-oydin kamchilikni tutadi: har bir rad etilgan savol
 * qayta so'rovga, ya'ni vaqt va token sarfiga olib keladi.
 */

export type DepthFlaw =
  | 'vignette_yuzaki'
  | 'eslash_savoli'
  | 'inkor_savol'
  | 'mutlaq_variant'
  | 'raqam_bezak'
  | 'izoh_yuzaki';

export type DepthInput = {
  question?: string;
  options?: string[];
  correctOptionIndex?: number;
  explanation?: string;
};

export type DepthOptions = {
  /** `academic` da bemor ma'lumoti talab qilinmaydi. */
  domain?: 'clinical' | 'biomedical' | 'academic';
  difficulty?: 'easy' | 'medium' | 'hard';
  /** Nurli tashxis: topilma raqam emas, nomlangan radiologik belgi. */
  imaging?: boolean;
};

/**
 * Fikrlash uchun tayanch bo'ladigan aniq ma'lumot.
 *
 * Ikki shakl sanaladi, chunki klinik matnda birlik har doim yozilmaydi:
 *   * raqam + birlik — "38,6 °C", "130/85 mm Hg", "8,2%";
 *   * ko'rsatkich nomi + raqam — "leykotsit 12 400", "troponin 2,4",
 *     "EChT 68", "HbA1c 8,2".
 *
 * Ilgari faqat birinchisi sanalardi va jonli savollarning 89% i "yuzaki"
 * bo'lib chiqardi — holbuki ularda raqam bor edi, faqat birligi yozilmagan.
 */
const DATA_POINT =
  /\d+(?:[.,]\d+)?\s*(?:°\s?C|mm\s?Hg|mmHg|mmol\/l|mg\/dl|g\/l|mg|mkg|ml|%|mm\/soat|zarb\/min|nafas\/min|ming\/mkl|ball|yosh|kun|soat|hafta|oy|yil)/gi;
const NAMED_VALUE = new RegExp(
  '\\b(?:' +
    // o'zbek / lotin
    'leykotsit\\w*|eritrotsit\\w*|gemoglobin|trombotsit\\w*|echt|esr|crp|troponin|kreatinin|urea' +
    '|glyukoza|hba1c|alt|ast|bilirubin|kaliy|natriy|kalsiy|ph|pco2|po2|spo2|puls|ab|bosim|harorat' +
    '|inr|aptt|ferritin|tsh|t4|amilaza|lipaza|albumin|protein|nitrit\\w*|siydik|titr' +
    // rus tilidagi fanlar uchun — ularni ham ko'rishi kerak, aks holda
    // ruscha savol nohaq "yuzaki" bo'lib chiqadi (2026-10-13 o'lchovi)
    '|лейкоцит\\w*|эритроцит\\w*|гемоглобин|тромбоцит\\w*|соэ|срб|тропонин|креатинин|мочевин\\w*' +
    '|глюкоза|глик\\w*|алт|аст|билирубин|калий|натрий|кальций|рн|пульс|ад|давлени\\w*|температур\\w*' +
    '|сатураци\\w*|фев1|фжел|свинц\\w*|белок|альбумин|титр|моч\\w*' +
    // inglizcha
    '|wbc|rbc|hgb|plt|bun|glucose|sodium|potassium|calcium|temperature|pulse|saturation' +
    ')\\b[^.;]{0,20}?\\d+(?:[.,]\\d+)?',
  'gi',
);

/** Qaror so'raydigan savol boshlanmalari. */
const DECISION =
  /(keyingi\s+(?:eng\s+)?(?:to['’`]?g['’`]?ri\s+)?qadam|eng\s+ehtimoliy|eng\s+to['’`]?g['’`]?ri|qaysi\s+mexanizm|qaysi\s+tuzilma|nima\s+(?:uchun\s+)?mumkin\s+emas|kontrendikatsiya|qaysi\s+(?:topilma|ko['’`]?rsatkich)|qanday\s+o['’`]?zgaradi|eng\s+yaxshi\s+tushuntiradi|birinchi\s+navbatda|most\s+likely|next\s+best\s+step)/i;

/** Yuzaki eslash savollari. */
const RECALL =
  /(quyidagilardan\s+qaysi\s+biri|qaysi\s+biri\s+(?:to['’`]?g['’`]?ri|xos|mos)|nima\s*\?|nimadan\s+iborat|ta['’`]?rifi|qaysi\s+javob)/i;

/** Inkor savol. */
const NEGATIVE =
  /(\bemas\b|\bnoto['’`]?g['’`]?ri\b|\bbo['’`]?lmaydi\b|\bistisno\b|\bexcept\b|\bnot\s+true\b)/i;

/**
 * Mutlaq so'zlar — variantni oshkor qiladi.
 *
 * Ilgari faqat "faqat shu", "har doim" tutilardi, oddiy "faqat ..." esa o'tib ketardi: prod'dagi
 * testda uchta savolda (10 dan) barcha noto'g'ri variant "faqat ..." bilan boshlanib, to'g'ri
 * javob esa shu so'zsiz edi — talaba savolni o'qimay topardi (2026-10-21).
 */
const ABSOLUTE =
  /(\bhar\s+doim\b|\bdoimo\b|\bhech\s+qachon\b|\bhamma\s+hollarda\b|\bfaqat(?:gina)?\b|\bbutunlay\b|\bmutlaqo\b|\bfaqat\s+shu\b|\bвсегда\b|\bникогда\b|\bтолько\b|\bисключительно\b|\balways\b|\bnever\b|\bonly\b|\bsolely\b|\bexclusively\b)/i;

/**
 * Stemdagi "bezak" raqamlar: javobga ta'sir qilmaydigan o'lchov va sanoqlar
 * ("82 dB, 6 mg/m3, 7 soat", "3 marta, 2 marta, 1 marta"). Bemorsiz fanda ular vignetteni
 * "zich" ko'rsatadi, lekin javob ulardan chiqmaydi.
 */
const STEM_NUMBER =
  /\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?\s*(?:ta\b|marta\b|dB\b|mg(?:\/\w+)?|mkg|ml\b|kg\b|g\/l|mm\b|sm\b|ppm\b|%|°\s?C|soat\w*|kun\w*|oy\w*|yil\w*|daqiqa\w*|sekund\w*|hafta\w*|yosh\w*)/gi;
const CALC_WORDS = /(hisobla|hisob-kitob|nechta|necha\b|qancha|foiz|o['’`]?rtacha|nisbat|formula|aniqlang|calculate|how\s+many)/i;

function fold(value: string): string {
  let text = (value || '').toLowerCase();
  for (const ch of '‘’ʻʼ`\'') text = text.split(ch).join('');
  return text;
}

/** Variantning tanib olinadigan o'zagi — izohda qidirish uchun. */
function keyword(option: string): string {
  const words = fold(option)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4);
  return words.sort((a, b) => b.length - a.length)[0] || '';
}

export function depthFlaws(q: DepthInput, opts: DepthOptions = {}): DepthFlaw[] {
  const out: DepthFlaw[] = [];
  const stem = String(q.question || '').trim();
  const options = (q.options || []).map((o) => String(o || ''));
  const explanation = String(q.explanation || '');
  if (!stem || options.length < 2) return out;

  const domain = opts.domain || 'clinical';
  const difficulty = opts.difficulty || 'hard';
  const words = stem.split(/\s+/).filter(Boolean).length;

  // 1. Vignette zichligi. `academic` fanlarda raqam har doim bo'lmaydi,
  //    shuning uchun u yerda faqat uzunlik talab qilinadi.
  const dataPoints =
    (stem.match(DATA_POINT) || []).length + (stem.match(NAMED_VALUE) || []).length;
  // Raqam faqat KLINIK vignettada talab qilinadi (2026-10-19). Biomedical
  // (gistologiya, anatomiya) va nurli tashxis savollarida bu talab modelni
  // uydirma ko'rsatkich yozishga majburlardi: "1 cm² dagi mikrovorsinka
  // soni", rentgenda "zichlik 15% oshgan". Ularda tayanch — preparat yoki
  // tasvirdagi nomlangan belgi.
  const needData = domain === 'clinical' && !opts.imaging && difficulty !== 'easy';
  // Klinik bo'lmagan fanda vazifa qisqaroq bo'lishi tabiiy (raqam ham shart
  // emas), lekin bir qatorlik ta'rif savoli bo'lib qolmasligi kerak.
  //
  // "Qiyin" daraja 2026-10-15 da ko'tarildi (rektor: "judayam oson"): javob
  // kamida UCH ma'lumotni birga talqin qilgandagina chiqishi kerak, shuning
  // uchun vignettada ham uchta topilma talab qilinadi.
  const minWords = domain === 'academic' ? 20 : difficulty === 'easy' ? 18 : difficulty === 'hard' ? 45 : 30;
  const minData = difficulty === 'hard' ? 3 : 2;
  if (words < minWords || (needData && dataPoints < minData)) out.push('vignette_yuzaki');

  // 2. Savol qarorga olib borsinmi.
  if (!DECISION.test(stem) && RECALL.test(stem)) out.push('eslash_savoli');

  // 3. Inkor savol — faqat savolning SO'ROQ qismida qaraladi.
  const tail = stem.slice(stem.lastIndexOf('.') + 1);
  if (NEGATIVE.test(tail)) out.push('inkor_savol');

  // 4. Mutlaq so'zli variant. To'g'ri javobda bunday so'z yo'q, noto'g'rilarida bor — javob oshkor;
  //    yoki ikki va undan ko'p variantda bor. Bitta variantdagi tabiiy "faqat" savolni buzmaydi.
  const idxAbs = q.correctOptionIndex;
  const absFlags = options.map((o) => ABSOLUTE.test(o));
  const absCount = absFlags.filter(Boolean).length;
  const correctAbs = typeof idxAbs === 'number' && absFlags[idxAbs] === true;
  if (absCount >= 2 || (absCount === 1 && !correctAbs)) out.push('mutlaq_variant');

  // 4b. Bezak raqamlar (faqat bemorsiz fanda): stemda 3+ o'lchov, variantlarda raqam yo'q va
  //     savol hisoblashni so'ramaydi — raqamlar javobga ta'sir qilmaydi.
  if (
    domain !== 'clinical' &&
    (stem.match(STEM_NUMBER) || []).length >= 3 &&
    !options.some((o) => /\d/.test(o)) &&
    !CALC_WORDS.test(stem)
  ) {
    out.push('raqam_bezak');
  }

  // 5. Izoh distraktorlarni rad etsinmi: noto'g'ri variantlarning kamida
  //    yarmi izohda eslansin. Qisqa izoh darhol yuzaki.
  const idx = q.correctOptionIndex;
  if (typeof idx === 'number' && idx >= 0 && idx < options.length) {
    const wrong = options.filter((_, i) => i !== idx);
    const mentioned = wrong.filter((o) => {
      const key = keyword(o);
      return key.length > 4 && fold(explanation).includes(key);
    }).length;
    if (explanation.trim().length < 120 || mentioned * 2 < wrong.length) {
      out.push('izoh_yuzaki');
    }
  }

  return out;
}

/** Modelga qaytib aytiladigan izoh. */
export function depthRetryNote(flaws: DepthFlaw[]): string {
  const WHY: Record<DepthFlaw, string> = {
    vignette_yuzaki:
      'savol YUZAKI: vignette qisqa yoki ichida aniq ma\'lumot yo\'q — kamida IKKI aniq topilma va vaqt bo\'lsin (klinikada raqam+birlik; morfologiya va radiologiyada nomlangan belgi, uydirma raqam EMAS)',
    eslash_savoli:
      'savol ESLASHNI tekshiradi ("quyidagilardan qaysi biri...", "X nima?") — o\'rniga QAROR so\'rang: keyingi eng to\'g\'ri qadam, eng ehtimoliy holat, qaysi mexanizm, nima mumkin emas',
    inkor_savol:
      'INKOR savol ishlatilgan ("qaysi biri to\'g\'ri EMAS") — bu bilimni emas, diqqatni tekshiradi; savolni to\'g\'ri shaklda bering',
    mutlaq_variant:
      'variantda MUTLAQ so\'z bor ("faqat", "har doim", "hech qachon", "butunlay") — noto\'g\'ri variantlarni "faqat ..." bilan yozmang, to\'g\'ri javob shu so\'zsiz topilib qoladi; 5 variant ham bir xil shaklda bo\'lsin',
    raqam_bezak:
      'stemdagi RAQAMLAR bezak ("82 dB, 6 mg/m3, 7 soat", "3 marta, 2 marta") — javob ulardan chiqmaydi; raqamni FAQAT javobga ta\'sir qilsa yozing, aks holda tashlang',
    izoh_yuzaki:
      'izoh YUZAKI: u faqat to\'g\'ri javobni takrorlagan — har bir NOTO\'G\'RI variant nega jalb qiladi va nega xato ekanini yozing',
  };
  const seen = Array.from(new Set(flaws));
  return [
    'OLDINGI SAVOLLARNING SAVIYASI YETARLI EMAS. Topilgan kamchiliklar:',
    seen.map((f) => `- ${WHY[f]}`).join('\n'),
    'Yangi savollar oliy tibbiy ta\'lim (USMLE Step 2 CK / rezidentura) darajasida bo\'lsin.',
  ].join('\n');
}
