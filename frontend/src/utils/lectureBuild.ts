/**
 * Ma'ruza matni (rektor talabi, 2026-10-21):
 *  1. Avval mavzu REJASI — mavzuning barcha qismini qamraydi.
 *  2. Har reja bandi bo'yicha batafsil ma'lumot.
 *  3. Manba — tizimga ulangan kitoblardan: QIZIL rangda, havolasiz, aniq
 *     kitob va sahifa; xalqaro jurnaldan bo'lsa — KO'K havola.
 *  4. Manba ABZAS OXIRIDA (gap ichida emas).
 *  5. Har fakt manbasi bilan.
 *
 * Bu modul — AI'siz qismi: manbalar blokini tayyorlash, iqtiboslarni abzas
 * oxiriga ko'chirish, reja bo'limini tekshirish.
 */
import type { AppLanguage } from '../i18n/language';
import type { MedicalReference } from './medicalReferences';

export type LectureSource = { id: string; type: 'book' | 'protocol' | 'journal'; title: string; page?: string; journal?: string; year?: string; url?: string; text: string };
export type LectureContext = {
  sections: { title: string; sources: LectureSource[] }[];
  protocols: LectureSource[];
  journals: LectureSource[];
};

const WORD = {
  uz: { source: 'Manba', page: (p: string) => `${p}-bet`, plan: 'Reja', refs: 'Foydalanilgan adabiyotlar' },
  ru: { source: 'Источник', page: (p: string) => `стр. ${p}`, plan: 'План', refs: 'Использованная литература' },
  en: { source: 'Source', page: (p: string) => `p. ${p}`, plan: 'Plan', refs: 'References' },
} as const;

function words(language: AppLanguage) {
  return WORD[language] ?? WORD.uz;
}

/** Model AYNAN ko'chiradigan tayyor iqtibos: kitob — nom va sahifa, jurnal — havola bilan. */
export function citationFor(s: LectureSource, language: AppLanguage): string {
  const w = words(language);
  if (s.type === 'journal') {
    const meta = [s.journal, s.year].filter(Boolean).join(', ');
    return `(${w.source}: ${s.title}${meta ? `. ${meta}` : ''}. ${s.url})`;
  }
  return `(${w.source}: ${s.title}${s.page ? `, ${w.page(s.page)}` : ''})`;
}

/** Model uchun manbalar: reja bandlari bo'yicha guruhlangan, har biri tayyor iqtibos bilan. */
export function buildLectureSourcesBlock(ctx: LectureContext, language: AppLanguage): string {
  const parts: string[] = [];
  ctx.sections.forEach((section, i) => {
    parts.push(`### ${i + 1}. ${section.title}`);
    if (!section.sources.length) parts.push('(bu band uchun alohida parcha topilmadi — boshqa bandlar yoki protokol manbalaridan foydalaning)');
    for (const s of section.sources) parts.push(`[${s.id}] CITE: ${citationFor(s, language)}\n${s.text}`);
  });
  if (ctx.protocols.length) {
    parts.push('### Protokollar (MAJBURIY: ziddiyatda ustun)');
    for (const s of ctx.protocols) parts.push(`[${s.id}] CITE: ${citationFor({ ...s, type: 'protocol' }, language)}\n${s.text}`);
  }
  if (ctx.journals.length) {
    parts.push('### Xalqaro jurnallar');
    for (const s of ctx.journals) parts.push(`[${s.id}] CITE: ${citationFor({ ...s, type: 'journal' }, language)}\n${s.text}`);
  }
  return parts.join('\n\n');
}

/** `sanitizeBookCitations` uchun: qaysi kitobning qaysi sahifalari haqiqatan berilgan. */
export function lectureRefsFromContext(ctx: LectureContext): MedicalReference[] {
  const pages = new Map<string, Set<string>>();
  for (const s of [...ctx.sections.flatMap((x) => x.sources), ...ctx.protocols]) {
    const set = pages.get(s.title) ?? new Set<string>();
    if (s.page) set.add(s.page);
    pages.set(s.title, set);
  }
  return [...pages.entries()].map(([title, set]) => ({
    title,
    ...(set.size ? { pages: [...set].join(', ') } : {}),
  })) as MedicalReference[];
}

