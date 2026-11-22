/**
 * `**qalin**` belgilarini QALIN matnga aylantirish (2026-10-13).
 *
 * Rektor talabi: vaziyatli masalada klinik fikrlash uchun muhim joylar —
 * hal qiluvchi simptom, vaqt, hayotiy ko'rsatkich, chetga chiqqan tahlil —
 * qalin bo'lsin, talaba nimaga e'tibor berishni o'rganadi.
 *
 * Keys matni ko'p joyda SOF MATN sifatida chiqadi (o'qituvchining «Keys»
 * sahifasi, katalog, admin kutubxonasi, chop etish, PDF) — markdown faqat
 * onlayn talaba sahifasida ishlanadi. Shuning uchun bu yerda butun markdown
 * emas, FAQAT qalinlik ajratiladi: qolgan belgilar matnda qanday bo'lsa
 * shundayligida qoladi.
 *
 * Toq `**` matnni qalin qilib "oqizib" yubormaydi: juftlik topilmasa,
 * belgilar matnning o'zi sifatida qoladi.
 */
import React from 'react';

/** Juft `**...**` — ichida kamida bitta belgi, `**` yo'q. */
const BOLD_RE = /\*\*([^*]+?)\*\*/g;

export type BoldPiece = { bold: boolean; text: string };

/**
 * Matnni qalin va oddiy bo'laklarga ajratadi.
 *
 * Tarjima yoki qo'lda tahrir `**` ni buzib qo'ysa (bittasi yo'qolsa) —
 * bo'lak oddiy matn bo'lib qoladi, ya'ni hech narsa yo'qolmaydi.
 */
export function splitBold(text: string): BoldPiece[] {
  const source = text || '';
  const out: BoldPiece[] = [];
  let at = 0;
  BOLD_RE.lastIndex = 0;
  let hit = BOLD_RE.exec(source);
  while (hit) {
    const inner = hit[1].trim();
    if (inner) {
      if (hit.index > at) out.push({ bold: false, text: source.slice(at, hit.index) });
      out.push({ bold: true, text: inner });
      at = hit.index + hit[0].length;
    }
    hit = BOLD_RE.exec(source);
  }
  if (at < source.length) out.push({ bold: false, text: source.slice(at) });
  return out.length ? out : [{ bold: false, text: source }];
}

/** Matnda qalin belgisi bormi — ortiqcha ish qilmaslik uchun. */
export function hasBold(text: string): boolean {
  BOLD_RE.lastIndex = 0;
  return BOLD_RE.test(text || '');
}

/** `**` belgilarini olib tashlaydi (qalinligi ko'rinmaydigan joylar uchun). */
export function stripBold(text: string): string {
  return (text || '').replace(BOLD_RE, (_all, inner: string) => inner.trim());
}

/**
 * Klinik ko'rsatkichlarni AI'siz, kod bilan qalin qilish (2026-10-21).
 *
 * Shikoyat: keysda talaba e'tibor berishi kerak bo'lgan joylar qalin emas.
 * AI promptda 6–12 ta so'raladi, lekin oxirgi 2 kunda keys savollarining
 * faqat 59% ida qalin bor edi (o'rtacha 2,8 ta). O'lchov qiymatlari esa
 * aniq shaklga ega — ularni AI'siz topish mumkin: qon bosimi, harorat,
 * puls/nafas, SpO2 va foizlar, birlikli laboratoriya qiymatlari, kasallik
 * muddati. Ko'rsatishda qo'llanadi — eski keyslarga ham ta'sir qiladi.
 * Allaqachon qalin bo'lak ichiga tegilmaydi.
 */
const CLINICAL_CUES: RegExp[] = [
  // Qon bosimi: 160/100 mm Hg, 90/60 mm sim. ust., 140/90 мм рт. ст.
  /\b\d{2,3}\s*\/\s*\d{2,3}\s*(?:mm\s*Hg|mmHg|mm\s*sim\.?\s*ust\.?|мм\s*рт\.?\s*ст\.?)/giu,
  // Harorat: 38,9 °C, 37.2°C
  /\b\d{2}(?:[.,]\d)?\s*°\s*[CС]/gu,
  // Puls, nafas: 112/min, 24 marta/daq, 96 уд/мин, 22 в мин, 110 bpm
  /\b\d{2,3}\s*(?:\/\s*min|\/\s*daq|marta\s*\/\s*daq(?:iqa)?|уд\.?\s*\/\s*мин|в\s+мин|bpm|zarba\s*\/\s*daq(?:iqa)?)/giu,
  // SpO2 va foizlar: SpO2 88%, 45 %
  /\bSpO2\s*[:=]?\s*\d{2,3}\s*%|\b\d{1,3}(?:[.,]\d+)?\s*%/giu,
  // Birlikli laboratoriya qiymatlari
  /\b\d+(?:[.,]\d+)?\s*(?:×\s*10\s*(?:\^?\s*9|⁹|\^?\s*12|¹²)\s*\/\s*[lLлЛ]|g\/l|g\/dl|г\/л|г\/дл|mmol\/l|ммоль\/л|mkmol\/l|µmol\/l|мкмоль\/л|mg\/dl|mg\/l|мг\/дл|мг\/л|u\/l|iu\/l|ед\/л|ме\/л|mEq\/l|ng\/ml|нг\/мл|pg\/ml|пг\/мл|mm\/(?:h|soat)|мм\/ч|kg\/m2|kg\/m²|кг\/м2|кг\/м²)(?![\p{L}])/giu,
  // Kasallik muddati: 3 kun, 2 hafta, 6 oydan beri, 10 дней, 3 weeks
  /\b\d+\s*(?:kun|hafta|oy|yil|soat|дн(?:я|ей|ь)?|недел(?:я|и|ь)|месяц(?:а|ев)?|лет|год(?:а)?|час(?:а|ов)?|days?|weeks?|months?|years?|hours?)(?![\p{L}])/giu,
];

export function emphasizeClinicalCues(text: string): string {
  let out = text || '';
  // Har qoida faqat hali QALIN BO'LMAGAN bo'laklarga qo'llanadi — qalin ichida
  // qalin (`****`) paydo bo'lmasin.
  for (const re of CLINICAL_CUES) {
    out = splitBold(out)
      .map((piece) => (piece.bold ? `**${piece.text}**` : piece.text.replace(re, (hit) => `**${hit.trim()}**`)))
      .join('');
  }
  return out;
}

/**
 * React ko'rinishi: qalin bo'laklar `<strong>` bo'ladi.
 *
 * Rang berilmaydi — atrofdagi matndan qoraroq: rektor "qora rangda
 * qalinroq" deb so'radi, ya'ni ajratuvchi rang emas. 2026-10-21: yarim
 * qalin (600) matndan deyarli farq qilmasdi — endi to'liq qalin, qora.
 */
export function renderBold(text: string, keyPrefix = 'b'): React.ReactNode {
  const pieces = splitBold(text);
  if (pieces.length === 1 && !pieces[0].bold) return pieces[0].text;
  return pieces.map((piece, i) =>
    piece.bold ? (
      <strong key={`${keyPrefix}-${i}`} className="font-bold text-slate-950">
        {piece.text}
      </strong>
    ) : (
      <React.Fragment key={`${keyPrefix}-${i}`}>{piece.text}</React.Fragment>
    ),
  );
}

/** PDF/HTML uchun: EKRANLANGAN matndagi `**...**` ni `<b>` ga aylantiradi. */
export function boldToHtml(escaped: string): string {
  return (escaped || '').replace(BOLD_RE, (_all, inner: string) => `<b>${inner.trim()}</b>`);
}
