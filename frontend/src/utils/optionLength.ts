/**
 * To'g'ri javob eng uzun variant bo'lmasin (2026-11-18).
 *
 * Foydalanuvchi: "testda ko'pincha eng uzun javob to'g'ri chiqyapti". Prod o'lchovi
 * (16–18 noyabr, 929 test): savollarning 54% ida kalit eng uzun variant edi (tasodifan
 * 5 variantda 20% bo'lishi kerak), yangi yozilganlarda 65%. Promptdagi "variantlar bir
 * xil uzunlikda" va ekspert tekshiruvidagi "⚠ KALIT ENG UZUN" belgisi buni tuzatmadi:
 * model to'g'ri javobni har doim batafsilroq yozadi. Endi test yig'ilgach, alohida
 * so'rov FAQAT distraktorlarni kalit uzunligiga yetkazadi — kalit matni o'zgarmaydi,
 * natija shu yerdagi qoidalar bilan tekshiriladi; o'tmasa savol avvalgicha qoladi.
 */

/** Testda kalit eng uzun bo'lib qolishi mumkin bo'lgan savollar soni (tasodifiy darajada, 10 tadan 2). */
export const KEEP_LONGEST = 2;
/** Distraktor kalitdan shuncha qisqa bo'lsa ham sezilarli ("eng qisqasi noto'g'ri"). */
export const MIN_DISTRACTOR_SHARE = 0.65;
/** Distraktor kalitdan shuncha uzun bo'lmasin (ortiqcha o'qish). */
export const MAX_DISTRACTOR_SHARE = 1.5;
/** Hamma distraktor kalitdan shuncha uzun bo'lsa — endi "eng qisqasi to'g'ri" belgisi. */
export const SHORTEST_KEY_SLACK = 1.1;
/**
 * Har distraktorga beriladigan maqsad uzunlik (kalitga nisbatan): ikkitasi uzunroq, ikkitasi qisqaroq.
 * Haqiqiy savollardagi sinov (2026-11-18): so'z soni bilan berilganda model deyarli uzaytirmadi
 * (0/30 o'tdi), "85–120%" bilan esa hammasini 1.2–1.5 marta uzaytirib, kalitni eng qisqasi qildi;
 * har variantga aniq belgi soni berilganda 3 urinishda 31/36 o'tdi.
 */
export const DISTRACTOR_TARGETS = [1.12, 0.88, 1.05, 0.94];

type OptionQuestion = { options: string[]; correctOptionIndex: number };

/** Kalit qolgan barcha variantlardan uzunmi (backend `question_pool.key_length_rank` > 0 bilan bir xil). */
export function keyIsLongest(q: OptionQuestion): boolean {
  const options = q.options || [];
  const idx = q.correctOptionIndex;
  if (!Number.isInteger(idx) || idx < 0 || idx >= options.length || options.length < 2) return false;
  const key = String(options[idx] ?? '').length;
  return key > Math.max(...options.filter((_, k) => k !== idx).map((o) => String(o ?? '').length));
}

/** Kalit eng uzun distraktordan necha marta uzun (1 dan katta — eng uzun). */
function keyMargin(q: OptionQuestion): number {
  const lens = q.options.map((o) => String(o ?? '').length);
  const other = Math.max(1, ...lens.filter((_, k) => k !== q.correctOptionIndex));
  return lens[q.correctOptionIndex] / other;
}

/**
 * Qaysi savollarning distraktorlari uzaytiriladi. Kalit eng uzun bo'lgan savollardan
 * eng sezilmas `keep` tasi qoldiriladi: aks holda "eng uzuni hech qachon to'g'ri emas"
 * degan teskari belgi paydo bo'ladi.
 */
export function pickForBalance(questions: OptionQuestion[], keep = KEEP_LONGEST): number[] {
  const longest = questions.map((q, i) => i).filter((i) => keyIsLongest(questions[i]));
  if (longest.length <= keep) return [];
  const bySubtlety = [...longest].sort((a, b) => keyMargin(questions[a]) - keyMargin(questions[b]));
  return bySubtlety.slice(keep).sort((a, b) => a - b);
}

function norm(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.;]+$/, '');
}

/**
 * Model qaytargan distraktorlarni tekshiradi. Yaroqli bo'lsa — yangi variantlar
 * ro'yxati (kalit o'z o'rnida, aynan o'sha matn), aks holda null.
 */
export function applyDistractors(q: OptionQuestion, distractors: unknown): string[] | null {
  const n = q.options.length;
  if (!Array.isArray(distractors) || distractors.length !== n - 1) return null;
  const clean = distractors.map((d) => String(d ?? '').replace(/^\s*[A-Ea-e]\s*[).:]\s+/, '').trim());
  if (clean.some((d) => !d)) return null;
  const key = String(q.options[q.correctOptionIndex] ?? '');
  const keyNorm = norm(key);
  if (new Set([keyNorm, ...clean.map(norm)]).size !== n) return null;
  // Distraktor kalitni o'z ichiga olsa ("X va Y") — u ham to'g'ri bo'lib qoladi.
  if (clean.some((d) => norm(d).includes(keyNorm))) return null;
  const lens = clean.map((d) => d.length);
  if (Math.max(...lens) < key.length) return null;
  if (Math.min(...lens) > key.length * SHORTEST_KEY_SLACK) return null;
  if (Math.min(...lens) < key.length * MIN_DISTRACTOR_SHARE) return null;
  if (Math.max(...lens) > key.length * MAX_DISTRACTOR_SHARE) return null;
  const out: string[] = [];
  let next = 0;
  for (let k = 0; k < n; k += 1) {
    out.push(k === q.correctOptionIndex ? q.options[k] : clean[next++]);
  }
  return out;
}