// Nom ichida bitta qavs darajasi bo'lishi mumkin ("O‘zMSt 134-2024 (2)").
const CITE_RE = /\s*\((?:Manba|Источник|Source)\s*:\s*(?:[^()]|\([^()]*\))+\)/gi;
const BLOCK_SKIP = /^(?:#|```|\||>|<)/;
const HAS_CITE = /\((?:Manba|Источник|Source)\s*:/i;

/**
 * Iqtiboslar ABZAS OXIRIGA: gap ichida yoki o'rtada turgan `(Manba: …)` olinib,
 * takrorsiz abzas oxiriga qo'yiladi. Sarlavha, kod va jadval qatorlariga tegilmaydi.
 * Ro'yxat bandlari alohida abzas kabi (har band o'z manbasi bilan).
 */
export function moveCitationsToParagraphEnd(markdown: string): string {
  const blocks = (markdown || '').split(/\n{2,}/);
  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed || BLOCK_SKIP.test(trimmed)) return block;
      const lines = block.split('\n');
      const isList = lines.every((l) => !l.trim() || /^\s*(?:[-*+]|\d+[.)])\s/.test(l));
      const units = isList ? lines : [block];
      const fixed = units.map((unit) => {
        const cites = [...unit.matchAll(CITE_RE)].map((m) => m[0].trim());
        if (!cites.length) return unit;
        const unique = [...new Set(cites)];
        const body = unit.replace(CITE_RE, '').replace(/\s+([.,;:])/g, '$1').replace(/[ \t]+$/g, '');
        return `${body} ${unique.join(' ')}`;
      });
      return isList ? fixed.join('\n') : fixed[0];
    })
    .join('\n\n');
}

/** Reja bo'limi bormi; bo'lmasa — `# Mavzu` dan keyin reja ro'yxati qo'shiladi. */
export function ensurePlanSection(markdown: string, plan: string[], language: AppLanguage): string {
  const w = words(language);
  const text = markdown || '';
  if (!plan.length || new RegExp(`^##\\s+${w.plan}\\b`, 'im').test(text)) return text;
  const list = `## ${w.plan}\n\n${plan.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n`;
  const m = text.match(/^#\s+.+\n/m);
  if (!m || m.index === undefined) return `${list}\n${text}`;
  const at = m.index + m[0].length;
  return `${text.slice(0, at)}\n${list}\n${text.slice(at)}`;
}

/**
 * Reja bandi matni. Model ba'zan `{"title": "...", "focus": "..."}` qaytaradi —
 * `String(obj)` "[object Object]" berib, ma'ruza rejasi buzilgan edi (2026-10-21).
 */
export function planItemText(item: unknown): string {
  if (typeof item === 'string') return item;
  if (typeof item === 'number') return String(item);
  if (!item || typeof item !== 'object') return '';
  const o = item as Record<string, unknown>;
  for (const key of ['title', 'heading', 'name', 'item', 'section', 'text', 'topic']) {
    if (typeof o[key] === 'string' && (o[key] as string).trim()) return o[key] as string;
  }
  const first = Object.values(o).find((v) => typeof v === 'string' && v.trim());
  return typeof first === 'string' ? first : '';
}

/**
 * Ma'ruza o'rniga AI'ning RAD javobi (2026-10-21): "Kechirasiz … darslik parchasi
 * yuborilmadi … iltimos yuboring". 21-oktabrda 21 ta shunday "ma'ruza" saqlandi va
 * taqdimot shu matndan 25 slayd yasadi ("parcha yuborsangiz…"). Bunday matn
 * saqlanmaydi va boshqa materialga manba bo'lmaydi.
 */
const REFUSAL =
  /yuborilmadi|iltimos.{0,40}yubor|kechirasiz|bajarib bo.?lmay|aniqlashtirish savol|sizdan kerak|kerak bo.?ladigan .{0,20}ma.?lumot|пришлите|не были предоставлены|к сожалению|извините|не могу|please (?:send|provide)|were not provided|i cannot|i can['’]t|i(?: am|['’]m) unable|missing the|lack the/i;

export function isLectureRefusal(text: string): boolean {
  const s = (text || '').trim();
  if (!s) return true;
  // Reja bandi obyekt bo'lib qolgan (2026-10-21) — model shuni "tuzatib yuboring" deb qaytardi.
  if (s.includes('[object Object]')) return true;
  if (!/^#\s/.test(s) && REFUSAL.test(s.slice(0, 1500))) return true;
  const sections = (s.match(/(?:^|\s)##\s/g) || []).length;
  return sections < 2 && s.split(/\s+/).length < 400;
}

/** Iqtibossiz abzaslar ulushi — jurnal uchun (har fakt manbali bo'lishi kerak). */
export function uncitedParagraphShare(markdown: string): number {
  const paras = (markdown || '')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b && !BLOCK_SKIP.test(b) && b.split(/\s+/).length >= 25);
  if (!paras.length) return 0;
  const bare = paras.filter((p) => !HAS_CITE.test(p));
  return bare.length / paras.length;
}
