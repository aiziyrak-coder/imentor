/**
 * Jonli test: har talabaga savollar va variantlar O'Z tartibida (2026-10-22).
 *
 * Rektor: "hamma yuqori baho olyapti — chiterlik". Hamma bir xil tartibni
 * ko'rganda birinchi yechgan talaba "1-B, 2-D…" ni guruhga tashlardi. Endi
 * tartib talaba va sessiyaga bog'liq (sahifa yangilansa ham o'zgarmaydi),
 * javoblar esa serverga ASL tartibdagi raqamlar bilan ketadi — baholash,
 * qoralama va tahlil o'zgarmaydi.
 */

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function random(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededOrder(count: number, seed: string): number[] {
  const out = Array.from({ length: Math.max(0, count) }, (_, i) => i);
  const next = random(hash(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Savollar tartibi va har savol uchun variantlar tartibi (asl raqamlar ro'yxati). */
export function studentOrder(
  sessionKey: string,
  studentKey: string,
  optionCounts: number[],
): { questions: number[]; options: number[][] } {
  const base = `${sessionKey}|${studentKey}`;
  return {
    questions: seededOrder(optionCounts.length, `${base}|q`),
    options: optionCounts.map((n, i) => seededOrder(n, `${base}|o${i}`)),
  };
}

/** Qolgan vaqt "m:ss" ko'rinishida. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
