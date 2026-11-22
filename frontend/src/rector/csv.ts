/**
 * Ro'yxatni Excel ochadigan CSV qilib yuklab berish (2026-10-15).
 *
 * Rahbariyat ro'yxatni (masalan "dars vaqtida iMentor'ni ochmaganlar")
 * kafedraga yoki buyruqqa ilova qilish uchun oladi. Ajratgich — nuqtali
 * vergul, boshida BOM: o'zbek/rus Excel'i aynan shunday ochadi va
 * o'zbekcha harflar buzilmaydi.
 */
export type CsvCell = string | number | boolean | null | undefined;

export function toCsv(head: string[], rows: CsvCell[][]): string {
  const esc = (v: CsvCell) => {
    let s = v === null || v === undefined ? '' : String(v);
    // "=", "+", "-", "@" bilan boshlangan MATN Excel'da formula bo'lib bajariladi (2026-10-23).
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
}

/** Fayl nomidagi taqiqlangan belgilarni olib tashlaydi. */
export function safeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 120) || 'royxat'
  );
}

export function downloadCsv(fileName: string, head: string[], rows: CsvCell[][]): void {
  const blob = new Blob([`﻿${toCsv(head, rows)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
