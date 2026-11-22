/**
 * Dars hozir qaysi bosqichda (2026-11-16).
 *
 * Rektor kechasi soat 01:45 da bugungi 13:00 dagi darsda «Hali tugamagan» yozuvini ko'rdi — go'yo dars
 * ketayotgandek. «Tugamagan» ikki xil: hali BOSHLANMAGAN va hozir DAVOM ETAYOTGAN. Ular alohida aytiladi.
 */

export type Phase = 'upcoming' | 'running' | 'over';

/** Toshkent vaqti: "YYYY-MM-DD HH:MM". */
export function tashkentNow(now: Date = new Date()): string {
  return now.toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 16);
}

export function lessonPhase(date: string, start: string, end: string, now: Date = new Date()): Phase {
  const cur = tashkentNow(now);
  if (start && cur < `${date} ${start.slice(0, 5)}`) return 'upcoming';
  if (end && cur >= `${date} ${end.slice(0, 5)}`) return 'over';
  return 'running';
}

/** Bugun birinchi para (08:00) boshlanganmi. */
export function dayStarted(now: Date = new Date()): boolean {
  return tashkentNow(now).slice(11) >= '08:00';
}
