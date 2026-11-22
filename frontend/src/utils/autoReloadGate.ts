/**
 * Yangi versiya chiqqanda sahifani O'ZI yangilash mumkin bo'lgan lahzalar (2026-11-13).
 *
 * Muammo: deploydan keyin sahifasini yangilamagan telefon/monitor eski kodda qoladi (masalan, har soniya
 * so'rab serverni yuklaydi yoki uzun savolni kesib ko'rsatadi) — "Yangilang" yozuvini hamma bosmaydi.
 * Har qanday joyda yangilab bo'lmaydi (test ketayotgan, AI material yaratayotgan paytda ish yo'qoladi),
 * shuning uchun faqat aniq XAVFSIZ ekranlar o'zini shu yerda belgilaydi: hozircha talabaning monitor
 * test kutish zali (sessiya manzili URL'da, ishtirokchi kaliti localStorage'da — yangilangach o'zi qaytadi).
 */
const safe = new Set<string>();
const listeners = new Set<() => void>();

export function markAutoReloadSafe(id: string, isSafe: boolean): void {
  const had = safe.has(id);
  if (isSafe) safe.add(id);
  else safe.delete(id);
  if (had !== isSafe) listeners.forEach((fn) => fn());
}

export function isAutoReloadSafe(): boolean {
  return safe.size > 0;
}

export function onAutoReloadSafeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
