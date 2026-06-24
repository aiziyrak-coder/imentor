/**
 * PDF/text translation — text-first (fast) with vision fallback for scans.
 */
import type { AppLanguage } from '../i18n/language';
import { aiLanguageName } from '../i18n/language';
import {
  assertDeepseekApiKey,
  deepseekText,
  deepseekWithImage,
  DEEPSEEK_CHAT,
} from './deepseekClient';
import { parseAiJson } from '../utils/parseAiJson';

export type TranslatedBlock = { box: [number, number, number, number]; text: string };

export type PageTranslationResult =
  | { mode: 'text'; translatedText: string }
  | { mode: 'visual'; translatedBlocks: TranslatedBlock[] };

const MIN_TEXT_CHARS = 48;
const CHUNK_SIZE = 2600;
const PARALLEL_PAGES = 4;

function translationSystem(targetLang: AppLanguage): string {
  const name = aiLanguageName(targetLang);
  const uzRules =
    targetLang === 'uz'
      ? `
Uzbek (Latin) — CRITICAL quality rules:
- Correct apostrophes: o', g', O', G' (sog'liq, ta'sir, o'qitish, muammolar).
- Natural academic Uzbek; avoid Russian calques and random English words.
- Standard Uzbek medical faculty terminology (tibbiyot fakulteti uslubi).
- Keep: DNA, RNA, MRI, ECG, HIV, COVID-19, mg, ml, mmHg, pH, ISO abbreviations.
- Preserve numbers, doses, units, citations, author names exactly.
`
      : targetLang === 'ru'
        ? `
Russian — use standard clinical Russian; preserve Latin abbreviations where customary.
`
        : `
English — clear academic medical English.
`;

  return (
    `Expert medical/scientific translator. Translate the ENTIRE input into ${name}.\n` +
    `Output ONLY the translation — no notes, no source text, no markdown fences.\n` +
    `Preserve paragraph breaks and list structure. Clinically accurate terminology.\n` +
    uzRules
  );
}

