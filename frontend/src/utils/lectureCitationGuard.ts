import type { MedicalReference } from './medicalReferences';

/**
 * Ma'ruza matnidagi `(Manba: kitob, N-bet)` iqtiboslarini server bergan haqiqiy ma'lumotga
 * moslaydi. Model sahifa raqamini ba'zan o'zi o'ylab topadi: o'qituvchi yuklagan hujjatlar
 * sahifasiz saqlanadi, lekin matnda "167-bet" paydo bo'ladi (2026-10-21). Bunday raqam
 * soxta manba, shuning uchun serverda yo'q sahifa matndan olib tashlanadi.
 *
 * Qoidalar (har bir `(Manba: …)` uchun):
 *  - iqtibosdagi kitob serverning `references` ro'yxatida topilmasa — tegilmaydi (boshqa manba);
 *  - kitobning sahifalari ma'lum emas — sahifa olib tashlanadi;
 *  - sahifalar ma'lum, lekin yozilgan raqam ular orasida emas — sahifa olib tashlanadi;
 *  - bitta iqtibosda bir nechta kitob (`A; B, 23-bet`) — sahifa kimniki ekani noaniq, olib tashlanadi.
 */

// Nom ichida bitta qavs darajasi bo'lishi mumkin ("O‘zMSt 134-2024 (2)").
const CITE_RE = /\((Manba|Источник|Source)\s*:\s*((?:[^()]|\([^()]*\))+)\)/gi;
const PAGE_TAIL_RE =
  /\s*,?\s*(?:(?:стр\.?|sahifa|bet|pages?|pp?\.?)\s*[:.]?\s*(\d+(?:\s*[-–—]\s*\d+)?)|(\d+(?:\s*[-–—]\s*\d+)?)\s*-?\s*(?:bet|sahifa|стр\.?|pp?\.?))\s*$/i;

function norm(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** "114-118, 220" → {114..118, 220}. */
export function expandPages(pages: string | undefined): Set<number> {
  const out = new Set<number>();
  for (const part of (pages || '').split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
    if (!m) continue;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (!(from > 0) || to < from || to - from > 500) continue;
    for (let p = from; p <= to; p += 1) out.add(p);
  }
  return out;
}

function pagesOf(raw: string): number[] {
  const out: number[] = [];
  for (const m of raw.matchAll(/\d+/g)) out.push(Number(m[0]));
  return out;
}

export function sanitizeBookCitations(text: string, refs: MedicalReference[]): string {
  if (!text || !refs.length) return text;
  const books = refs
    .filter((r) => r.kind === 'book' || (!r.kind && !r.url))
    .map((r) => ({ key: norm(r.title || ''), pages: expandPages(r.pages) }))
    .filter((b) => b.key.length >= 3);
  if (!books.length) return text;

  return text.replace(CITE_RE, (full, label: string, inner: string) => {
    const tail = inner.match(PAGE_TAIL_RE);
    if (!tail) return full;
    const head = inner.slice(0, tail.index).trim().replace(/[,;]\s*$/, '');
    const headKey = norm(head);
    const mentioned = books.filter((b) => headKey.includes(b.key) || b.key.includes(headKey));
    if (!mentioned.length) return full; // bizning kitobimiz emas
    const strip = `(${label}: ${head})`;
    if (/[;]/.test(head) || mentioned.length > 1) return strip;
    const known = mentioned[0].pages;
    if (!known.size) return strip;
    const written = pagesOf(tail[1] ?? tail[2] ?? '');
    return written.length && written.every((p) => known.has(p)) ? full : strip;
  });
}
