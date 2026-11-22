/**
 * Design Layer — slide_type bo‘yicha professional shablonlar (PptxGenJS).
 * Content Layer natijasi: PresentationContent.
 */
import {
  type ContentSlide,
  type PresentationContent,
  coercePresentationContent,
  isRealStat,
  slidePreviewBullets,
} from './presentationContentSchema';
import { autofitFontSize } from './presentationQa';
import { ensureSafeSlideImages } from './presentationImages';
import { addSlideAnimations } from './pptxAnimations';
import { THEME, buildLabels, type PresentationBuildMeta } from './presentationTheme';

export type { PresentationContent, ContentSlide };
export type PresentationDeck = PresentationContent;
export type PresentationSlide = ContentSlide;

type PptxSlide = import('pptxgenjs').default.Slide;

const C = THEME.colors;
const F = THEME.fonts;
const M = THEME.spacing.margin;

/** Fan nomini so'z chegarasida qisqartiradi ("3-semes" kabi bo'lak qolmasin). */
function shortSubject(name: string, max = 56): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,.;:(-]+$/, '')}…`;
}

/** Mavzu kodi ("L1", "A3") — talabaga tushunarli yozuv ("Ma'ruza 1", "Amaliy 3"). */
function topicLabel(topicId: string, language: 'uz' | 'ru' | 'en'): string {
  const id = topicId.trim();
  const m = id.match(/^([LA])\s*-?\s*(\d+)$/i);
  if (!m) return id.slice(0, 12);
  const lecture = m[1].toUpperCase() === 'L';
  const word =
    language === 'ru' ? (lecture ? 'Лекция' : 'Практика') : language === 'en' ? (lecture ? 'Lecture' : 'Practical') : lecture ? "Ma'ruza" : 'Amaliy';
  return `${word} ${m[2]}`;
}

export function badgeLabel(meta: PresentationBuildMeta): string {
  const subj = shortSubject(meta.subjectName);
  const code = topicLabel(meta.topicId, meta.language || 'uz');
  // Standart "asosiy" variant tushunarsiz yozuv: faqat haqiqiy yo'nalish ko'rsatiladi. Fan nomida
  // yo'nalish allaqachon bo'lsa ("Dermatovenerologiya(Stom)") ikkinchi marta qo'shilmaydi.
  const variant = meta.variantLabel?.trim();
  const showVariant =
    Boolean(variant) && !/^(?:asosiy|основн\w*|main|default)$/i.test(variant!) && !subj.toLowerCase().includes(variant!.toLowerCase());
  const head = showVariant ? `${subj} (${variant})` : subj;
  return code ? `${head} · ${code}` : head;
}

function addHeaderBadge(s: PptxSlide, meta: PresentationBuildMeta, dark = false): void {
  const label = badgeLabel(meta);
  // Matn qutisi badge'dan tashqariga chiqmasin: ikkalasi bir xil kenglikdan hisoblanadi.
  const w = Math.min(6.4, 0.095 * label.length + 0.5);
  s.addShape('roundRect', {
    x: M,
    y: 0.22,
    w,
    h: 0.34,
    fill: { color: dark ? C.secondary : C.primary },
    line: { type: 'none' },
  });
  s.addText(label, {
    x: M,
    y: 0.22,
    w,
    h: 0.34,
    fontSize: 10,
    bold: true,
    color: C.textLight,
    fontFace: F.body,
    align: 'center',
    valign: 'middle',
    fit: 'shrink',
  });
}

function addFooter(
  s: PptxSlide,
  title: string,
  pageNum: number,
  total: number,
  dark = false,
): void {
  const y = 7.1;
  s.addText(title.slice(0, 70), {
    x: M,
    y,
    w: 10.5,
    h: 0.28,
    fontSize: 9,
    color: dark ? 'A8B8C8' : C.muted,
    fontFace: F.body,
  });
  s.addText(`${pageNum} / ${total}`, {
    x: 11.6,
    y,
    w: 1.2,
    h: 0.28,
    fontSize: 9,
    color: dark ? 'A8B8C8' : C.muted,
    align: 'right',
    fontFace: F.body,
  });
}

/**
 * Rasmni qo‘yadi. Rasm bo‘lmasa HECH NARSA chizilmaydi — soxta "default"
 * rasm/ikonka o‘rniga slayd to‘liq matnli bo‘lib qoladi (chaqiruvchi layout
 * qaytgan `false` ga qarab kenglikni o‘zi hisoblaydi).
 */
function addSlideImage(
  s: PptxSlide,
  slide: ContentSlide,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  if (!slide.imageUrl) return false;
  const creditH = slide.imageCredit ? 0.24 : 0;
  const imgH = h - creditH;
  try {
    // Oq kartochka: 'contain' da bo‘sh joy qolsa fon oqarib turadi (diagramma
    // yozuvlari 'cover' da kesilib ketmasin).
    s.addShape('roundRect', {
      x,
      y,
      w,
      h: imgH,
      fill: { color: C.card },
      line: { color: C.soft, width: 1 },
    });
    s.addImage({
      data: slide.imageUrl,
      x: x + 0.08,
      y: y + 0.08,
      w: w - 0.16,
      h: imgH - 0.16,
      sizing: { type: 'contain', w: w - 0.16, h: imgH - 0.16 },
    });
    if (slide.imageCredit) {
      // Kredit rasm USTIGA emas, TAGIGA — avval diagramma yozuvlarini yopardi.
      s.addText(slide.imageCredit.slice(0, 110), {
        x,
        y: y + imgH,
        w,
        h: creditH,
        fontSize: 7,
        color: C.muted,
        italic: true,
        fontFace: F.body,
        valign: 'middle',
        fit: 'shrink',
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Rasmni slayd qirrasigacha to\'ldirib qo\'yadi (bleed). Oq kartochka ichiga
 * kichik qilib joylashtirilgan rasm slaydni havaskorona ko\'rsatardi; qirraga
 * tegib turgan rasm esa nashriy taassurot beradi. Kesilish xavfi bor, shuning
 * uchun bu faqat foto/illyustratsiya slaydlarida ishlatiladi - diagrammalar
 * uchun `addSlideImage` dagi 'contain' saqlanib qoladi.
 */
function addBleedImage(
  s: PptxSlide,
  slide: ContentSlide,
  x: number,
  y: number,
  w: number,
  h: number,
  edge: 'left' | 'right' = 'left',
): boolean {
  if (!slide.imageUrl) return false;
  try {
    s.addShape('rect', {
      x, y, w, h,
      fill: { color: C.zebra }, line: { type: 'none' },
    });
    s.addImage({
      data: slide.imageUrl,
      x, y, w, h,
      sizing: { type: 'cover', w, h },
    });
    // Mis chiziq matnga qaragan qirrada turadi: `edge` - chiziq qaysi
    // tomonda ekanini bildiradi (rasm qaysi tomonda emas).
    s.addShape('rect', {
      x: edge === 'left' ? x : x + w - 0.055,
      y, w: 0.055, h,
      fill: { color: C.accent }, line: { type: 'none' },
    });
    if (slide.imageCredit) {
      // Kredit rasm ustida, lekin yarim shaffof to'q lenta ichida - o'qiladi.
      s.addShape('rect', {
        x, y: y + h - 0.3, w, h: 0.3,
        fill: { color: '000000', transparency: 45 }, line: { type: 'none' },
      });
      s.addText(slide.imageCredit.slice(0, 110), {
        x: x + 0.12, y: y + h - 0.3, w: w - 0.24, h: 0.3,
        fontSize: 8, color: 'FFFFFF', italic: true,
        fontFace: F.body, valign: 'middle', fit: 'shrink',
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Matn berilgan qutiga sig\'adigan eng katta shriftni topadi.
 *
 * `fit: 'shrink'` PowerPoint ochilganda qo\'llanadi, lekin PDF ga
 * o\'girishda va boshqa ko\'ruvchilarda e\'tiborga olinmaydi - shuning uchun
 * o\'lcham shu yerda oldindan hisoblanadi. Belgi kengligi taxminiy
 * (o\'rtacha 0.5 x shrift), lekin qator sonini baholash uchun yetarli.
 */
function fitTextSize(
  text: string,
  w: number,
  h: number,
  base: number,
  min: number,
): number {
  const chars = Math.max(1, text.trim().length);
  for (let fs = base; fs > min; fs -= 1) {
    const perLine = Math.max(12, Math.floor((w * 72) / (fs * 0.5)));
    const lines = Math.ceil(chars / perLine);
    if (lines * fs * 1.22 <= h * 72) return fs;
  }
  return min;
}

/**
 * Bulletlar. Ilgari har biri raqamli ko\'k doira bilan chizilardi — tartib
 * bo\'lmagan ro\'yxatda ham raqam turardi va slayd havaskorona ko\'rinardi.
 * Endi nozik mis rangli belgi va ajratuvchi chiziq ishlatiladi.
 *
 * Shrift ham kattalashtirildi: proyektorda 14-16pt matn orqa qatordan
 * o\'qilmaydi, shuning uchun asos 19pt va pastki chegara 15pt.
 */
function addNumberedBullets(
  s: PptxSlide,
  bullets: string[],
  box: { x: number; y: number; w: number; h: number },
): void {
  const items = bullets.slice(0, 5);
  if (!items.length) return;
  // Qatorlar quti balandligiga ANIQ bo\'linadi. Ilgari qat\'iy 1.0-1.5" ishlatilardi
  // va beshta uzun bullet slayd tagidan, kolontitul ustiga chiqib ketardi.
  const rowH = Math.min(1.5, box.h / items.length);
  const textW = box.w - 0.5;
  const baseFs = items.length <= 3 ? 21 : items.length === 4 ? 20 : 19;
  // Bitta ro\'yxatdagi bandlar bir xil o\'lchamda bo\'lsin: har birini alohida
  // moslashtirsak qisqa band kattaroq chiqib, ro\'yxat notekis ko\'rinardi.
  const textH = rowH - 0.2;
  const listFs = items.reduce(
    (fs, text) =>
      Math.min(
        fs,
        autofitFontSize(text, {
          base: baseFs,
          min: 14,
          softMaxChars: Math.max(52, Math.round(box.w * 17)),
        }),
        fitTextSize(text, textW, textH, baseFs, 14),
      ),
    baseFs,
  );
  items.forEach((text, i) => {
    const y = box.y + i * rowH;
    // Kichik mis to\'rtburchak - raqamsiz, xotirjam urg\'u.
    s.addShape('rect', {
      x: box.x,
      y: y + Math.min(0.26, rowH * 0.24),
      w: 0.14,
      h: 0.14,
      fill: { color: C.accent },
      line: { type: 'none' },
    });
    // Qatorlar orasidagi ingichka ajratuvchi - birinchisidan tashqari.
    if (i > 0) {
      s.addShape('rect', {
        x: box.x,
        y: y - 0.04,
        w: box.w - 0.1,
        h: 0.008,
        fill: { color: C.soft },
        line: { type: 'none' },
      });
    }
    s.addText(text, {
      x: box.x + 0.42,
      y: y + 0.08,
      w: textW,
      h: textH,
      fontSize: listFs,
      color: C.textDark,
      fontFace: F.body,
      lineSpacingMultiple: 1.08,
      valign: 'top',
      fit: 'shrink',
    });
  });
}

/** Kartochkaga sig'adigan band uzunligi (belgilar). */
const CARD_MAX_CHARS = 190;
const KEY_FIGURE =
  /(?:≥|≤|>|<)?\s?\d+(?:[.,]\d+)?(?:\s?[-–/]\s?\d+(?:[.,]\d+)?)?\s?(?:%|mm\s?Hg|mmHg|mg\/kg|mg|ml|mmol\/l|g\/l|°C|kun|soat|hafta|yil|дней|час|лет|days?|hours?|years?)/i;

/**
 * Bandni kartochkaga bo'lish (2026-10-21, "infografika yo'q"): "Atama: izoh"
 * bo'lsa atama sarlavha bo'ladi; aks holda banddagi asosiy raqam (birligi
 * bilan) katta yoziladi; ikkalasi ham bo'lmasa — sarlavhasiz, faqat tartib raqami.
 */
export function bulletCardParts(text: string): { head: string; body: string; figure: boolean } {
  const t = text.replace(/\s+/g, ' ').trim();
  const term = t.match(/^([^:—–]{3,48}?)\s?[:—–]\s+(.{12,})$/);
  if (term && !/\d{2,}/.test(term[1])) return { head: term[1].trim(), body: term[2].trim(), figure: false };
  const fig = t.match(KEY_FIGURE);
  if (fig && fig[0].trim().length <= 14) return { head: fig[0].trim(), body: t, figure: true };
  return { head: '', body: t, figure: false };
}

export type BulletLayout = 'cards' | 'panel' | 'list';

/**
 * Rasmsiz matnli slayd ko'rinishi (2026-10-21, "taqdimot oddiy, infografika
 * yo'q": 8 ta ketma-ket slayd bir xil 5 bandli ro'yxat edi). Qo'shni slaydlar
 * bir-biridan farq qilsin: har uchinchisi "asosiy fikr" paneli, qolgani
 * kartochkalar. Oddiy ro'yxat — rasm yonida yoki bandlar uzun bo'lsa.
 */
export function bulletLayoutFor(bullets: string[], hasImage: boolean, page: number): BulletLayout {
  const items = bullets.map((b) => String(b || '').trim()).filter(Boolean);
  if (hasImage || items.length < 3 || items.length > 6) return 'list';
  if (page % 3 === 1 && items.length >= 4 && items[0].length <= 160) return 'panel';
  return items.every((b) => b.length <= CARD_MAX_CHARS) ? 'cards' : 'list';
}

/**
 * Kartochkalar: 3 — uch ustun, 4 — 2×2, 5 — 3+2 (markazda), 6 — 3×2. Har
 * kartochkada rangli yuqori chiziq va tartib raqami; sarlavha (atama yoki
 * asosiy raqam) qalin.
 */
function addBulletCards(
  s: PptxSlide,
  bullets: string[],
  box: { x: number; y: number; w: number; h: number },
): void {
  const items = bullets.map((b) => String(b || '').trim()).filter(Boolean).slice(0, 6);
  const cols = items.length === 4 ? 2 : Math.min(3, items.length);
  const rows = Math.ceil(items.length / cols);
  const gap = THEME.spacing.gutter;
  const cardW = (box.w - gap * (cols - 1)) / cols;
  const cardH = Math.min(3.6, (box.h - gap * (rows - 1)) / rows);
  const bands = [C.primary, C.secondary, C.accent];
  const parts = items.map(bulletCardParts);
  // Matn qutisi: sarlavhali kartochkada — sarlavha ostida, sarlavhasizda — raqam yonida.
  const textBox = (p: { head: string }) =>
    p.head ? { dx: 0.35, dy: 0.95, w: cardW - 0.7, h: cardH - 1.1 } : { dx: 0.95, dy: 0.26, w: cardW - 1.25, h: cardH - 0.4 };
  const baseFs = rows === 1 ? 18 : 17;
  const bodyFs = parts.reduce((fs, p) => {
    const b = textBox(p);
    return Math.min(fs, fitTextSize(p.body, b.w, b.h, baseFs, 12));
  }, baseFs);
  parts.forEach((p, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, items.length - row * cols);
    // Oxirgi qator to'lmasa — markazga suriladi (5 band: 3 + 2).
    const shift = ((cols - inRow) * (cardW + gap)) / 2;
    const x = box.x + shift + (i % cols) * (cardW + gap);
    const y = box.y + row * (cardH + gap);
    const band = bands[i % bands.length];
    s.addShape('rect', { x, y, w: cardW, h: cardH, fill: { color: C.card }, line: { color: C.soft, width: 1 } });
    s.addShape('rect', { x, y, w: cardW, h: 0.09, fill: { color: band }, line: { type: 'none' } });
    s.addShape('ellipse', { x: x + 0.3, y: y + 0.28, w: 0.5, h: 0.5, fill: { color: band }, line: { type: 'none' } });
    s.addText(String(i + 1).padStart(2, '0'), {
      x: x + 0.3, y: y + 0.28, w: 0.5, h: 0.5,
      fontSize: 13, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fontFace: F.body,
    });
    if (p.head) {
      s.addText(p.head, {
        x: x + 0.95, y: y + 0.22, w: cardW - 1.2, h: 0.62,
        fontSize: p.figure
          ? autofitFontSize(p.head, { base: 24, min: 16, softMaxChars: 10 })
          : autofitFontSize(p.head, { base: 17, min: 13, softMaxChars: Math.round(cardW * 6) }),
        bold: true, color: p.figure ? band : C.primary, fontFace: F.heading, valign: 'middle', fit: 'shrink',
      });
    }
    const b = textBox(p);
    s.addText(p.body, {
      x: x + b.dx, y: y + b.dy, w: b.w, h: b.h,
      fontSize: bodyFs, color: C.textDark, fontFace: F.body, lineSpacingMultiple: 1.06, valign: 'top', fit: 'shrink',
    });
  });
}

/** "Asosiy fikr" paneli: birinchi band chapda katta, qolganlari o'ngda ro'yxat. */
function addKeyPointPanel(
  s: PptxSlide,
  bullets: string[],
  box: { x: number; y: number; w: number; h: number },
): void {
  const items = bullets.map((b) => String(b || '').trim()).filter(Boolean);
  const [lead, ...rest] = items;
  const panelW = 4.3;
  s.addShape('rect', { x: box.x, y: box.y, w: panelW, h: box.h, fill: { color: C.primary }, line: { type: 'none' } });
  s.addShape('rect', { x: box.x + 0.4, y: box.y + 0.45, w: 0.7, h: 0.07, fill: { color: C.accent }, line: { type: 'none' } });
  s.addText(lead, {
    x: box.x + 0.4, y: box.y + 0.7, w: panelW - 0.8, h: box.h - 1.1,
    fontSize: fitTextSize(lead, panelW - 0.8, box.h - 1.1, 22, 15),
    color: 'FFFFFF', fontFace: F.heading, bold: true, lineSpacingMultiple: 1.12, valign: 'top', fit: 'shrink',
  });
  addNumberedBullets(s, rest, { x: box.x + panelW + 0.45, y: box.y + 0.05, w: box.w - panelW - 0.45, h: box.h - 0.05 });
}

/** Sarlavha + ostidagi qisqa mis chiziq — slaydga aniq boshlanish beradi. */
function addSlideTitle(
  s: PptxSlide,
  title: string,
  subtitle: string | undefined,
  w: number,
): number {
  s.addText(title, {
    x: M,
    y: 0.72,
    w,
    h: 0.78,
    fontSize: autofitFontSize(title, { base: 30, min: 20, softMaxChars: 46 }),
    bold: true,
    color: C.primary,
    fontFace: F.heading,
    valign: 'top',
  });
  s.addShape('rect', {
    x: M,
    y: 1.54,
    w: 1.1,
    h: 0.045,
    fill: { color: C.accent },
    line: { type: 'none' },
  });
  const sub = (subtitle || '').trim();
  if (!sub) return 1.85;
  s.addText(sub, {
    x: M,
    y: 1.68,
    w,
    h: 0.42,
    fontSize: 15,
    color: C.muted,
    fontFace: F.body,
    italic: true,
  });
  return 2.22;
}

/* ---------- per-type layouts ---------- */

/**
 * Sarlavha slaydi. Pastki yarmi butunlay bo\'sh edi; endi o\'ng tomonda
 * fon rangidan bir pog\'ona ochroq tibbiy xoch turadi - suv belgisi kabi,
 * matnni bosmaydi, lekin slaydni tibbiy ta\'lim taqdimotiga o\'xshatadi.
 */
function layoutTitle(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  s.background = { color: C.bgDark };
  // Suv belgisi - matndan OLDIN chiziladi, aks holda ustiga tushadi.
  const wx = 11.5;
  const wy = 3.3;
  // Yaxlit 'plus' shakli: ikkita shaffof to\'rtburchak kesishgan joyda
  // quyuqroq chiziq berib, xochni ikki bo\'lakka ajratib ko\'rsatardi.
  s.addShape('plus', {
    x: wx - 1.3, y: wy - 1.3, w: 2.6, h: 2.6,
    fill: { color: C.primary, transparency: 45 },
    line: { type: 'none' },
  });
  addHeaderBadge(s, meta, true);
  s.addText('iMentor', {
    x: 10.8,
    y: 0.25,
    w: 2.0,
    h: 0.35,
    fontSize: 14,
    bold: true,
    color: C.accent,
    align: 'right',
    fontFace: F.heading,
  });
  s.addShape('rect', {
    x: M,
    y: 2.15,
    w: 1.8,
    h: 0.07,
    fill: { color: C.accent },
    line: { type: 'none' },
  });
  const titleFs = autofitFontSize(slide.title, { base: 36, min: 22, softMaxChars: 48 });
  s.addText(slide.title, {
    x: M,
    y: 2.4,
    w: 9.3,
    h: 1.5,
    fontSize: titleFs,
    bold: true,
    color: C.textLight,
    fontFace: F.heading,
  });
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: M,
      y: 4.1,
      w: 9.3,
      h: 0.55,
      fontSize: 17,
      color: 'B8C8D8',
      fontFace: F.body,
    });
  }
  // Pastdagi nozik chiziq va kafedra nomi - bo\'sh maydonni yopadi.
  s.addShape('rect', {
    x: M, y: 5.6, w: 9.3, h: 0.02,
    fill: { color: C.primary }, line: { type: 'none' },
  });
  s.addText(meta.subjectName || '', {
    x: M, y: 5.78, w: 9.3, h: 0.4,
    fontSize: 13,
    color: '8FA6BA',
    fontFace: F.body,
    charSpacing: 1,
    fit: 'shrink',
  });
  addFooter(s, deckTitle, page, total, true);
}

/**
 * Reja. Qatorlar qat\'iy 0.78" edi, shuning uchun to\'rtta band bo\'lsa slaydning
 * pastki uchdan biri bo\'sh qolardi. Endi mavjud balandlikka taqsimlanadi.
 */
function layoutAgenda(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  s.background = { color: C.bgLight };
  addHeaderBadge(s, meta);
  const top = addSlideTitle(s, slide.title, slide.subtitle, 12.2);
  const bullets = slidePreviewBullets(slide).slice(0, 6);
  const bodyH = 6.5 - top;
  const rowH = bullets.length ? bodyH / bullets.length : bodyH;
  const cardH = Math.min(1.15, rowH - 0.12);
  bullets.forEach((b, i) => {
    const y = top + i * rowH + (rowH - cardH) / 2;
    s.addShape('rect', {
      x: M,
      y,
      w: 12.2,
      h: cardH,
      fill: { color: C.card },
      line: { type: 'none' },
    });
    // Chap qirradagi rangli tasma - kartochkani fon ustida ushlab turadi.
    s.addShape('rect', {
      x: M,
      y,
      w: 0.07,
      h: cardH,
      fill: { color: i % 2 === 0 ? C.primary : C.secondary },
      line: { type: 'none' },
    });
    const d = Math.min(0.52, cardH - 0.24);
    s.addShape('ellipse', {
      x: M + 0.28,
      y: y + (cardH - d) / 2,
      w: d,
      h: d,
      fill: { color: i % 2 === 0 ? C.primary : C.secondary },
      line: { type: 'none' },
    });
    s.addText(String(i + 1), {
      x: M + 0.28,
      y: y + (cardH - d) / 2,
      w: d,
      h: d,
      fontSize: 15,
      bold: true,
      color: C.textLight,
      align: 'center',
      valign: 'middle',
      fontFace: F.heading,
    });
    s.addText(b, {
      x: M + 1.05,
      y,
      w: 10.9,
      h: cardH,
      fontSize: 18,
      color: C.textDark,
      valign: 'middle',
      fontFace: F.body,
      fit: 'shrink',
    });
  });
  addFooter(s, deckTitle, page, total);
}

/**
 * Asosiy matnli slayd. Rasm bo\'lsa u endi o\'ng qirraga tegib turadi
 * (bleed), matn esa chapdagi ustunda - avvalgi kichkina oq kartochkali
 * ko\'rinish o\'rniga.
 */
function layoutContentBullets(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  s.background = { color: C.bgLight };
  const hasImage = Boolean(slide.imageUrl);
  // Rasm birinchi chiziladi - matn va badge uning ustida qolsin.
  if (hasImage) addBleedImage(s, slide, 8.15, 0, 5.18, 6.95, 'left');
  addHeaderBadge(s, meta);
  const colW = hasImage ? 7.3 : 12.2;
  const bodyTop = addSlideTitle(s, slide.title, slide.subtitle, colW);
  const bullets = slide.body.bullets || slidePreviewBullets(slide);
  const box = { x: M, y: bodyTop, w: colW, h: 6.65 - bodyTop };
  const layout = bulletLayoutFor(bullets, hasImage, page);
  if (layout === 'cards') addBulletCards(s, bullets, box);
  else if (layout === 'panel') addKeyPointPanel(s, bullets, box);
  else addNumberedBullets(s, bullets, box);
  addFooter(s, deckTitle, page, total);
}

/**
 * Ikki ustun. Ilgari sarlavha lentasi ichida faqat matn bor edi; endi
 * har ustunda tartib raqami bo\'lgan mis kvadrat va ustun tagida rangli
 * asos bor, ya\'ni ikki tomon bir qarashda ajraladi.
 */
function layoutTwoColumn(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  s.background = { color: C.bgLight };
  addHeaderBadge(s, meta);
  const top = addSlideTitle(s, slide.title, slide.subtitle, 12.2);
  const cols = slide.body.columns?.length
    ? slide.body.columns.slice(0, 2)
    : [
        { heading: buildLabels(meta).left, points: (slide.body.bullets || []).slice(0, 3) },
        { heading: buildLabels(meta).right, points: (slide.body.bullets || []).slice(3, 6) },
      ];
  const colW = (12.2 - THEME.spacing.gutter) / 2;
  const colH = 6.45 - top;
  const headH = 0.78;
  cols.forEach((col, i2) => {
    const x = M + i2 * (colW + THEME.spacing.gutter);
    const tone = i2 === 0 ? C.primary : C.secondary;
    s.addShape('rect', {
      x, y: top, w: colW, h: colH,
      fill: { color: C.card }, line: { type: 'none' },
    });
    s.addShape('rect', {
      x, y: top, w: colW, h: headH,
      fill: { color: tone }, line: { type: 'none' },
    });
    // Tartib raqami - mis kvadrat ichida.
    s.addShape('rect', {
      x: x + 0.22, y: top + 0.19, w: 0.4, h: 0.4,
      fill: { color: C.accent }, line: { type: 'none' },
    });
    s.addText(String(i2 + 1), {
      x: x + 0.22, y: top + 0.19, w: 0.4, h: 0.4,
      fontSize: 15, bold: true, color: C.textLight,
      align: 'center', valign: 'middle', fontFace: F.heading,
    });
    s.addText(col.heading, {
      x: x + 0.75, y: top, w: colW - 0.95, h: headH,
      fontSize: 18, bold: true, color: C.textLight,
      valign: 'middle', fontFace: F.heading, fit: 'shrink',
    });
    addNumberedBullets(s, col.points || [], {
      x: x + 0.28, y: top + headH + 0.28, w: colW - 0.56, h: colH - headH - 0.56,
    });
    // Ustun tagidagi rangli asos.
    s.addShape('rect', {
      x, y: top + colH - 0.09, w: colW, h: 0.09,
      fill: { color: tone }, line: { type: 'none' },
    });
  });
  addFooter(s, deckTitle, page, total);
}

/**
 * Rasm asosiy slayd. Rasm chap qirraga tegib to\'liq balandlikda turadi,
 * o\'ngda esa to\'q ko\'k matn ustuni - jurnal sahifasi tuzilishi.
 */
function layoutImageFocus(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  // Rasm yo\'q bo\'lsa - bo\'sh ramka emas, to\'liq matnli layout.
  if (!slide.imageUrl) {
    layoutContentBullets(s, slide, meta, deckTitle, page, total);
    return;
  }
  s.background = { color: C.bgLight };
  const imgW = 7.35;
  addBleedImage(s, slide, 0, 0, imgW, 6.95, 'right');
  const panelX = imgW + 0.35;
  const panelW = 13.33 - panelX - M;
  s.addShape('rect', {
    x: panelX, y: 0.9, w: panelW, h: 5.75,
    fill: { color: C.card }, line: { type: 'none' },
  });
  s.addShape('rect', {
    x: panelX, y: 0.9, w: panelW, h: 0.075,
    fill: { color: C.accent }, line: { type: 'none' },
  });
  s.addText(slide.title, {
    x: panelX + 0.3, y: 1.2, w: panelW - 0.6, h: 1.0,
    fontSize: autofitFontSize(slide.title, { base: 24, min: 15, softMaxChars: 34 }),
    bold: true, color: C.primary, fontFace: F.heading, valign: 'top',
  });
  addNumberedBullets(s, slide.body.bullets || slidePreviewBullets(slide), {
    x: panelX + 0.3, y: 2.35, w: panelW - 0.6, h: 4.0,
  });
  addHeaderBadge(s, meta);
  addFooter(s, deckTitle, page, total);
}

/**
 * Statistika. Ilgari uchta bir xil oq kartochka edi — raqam va matn, xolos.
 * Endi bloklar turli vaznda: to\'q ko\'k, mis va konturli. Ko\'z avval eng
 * muhim raqamga tushadi va slayd infografikaga o\'xshaydi.
 */
function layoutStatistics(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  const realStats = (slide.body.stats || []).filter((x) => isRealStat(x));
  const keyStat = isRealStat(slide.body.key_stat) ? slide.body.key_stat : null;
  const bullets = (slide.body.bullets || []).filter((b) => String(b || '').trim());
  // Kartochkaga arziydigan raqam yo'q bo'lsa — matnli slayd sifatida chiziladi.
  // Ilgari bo'sh "0" kartochkasi chizilib, bullets yo'qolardi (2026-09-24).
  if (realStats.length < 2 && bullets.length) {
    const lead = realStats[0] || keyStat;
    const withStat = lead ? [`${lead.number} — ${lead.label}`, ...bullets] : bullets;
    layoutContentBullets(s, { ...slide, body: { ...slide.body, bullets: withStat } }, meta, deckTitle, page, total);
    return;
  }
  s.background = { color: C.bgLight };
  addHeaderBadge(s, meta);
  addSlideTitle(s, slide.title, slide.subtitle, 12.2);
  const stats = realStats.length ? realStats.slice(0, 4) : keyStat ? [keyStat] : [];
  const n = Math.max(stats.length, 1);
  const gap = THEME.spacing.gutter;
  const cardW = (12.2 - gap * (n - 1)) / n;
  // Har blok o'z rangida — takrorlanuvchi oq kartochka emas.
  const fills = [C.primary, C.accent, C.card, C.secondary];
  stats.forEach((st, i) => {
    const x = M + i * (cardW + gap);
    const fill = fills[i % fills.length];
    const onDark = fill !== C.card;
    s.addShape('rect', {
      x,
      y: 2.25,
      w: cardW,
      h: 4.15,
      fill: { color: fill },
      line: onDark ? { type: 'none' } : { color: C.soft, width: 1.5 },
    });
    // Yuqori o'ng burchakdagi qisqa chiziq — blokka belgi beradi.
    s.addShape('rect', {
      x: x + cardW - 0.85,
      y: 2.6,
      w: 0.55,
      h: 0.09,
      fill: { color: onDark ? 'FFFFFF' : C.accent },
      line: { type: 'none' },
    });
    s.addText(st.number, {
      x: x + 0.4,
      y: 3.05,
      w: cardW - 0.8,
      h: 1.5,
      fontSize: autofitFontSize(String(st.number), { base: 54, min: 30, softMaxChars: 6 }),
      bold: true,
      color: onDark ? 'FFFFFF' : C.primary,
      align: 'left',
      valign: 'middle',
      fontFace: F.heading,
    });
    // Raqam bilan izoh orasida ingichka ajratuvchi.
    s.addShape('rect', {
      x: x + 0.4,
      y: 4.72,
      w: cardW - 0.8,
      h: 0.02,
      fill: { color: onDark ? 'FFFFFF' : C.soft },
      line: { type: 'none' },
    });
    s.addText(st.label, {
      x: x + 0.4,
      y: 4.9,
      w: cardW - 0.8,
      h: 1.2,
      fontSize: 15,
      color: onDark ? 'F0F4F6' : C.muted,
      align: 'left',
      valign: 'top',
      fontFace: F.body,
      fit: 'shrink',
    });
  });
  addFooter(s, deckTitle, page, total);
}

/**
 * Qiyoslash. Ilgari uch ustunli quruq jadval edi - endi ikkita rangli
 * panel: chapda va o\'ngda tomonlar, ular orasida mezon yorlig\'i. Har bir
 * mezon nozik chiziq bilan ajratiladi, ya\'ni ko\'z qatorni yo\'qotmaydi.
 */
function layoutComparison(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  s.background = { color: C.bgLight };
  addHeaderBadge(s, meta);
  const top = addSlideTitle(s, slide.title, slide.subtitle, 12.2);
  const rows = (slide.body.comparison_rows || []).slice(0, 6);
  const L2 = buildLabels(meta);
  const headers = slide.body.comparison_headers;
  const leftHead = headers?.left?.trim() || L2.left;
  const rightHead = headers?.right?.trim() || L2.right;
  // Uch zona: chap panel | mezon ustuni | o\'ng panel.
  const midW = 2.9;
  const sideW = (12.2 - midW) / 2;
  const rightX = M + sideW + midW;
  const headH = 0.72;
  const bodyY = top + headH;
  const bodyH = 6.45 - bodyY;
  const rowH = rows.length ? bodyH / rows.length : bodyH;
  // Panellarning fon maydoni.
  s.addShape('rect', {
    x: M, y: bodyY, w: sideW, h: bodyH,
    fill: { color: C.card }, line: { type: 'none' },
  });
  s.addShape('rect', {
    x: rightX, y: bodyY, w: sideW, h: bodyH,
    fill: { color: C.zebra }, line: { type: 'none' },
  });
  // Sarlavha lentalari.
  const head = (x: number, text: string, fill: string) => {
    s.addShape('rect', {
      x, y: top, w: sideW, h: headH,
      fill: { color: fill }, line: { type: 'none' },
    });
    s.addText(text, {
      x: x + 0.15, y: top, w: sideW - 0.3, h: headH,
      fontSize: 17, bold: true, color: C.textLight,
      align: 'center', valign: 'middle', fontFace: F.heading, fit: 'shrink',
    });
  };
  head(M, leftHead, C.primary);
  head(rightX, rightHead, C.secondary);
  rows.forEach((r, i2) => {
    const y = bodyY + i2 * rowH;
    if (i2 > 0) {
      // Uchala zonani kesib o\'tuvchi nozik ajratgich.
      s.addShape('rect', {
        x: M, y, w: 12.2, h: 0.012,
        fill: { color: C.soft }, line: { type: 'none' },
      });
    }
    s.addText(r.criteria, {
      x: M + sideW, y, w: midW, h: rowH,
      fontSize: 13, bold: true, color: C.accent,
      align: 'center', valign: 'middle', fontFace: F.body, fit: 'shrink',
    });
    s.addText(r.left, {
      x: M + 0.22, y, w: sideW - 0.44, h: rowH,
      fontSize: 14, color: C.textDark,
      valign: 'middle', fontFace: F.body, fit: 'shrink',
    });
    s.addText(r.right, {
      x: rightX + 0.22, y, w: sideW - 0.44, h: rowH,
      fontSize: 14, color: C.textDark,
      valign: 'middle', fontFace: F.body, fit: 'shrink',
    });
  });
  addFooter(s, deckTitle, page, total);
}

/**
 * Jarayon. Ilgari ajralgan doiralar va matn edi — bosqichlar orasida hech
 * qanday bog\'lanish ko\'rinmasdi. Endi doiralar ostidan o\'tuvchi lenta va
 * ular orasida mis strelkalar bor, ya\'ni ketma-ketlik ko\'z bilan o\'qiladi.
 */
function layoutProcess(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  s.background = { color: C.bgLight };
  addHeaderBadge(s, meta);
  addSlideTitle(s, slide.title, slide.subtitle, 12.2);
  const steps = slide.body.process_steps?.length
    ? slide.body.process_steps.slice(0, 5)
    : (slide.body.bullets || []).slice(0, 4).map((b, i) => ({
        step_number: i + 1,
        label: b.slice(0, 40),
        description: '',
      }));
  const n = steps.length;
  const usable = 12.2;
  const stepW = usable / n;
  const discY = 2.75;
  const discD = 1.05;
  // Bosqichlarni bog'lovchi uzluksiz lenta — birinchi va oxirgi disk orasida.
  s.addShape('rect', {
    x: M + stepW / 2,
    y: discY + discD / 2 - 0.025,
    w: usable - stepW,
    h: 0.05,
    fill: { color: C.soft },
    line: { type: 'none' },
  });
  steps.forEach((step, i) => {
    const cx = M + i * stepW + stepW / 2;
    // Lenta disk ostidan o'tmasin — disk atrofida fon rangli halqa.
    s.addShape('ellipse', {
      x: cx - discD / 2 - 0.1,
      y: discY - 0.1,
      w: discD + 0.2,
      h: discD + 0.2,
      fill: { color: C.bgLight },
      line: { type: 'none' },
    });
    s.addShape('ellipse', {
      x: cx - discD / 2,
      y: discY,
      w: discD,
      h: discD,
      fill: { color: i % 2 === 0 ? C.primary : C.secondary },
      line: { type: 'none' },
    });
    s.addText(String(step.step_number || i + 1), {
      x: cx - discD / 2,
      y: discY,
      w: discD,
      h: discD,
      fontSize: 24,
      bold: true,
      color: C.textLight,
      align: 'center',
      valign: 'middle',
      fontFace: F.heading,
    });
    // Bosqichlar orasidagi strelka.
    if (i < n - 1) {
      s.addShape('triangle', {
        x: cx + stepW / 2 - 0.16,
        y: discY + discD / 2 - 0.16,
        w: 0.32,
        h: 0.32,
        rotate: 90,
        fill: { color: C.accent },
        line: { type: 'none' },
      });
    }
    // Eng uzun SO\'Z ustunga sig\'sin: "Termoregulyatsiya" kabi so\'z 17pt da
    // ikkiga bo\'linib ketardi.
    const longest = Math.max(
      ...step.label.split(/\s+/).map((word) => word.length),
      1,
    );
    const labelFs = Math.max(
      11,
      Math.min(17, Math.floor(((stepW - 0.3) * 72) / (longest * 0.62))),
    );
    s.addText(step.label, {
      x: M + i * stepW + 0.12,
      y: discY + discD + 0.35,
      w: stepW - 0.24,
      h: 0.75,
      fontSize: labelFs,
      bold: true,
      color: C.primary,
      align: 'center',
      valign: 'top',
      fontFace: F.heading,
      fit: 'shrink',
    });
    if (step.description) {
      s.addText(step.description, {
        x: M + i * stepW + 0.12,
        y: discY + discD + 1.15,
        w: stepW - 0.24,
        h: 1.5,
        fontSize: 14,
        color: C.muted,
        align: 'center',
        valign: 'top',
        fontFace: F.body,
        fit: 'shrink',
      });
    }
  });
  addFooter(s, deckTitle, page, total);
}

function layoutQuote(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  s.background = { color: C.bgLight };
  addHeaderBadge(s, meta);
  s.addText('“', {
    x: M,
    y: 1.4,
    w: 1.5,
    h: 1.2,
    fontSize: 96,
    color: C.accent,
    fontFace: F.heading,
  });
  const quote = slide.body.quote_text || slidePreviewBullets(slide).join(' ');
  s.addText(quote, {
    x: M + 0.8,
    y: 2.4,
    w: 11.0,
    h: 2.4,
    fontSize: autofitFontSize(quote, { base: 22, min: 14, softMaxChars: 120 }),
    italic: true,
    color: C.textDark,
    fontFace: F.body,
  });
  s.addShape('rect', {
    x: M + 0.8,
    y: 5.1,
    w: 2.2,
    h: 0.06,
    fill: { color: C.primary },
    line: { type: 'none' },
  });
  s.addText(slide.body.quote_author || slide.subtitle || '', {
    x: M + 0.8,
    y: 5.3,
    w: 10,
    h: 0.4,
    fontSize: 14,
    color: C.muted,
    fontFace: F.body,
  });
  addFooter(s, deckTitle, page, total);
}

/**
 * Klinik holat. Ilgari bitta oq quti ichida ro\'yxat edi. Endi chapda
 * to\'q bemor kartasi (tibbiy xoch belgisi bilan), o\'ngda topilmalar
 * ro\'yxati - ya\'ni holat va xulosa vizual ajratilgan.
 */
function layoutCaseStudy(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  s.background = { color: C.bgLight };
  addHeaderBadge(s, meta);
  const top = addSlideTitle(s, slide.title, slide.subtitle, 12.2);
  const hasImage = Boolean(slide.imageUrl);
  const cardW = 4.15;
  const bodyH = 6.45 - top;
  const rightX = M + cardW + 0.35;
  const rightW = 12.2 - cardW - 0.35;
  // Bemor kartasi.
  s.addShape('rect', {
    x: M, y: top, w: cardW, h: bodyH,
    fill: { color: C.primary }, line: { type: 'none' },
  });
  // Tibbiy xoch - ikki to\'rtburchakdan yig\'ilgan belgi.
  const cx = M + cardW / 2;
  // Xoch yuqoriroqda: pastda rasmga to\'liq kenglik bo\'shatiladi.
  const cy = top + 0.85;
  s.addShape('rect', {
    x: cx - 0.13, y: cy - 0.42, w: 0.26, h: 0.84,
    fill: { color: C.accent }, line: { type: 'none' },
  });
  s.addShape('rect', {
    x: cx - 0.42, y: cy - 0.13, w: 0.84, h: 0.26,
    fill: { color: C.accent }, line: { type: 'none' },
  });
  s.addText(buildLabels(meta).caseStudy.toUpperCase(), {
    x: M + 0.25, y: cy + 0.62, w: cardW - 0.5, h: 0.35,
    fontSize: 12, bold: true, color: C.accent,
    align: 'center', charSpacing: 1.5, fontFace: F.body,
  });
  s.addShape('rect', {
    x: cx - 0.55, y: cy + 1.06, w: 1.1, h: 0.03,
    fill: { color: C.textLight }, line: { type: 'none' },
  });
  if (hasImage) {
    // Rasm kartochka kengligi bo\'ylab to\'ldiradi - oq ramkadagi kichkina
    // rasm o\'rniga, chunki u to\'q fonda yamoqdek ko\'rinardi.
    const imgY = cy + 1.35;
    addBleedImage(s, slide, M, imgY, cardW, top + bodyH - imgY, 'right');
  } else if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: M + 0.3, y: cy + 1.35, w: cardW - 0.6, h: bodyH - (cy + 1.35 - top) - 0.3,
      fontSize: 15, color: C.textLight, italic: true,
      align: 'center', valign: 'top', fontFace: F.body, fit: 'shrink',
    });
  }
  // Topilmalar.
  s.addShape('rect', {
    x: rightX, y: top, w: rightW, h: bodyH,
    fill: { color: C.card }, line: { type: 'none' },
  });
  addNumberedBullets(s, slide.body.bullets || slidePreviewBullets(slide), {
    x: rightX + 0.3, y: top + 0.28, w: rightW - 0.6, h: bodyH - 0.56,
  });
  addFooter(s, deckTitle, page, total);
}

/**
 * Xulosa. Qator balandligi 1.15" bilan cheklangan edi - ikki-uchta band
 * bo\'lsa slaydning yarmi bo\'sh turardi. Endi mavjud joyga taqsimlanadi.
 */
function layoutSummary(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  s.background = { color: C.bgLight };
  addHeaderBadge(s, meta);
  const top = addSlideTitle(s, slide.title, slide.subtitle, 12.2);
  const bullets = slidePreviewBullets(slide).slice(0, 5);
  const bodyH = 6.5 - top;
  const rowH = bullets.length ? bodyH / bullets.length : bodyH;
  bullets.forEach((b, i) => {
    const y = top + i * rowH;
    const split = b.match(/^([^:—–-]{4,48})[:—–-]\s*(.+)$/);
    // Ilgari ajratgich topilmasa matn 48 belgida kesilardi va so\'z o\'rtasida
    // uzilib qolardi. Endi bunday band butunligicha izoh sifatida chiqadi.
    const head = split ? split[1].trim() : '';
    const tail = split ? split[2].trim() : b;
    if (i > 0) {
      s.addShape('rect', {
        x: M, y: y - 0.06, w: 12.2, h: 0.008,
        fill: { color: C.soft }, line: { type: 'none' },
      });
    }
    s.addText(`${i + 1}.`, {
      x: M,
      y,
      w: 0.7,
      h: 0.45,
      fontSize: 20,
      bold: true,
      color: C.accent,
      fontFace: F.heading,
      wrap: false,
    });
    if (head) {
      s.addText(head, {
      x: M + 0.75,
      y,
      w: 11.4,
      h: 0.42,
      fontSize: 18,
      bold: true,
      color: C.textDark,
      fontFace: F.heading,
      fit: 'shrink',
      });
    }
    if (tail) {
      const tailY = head ? y + 0.44 : y;
      const tailH = Math.max(0.3, rowH - (head ? 0.52 : 0.1));
      s.addText(tail, {
        x: M + 0.75,
        y: tailY,
        w: 11.4,
        h: tailH,
        fontSize: fitTextSize(tail, 11.4, tailH, head ? 15 : 19, 12),
        color: C.muted,
        fontFace: F.body,
        valign: 'top',
        fit: 'shrink',
      });
    }
  });
  addFooter(s, deckTitle, page, total);
}

function layoutReferences(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  s.background = { color: C.bgLight };
  addHeaderBadge(s, meta);
  const fallbackTitle =
    meta.language === 'ru' ? 'Использованные источники' : meta.language === 'en' ? 'References' : 'Foydalanilgan manbalar';
  s.addText(slide.title || fallbackTitle, {
    x: M,
    y: 0.7,
    w: 12.2,
    h: 0.45,
    fontSize: 24,
    bold: true,
    color: C.primary,
    fontFace: F.heading,
  });
  const bullets = slidePreviewBullets(slide).slice(0, 12);
  const rowH = Math.min(0.52, 5.6 / Math.max(bullets.length, 1));
  const fontSize = autofitFontSize(bullets.join(' '), {
    base: 13,
    min: 10,
    softMaxChars: 700,
  });
  bullets.forEach((b, i) => {
    const y = 1.3 + i * rowH;
    s.addText(`${i + 1}.`, {
      x: M,
      y,
      w: 0.4,
      h: rowH,
      fontSize,
      bold: true,
      color: C.accent,
      fontFace: F.body,
      valign: 'top',
    });
    s.addText(b, {
      x: M + 0.45,
      y,
      w: 11.7,
      h: rowH,
      fontSize,
      color: C.textDark,
      fontFace: F.body,
      valign: 'top',
    });
  });
  addFooter(s, deckTitle, page, total);
}

function renderSlide(
  s: PptxSlide,
  slide: ContentSlide,
  meta: PresentationBuildMeta,
  deckTitle: string,
  page: number,
  total: number,
): void {
  switch (slide.slide_type) {
    case 'title':
      layoutTitle(s, slide, meta, deckTitle, page, total);
      break;
    case 'agenda':
      layoutAgenda(s, slide, meta, deckTitle, page, total);
      break;
    case 'content_bullets':
      layoutContentBullets(s, slide, meta, deckTitle, page, total);
      break;
    case 'two_column':
      layoutTwoColumn(s, slide, meta, deckTitle, page, total);
      break;
    case 'image_focus':
      layoutImageFocus(s, slide, meta, deckTitle, page, total);
      break;
    case 'statistics':
      layoutStatistics(s, slide, meta, deckTitle, page, total);
      break;
    case 'comparison_table':
      layoutComparison(s, slide, meta, deckTitle, page, total);
      break;
    case 'process_flow':
      layoutProcess(s, slide, meta, deckTitle, page, total);
      break;
    case 'quote':
      layoutQuote(s, slide, meta, deckTitle, page, total);
      break;
    case 'case_study':
      layoutCaseStudy(s, slide, meta, deckTitle, page, total);
      break;
    case 'summary':
      layoutSummary(s, slide, meta, deckTitle, page, total);
      break;
    case 'references':
      layoutReferences(s, slide, meta, deckTitle, page, total);
      break;
    default:
      layoutContentBullets(s, slide, meta, deckTitle, page, total);
  }
}

export type BuildPresentationOptions = {
  meta?: PresentationBuildMeta;
};

export async function buildPresentationPptxFile(
  deck: PresentationContent | { title?: string; slides?: unknown[] },
  options?: BuildPresentationOptions,
): Promise<File> {
  const parsed =
    deck && typeof deck === 'object' && 'presentation_title' in deck
      ? (deck as PresentationContent)
      : coercePresentationContent(deck, {
          title: (deck as { title?: string })?.title || 'Taqdimot',
          subject: options?.meta?.subjectName || '',
        });

  const meta: PresentationBuildMeta = options?.meta || {
    subjectName: parsed.subject_area || 'Fan',
    topicId: 'T',
  };

  // Saqlangan taqdimotda data:URL rasm bo'lmaydi (bazani shishirmaslik uchun
  // olib tashlanadi), faqat asl havola qoladi — rasm o'sha havoladan qayta
  // tortiladi. 2026-10-20 dan HAR rasm (eski saqlanganlari ham) odob bo'yicha
  // tekshiriladi; o'tmagani slayddan olib tashlanadi.
  const content = await ensureSafeSlideImages(parsed);

  // Modul alohida faylda yuklanadi. Sayt yangilangandan keyin eski sahifa uni topa olmasa (2026-11-16:
  // "taqdimot yaratmayapti, 3 marta qayta bosdim") — umumiy xato emas, nima qilish aniq aytiladi.
  let PptxGenJS: typeof import('pptxgenjs').default;
  try {
    PptxGenJS = (await import('pptxgenjs')).default;
  } catch {
    PptxGenJS = await import('pptxgenjs').then((m) => m.default).catch(() => {
      throw new Error('Sayt yangilangan — sahifani yangilang (F5) va qayta bosing. Yaratilgan taqdimot saqlangan, qayta yaratish shart emas.');
    });
  }
  const pptx = new PptxGenJS();
  pptx.author = content.author || 'iMentor';
  pptx.title = content.presentation_title.slice(0, 120);
  pptx.layout = 'LAYOUT_WIDE';

  const total = content.slides.length;
  content.slides.forEach((slide, idx) => {
    const s = pptx.addSlide();
    renderSlide(s, slide, meta, content.presentation_title, idx + 1, total);
    if (slide.speaker_notes?.trim()) {
      s.addNotes(slide.speaker_notes.trim());
    }
  });

  const plain = (await pptx.write({ outputType: 'blob' })) as Blob;
  // O'tishlar va bosilganda paydo bo'ladigan kontent (2026-10-21) — pptxgenjs buni
  // qo'llamaydi. Xato bo'lsa animatsiyasiz fayl qaytadi, taqdimot yo'qolmaydi.
  const blob = await addSlideAnimations(plain).catch((err) => {
    console.warn('Taqdimotga animatsiya qo\'shib bo\'lmadi:', err);
    return plain;
  });
  const safeName =
    content.presentation_title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 48) ||
    'taqdimot';
  return new File([blob], `${safeName}.pptx`, {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
