/**
 * Ma'ruza matnining bo'lim sarlavhalari — keyslarni turli bo'limlarga bog'lash uchun (2026-10-21).
 *
 * Prod'da bir mavzuning uchta keysidan ikkitasi bitta tajriba (kalamush toksikologiyasi) haqida
 * chiqdi: sarlavhada bir nechta bo'lim bo'lmasa, "boshqa jihat" ko'rsatmasi juda umumiy edi. Endi
 * ma'ruzadagi haqiqiy bo'limlardan har keysga bittadan beriladi.
 */

/** Mazmun bermaydigan umumiy bo'limlar — keys uchun yaroqsiz. */
const GENERIC_SECTION =
  /^(?:kirish|xulosa|nazorat savollari|savollar|manbalar|foydalanilgan adabiyotlar|reja|ma['’`ʻʼ]?ruza rejasi|adabiyotlar|введение|заключение|выводы|контрольные вопросы|источники|literature|introduction|conclusion|summary|references|review questions)$/i;

export function lectureSectionTitles(text: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^#{2,3}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const title = m[1].replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
    const words = title.split(' ').length;
    if (title.length < 4 || words > 12 || GENERIC_SECTION.test(title)) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

/** `titles` ichidan `n` tasini bir tekis oraliqda tanlaydi (boshi, o'rtasi, oxiri). */
export function pickSpreadSections(titles: string[], n: number): string[] {
  if (titles.length < n) return [];
  if (n === 1) return [titles[0]];
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(titles[Math.round((i * (titles.length - 1)) / (n - 1))]);
  return Array.from(new Set(out)).length === n ? out : [];
}