function chunkText(text: string, maxLen = CHUNK_SIZE): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= maxLen) return [normalized];

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = '';

  for (const para of paragraphs) {
    const piece = buf ? `${buf}\n\n${para}` : para;
    if (piece.length <= maxLen) {
      buf = piece;
      continue;
    }
    if (buf) {
      chunks.push(buf);
      buf = '';
    }
    if (para.length <= maxLen) {
      buf = para;
      continue;
    }
    let start = 0;
    while (start < para.length) {
      chunks.push(para.slice(start, start + maxLen));
      start += maxLen;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.filter(Boolean);
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function estimateMaxTokens(inputLen: number): number {
  return Math.min(4096, Math.max(384, Math.ceil(inputLen * 1.15) + 192));
}

export async function translatePlainText(text: string, targetLang: AppLanguage): Promise<string> {
  assertDeepseekApiKey();
  const trimmed = text.trim();
  if (!trimmed) return '';

  const chunks = chunkText(trimmed);
  if (chunks.length === 1) {
    return deepseekText({
      model: DEEPSEEK_CHAT,
      system: translationSystem(targetLang),
      user: chunks[0],
      maxTokens: estimateMaxTokens(chunks[0].length),
      temperature: 0.1,
    });
  }

  const parts = await mapPool(chunks, PARALLEL_PAGES, async (chunk) =>
    deepseekText({
      model: DEEPSEEK_CHAT,
      system: translationSystem(targetLang),
      user: chunk,
      maxTokens: estimateMaxTokens(chunk.length),
      temperature: 0.1,
    }),
  );
  return parts.join('\n\n');
}

function normalizeBlocks(input: unknown): TranslatedBlock[] {
  if (!Array.isArray(input)) return [];
  const out: TranslatedBlock[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const box = (item as { box?: unknown }).box;
    const text = (item as { text?: unknown }).text;
    if (!Array.isArray(box) || box.length !== 4) continue;
    const nums = box.map((v) => Number(v));
    if (nums.some((n) => Number.isNaN(n))) continue;
    const [ymin, xmin, ymax, xmax] = nums as [number, number, number, number];
    if (ymax <= ymin || xmax <= xmin) continue;
    const line = typeof text === 'string' ? text.trim() : '';
    if (!line) continue;
    out.push({ box: [ymin, xmin, ymax, xmax], text: line });
  }
  return out;
}

async function translatePageVisual(imageBase64: string, targetLang: AppLanguage): Promise<TranslatedBlock[]> {
  const targetName = aiLanguageName(targetLang);
  const uzVision =
    targetLang === 'uz'
      ? ' Use fluent Uzbek (Latin) with o\' and g\' apostrophes. No Russian/English mixing except standard abbreviations.'
      : '';

  const raw = await deepseekWithImage({
    model: DEEPSEEK_CHAT,
    system:
      'Medical document OCR + translator. Detect text blocks (titles, body, captions, tables). ' +
      `Translate ALL text into ${targetName}.${uzVision} ` +
      'Return ONLY a JSON array: [{"box":[ymin,xmin,ymax,xmax],"text":"..."}]. ' +
      'Coordinates normalized 0–1000. Merge lines of same paragraph. Max 35 blocks.',
    userText: `Extract and translate every text block into ${targetName}. JSON array only.`,
    imageBase64,
    mimeType: 'image/jpeg',
    maxTokens: 3072,
  });

  const parsed = parseAiJson<unknown>(raw);
  const blocks = normalizeBlocks(parsed);
  if (blocks.length === 0) throw new Error('visual-empty');
  return blocks;
}

export async function translatePdfPage(
  imageBase64: string,
  sourceText: string,
  targetLang: AppLanguage,
): Promise<PageTranslationResult> {
  const cleanB64 = imageBase64.includes(',') ? imageBase64.split(',')[1]! : imageBase64;
  const text = sourceText.trim();

  if (text.length >= MIN_TEXT_CHARS) {
    const translatedText = await translatePlainText(text, targetLang);
    if (translatedText.trim()) return { mode: 'text', translatedText: translatedText.trim() };
  }

  const translatedBlocks = await translatePageVisual(cleanB64, targetLang);
  return { mode: 'visual', translatedBlocks };
}

export type PageInput = { id: number; imageBase64: string; sourceText: string };

export async function translatePdfPagesBatch(
  pages: PageInput[],
  targetLang: AppLanguage,
  onProgress?: (done: number, total: number, pageId: number, result: PageTranslationResult) => void,
): Promise<Map<number, PageTranslationResult>> {
  assertDeepseekApiKey();
  const out = new Map<number, PageTranslationResult>();
  let done = 0;

  await mapPool(pages, PARALLEL_PAGES, async (page) => {
    const result = await translatePdfPage(page.imageBase64, page.sourceText, targetLang);
    out.set(page.id, result);
    done += 1;
    onProgress?.(done, pages.length, page.id, result);
  });

  return out;
}

/** Extract page text from pdf.js text layer (fast, no AI). */
export async function extractPdfPageText(
  page: import('pdfjs-dist').PDFPageProxy,
): Promise<string> {
  const content = await page.getTextContent();
  const lines: string[] = [];
  let lastY: number | null = null;
  let line = '';

  for (const item of content.items) {
    if (!('str' in item)) continue;
    const str = String(item.str || '');
    if (!str) continue;
    const tr = item.transform;
    const y = tr ? Math.round(tr[5] ?? 0) : 0;

    if (lastY !== null && Math.abs(y - lastY) > 4 && line.trim()) {
      lines.push(line.trim());
      line = str;
    } else {
      line = line ? `${line} ${str}` : str;
    }
    lastY = y;
  }
  if (line.trim()) lines.push(line.trim());

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const PDF_RENDER_SCALE = 1.25;
export const PDF_JPEG_QUALITY = 0.72;
