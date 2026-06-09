/**
 * Tibbiy taqdimot — OpenAI (server) + post-process (infografika, diagramma, klinik slaydlar).
 * Test, keys, ma'ruza va boshqalar DeepSeek da qoladi.
 */
import * as pdfjsLib from 'pdfjs-dist';
import { type AppLanguage } from '../i18n/language';
import {
  generatePresentationFromTextViaOpenAI,
  generatePresentationViaOpenAI,
  type PresentationPhase,
} from './openaiPresentationClient';
import type { Slide, SlideKind, SlideLayout, VisualBlock, VisualBlockType } from './presentationTypes';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

export type { PresentationPhase };

const VISUAL_TYPES: VisualBlockType[] = [
  'flow',
  'stats',
  'compare',
  'pyramid',
  'timeline',
  'cycle',
  'table',
  'icon-grid',
  'clinical',
];

function buildPedagogicSlidePlan(topic: string, count: number): string[] {
  const core = [
    `Mavzu: ${topic} — dolzarblik va global yuk`,
    "O'quv maqsadlari (SMART)",
    'Asosiy tushunchalar va ta\'riflar',
    'Epidemiologiya va statistika (raqamli ko\'rsatkichlar)',
    'Etiologiya va xavf omillari',
    'Patogenez — bosqichma-bosqich mexanizm',
    'Klinik belgilar va simptomlar',
    'Fizikal ko\'rik va anamnez algoritmi',
    'Laborator va instrumental diagnostika',
    'Differensial diagnostika (taqqoslash)',
    'Davolash strategiyasi va algoritm',
    'Klinik vaziyat (case) — qaror nuqtalari',
    'Asoratlar, profilaktika va skrining',
    'Xulosa va amaliy checklist',
    'Savol–javob / muhokama uchun savollar',
  ];
  if (count <= core.length) return core.slice(0, count);
  return [...core, ...Array.from({ length: count - core.length }, (_, i) => `Amaliy mavzu ${i + 1}`)];
}

function inferVisualType(title: string, kind?: SlideKind, index?: number): VisualBlockType {
  const t = title.toLowerCase();
  if (kind === 'clinical' || /klinik|case|vaziyat|bemor/.test(t)) return 'clinical';
  if (kind === 'title' || index === 0) return 'stats';
  if (/epidemiolog|statistika|ko'rsatkich|prevalens|insidens|foiz|%.|raqam/.test(t)) return 'stats';
  if (/patogenez|mexanizm|bosqich|jarayon|algoritm|diagnostika/.test(t)) return 'flow';
  if (/differensial|taqqos|vs|qarshi/.test(t)) return 'compare';
  if (/davolash|terapiya|reja|protokol|timeline|bosqich/.test(t)) return 'timeline';
  if (/asorat|profilaktika|piramida|daraja|tashxis/.test(t)) return 'pyramid';
  if (/xulosa|checklist|xavf|omil|tushuncha/.test(t)) return 'icon-grid';
  if (/laborator|jadval|sinf/.test(t)) return 'table';
  if (/siklus|tsikl|aylanma/.test(t)) return 'cycle';
  return index && index % 5 === 0 ? 'clinical' : 'flow';
}

function buildVisualFromContent(slide: Slide, type: VisualBlockType): VisualBlock {
  const bullets = slide.content || [];
  switch (type) {
    case 'stats':
      return {
        type: 'stats',
        caption: slide.subtitle || slide.title,
        stats: bullets.slice(0, 4).map((b, i) => ({
          label: b.slice(0, 48),
          value: ['24', '68', '12', '85'][i % 4],
          unit: i % 2 === 0 ? '%' : undefined,
        })),
      };
    case 'compare':
      return {
        type: 'compare',
        caption: slide.title,
        left: { title: 'Asosiy', items: bullets.slice(0, 2) },
        right: {
          title: 'Farqli',
          items: bullets.slice(2, 4).length ? bullets.slice(2, 4) : ['Alternativa 1', 'Alternativa 2'],
        },
      };
    case 'pyramid':
      return {
        type: 'pyramid',
        levels: bullets.slice(0, 3).map((b, i) => ({
          label: `Daraja ${3 - i}`,
          items: [b],
        })),
      };
    case 'timeline':
      return {
        type: 'timeline',
        events: bullets.slice(0, 4).map((b, i) => ({
          time: `${i + 1}`,
          text: b,
        })),
      };
    case 'cycle':
      return {
        type: 'cycle',
        nodes: bullets.slice(0, 5).map((b, i) => ({ id: `n${i}`, label: b.slice(0, 40) })),
        links: bullets.slice(0, 5).map((_, i, arr) => ({
          from: `n${i}`,
          to: `n${(i + 1) % arr.length}`,
        })),
      };
    case 'table':
      return {
        type: 'table',
        rows: [
          ['Ko\'rsatkich', 'Qiymat', 'Izoh'],
          ...bullets.slice(0, 4).map((b) => [b.slice(0, 30), '—', 'Klinik ahamiyat']),
        ],
      };
    case 'icon-grid':
      return {
        type: 'icon-grid',
        icons: bullets.slice(0, 6).map((b, i) => ({
          icon: ['🫀', '🧬', '💊', '🔬', '🏥', '📋'][i % 6],
          label: `Nuqta ${i + 1}`,
          text: b,
        })),
      };
    case 'clinical':
      return {
        type: 'clinical',
        vignette: {
          patient: slide.subtitle || 'Bemor profili',
          findings: bullets.slice(0, 3),
          question: slide.keyTakeaway || 'Sizning diagnostik va davolash rejangiz?',
        },
      };
    case 'flow':
    default:
      return {
        type: 'flow',
        caption: slide.title,
        steps: bullets.slice(0, 5).map((b) => ({
          label: b.slice(0, 50),
          detail: b.length > 50 ? b.slice(50, 120) : undefined,
        })),
      };
  }
}

function visualHasRenderableData(v: VisualBlock): boolean {
  switch (v.type) {
    case 'flow':
      return (v.steps?.length ?? 0) >= 1;
    case 'stats':
      return (v.stats?.length ?? 0) >= 1;
    case 'compare':
      return Boolean(v.left?.items?.length || v.right?.items?.length);
    case 'pyramid':
      return (v.levels?.length ?? 0) >= 1;
    case 'timeline':
      return (v.events?.length ?? 0) >= 1;
    case 'cycle':
      return (v.nodes?.length ?? 0) >= 1;
    case 'table':
      return (v.rows?.length ?? 0) >= 1;
    case 'icon-grid':
      return (v.icons?.length ?? 0) >= 1;
    case 'clinical':
      return Boolean(v.vignette?.patient || v.vignette?.findings?.length);
    default:
      return false;
  }
}

function normalizeVisual(raw: unknown, slide: Slide, index: number): VisualBlock {
  const kind = slide.slideKind;
  const inferred = inferVisualType(slide.title, kind, index);
  if (raw && typeof raw === 'object' && 'type' in raw) {
    const v = raw as VisualBlock;
    if (VISUAL_TYPES.includes(v.type) && visualHasRenderableData(v)) {
      return v;
    }
  }
  return buildVisualFromContent(slide, inferred);
}

function assignLayout(slide: Slide, index: number): SlideLayout {
  if (index === 0 || slide.slideKind === 'title') return 'title';
  if (slide.slideKind === 'clinical' || slide.visual?.type === 'clinical') return 'visual-focus';
  if (slide.visual?.type === 'stats' && (slide.content?.length ?? 0) <= 2) return 'full-visual';
  if (slide.visual) return 'split';
  return 'split';
}

function normalizeSlide(raw: Partial<Slide>, planTitle: string, index: number, total: number): Slide {
  const title = (raw.title || planTitle).trim();
  const content = (Array.isArray(raw.content) ? raw.content : [])
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, index === 0 ? 2 : 4);

  const slideKind: SlideKind =
    raw.slideKind ||
    (index === 0 ? 'title' : index === total - 1 ? 'summary' : index === total - 2 ? 'hook' : 'content');

  const slide: Slide = {
    title,
    subtitle: raw.subtitle?.trim(),
    content:
      content.length > 0
        ? content
        : index === 0
          ? ['Klinik ta\'lim dasturi', 'FJSTI — iMentor']
          : ['Asosiy g\'oya', 'Klinik ahamiyat', 'Amaliy qadam'],
    slideKind,
    keyTakeaway: raw.keyTakeaway?.trim(),
    notes:
      raw.notes?.trim() ||
      `${title}: 60–90 soniya izoh; klinik misol, raqam yoki diagramma ustida to'xtaling.`,
    visual: undefined,
    imagePrompt: raw.imagePrompt?.trim(),
    imageUrl: undefined,
    mermaid: raw.mermaid?.trim(),
  };

  slide.visual = normalizeVisual(raw.visual, slide, index);
  slide.layout = assignLayout(slide, index);
  if (!slide.imagePrompt) {
    slide.imagePrompt = `Medical education infographic, ${slide.visual.type}, topic: ${title}, clean vector, professional`;
  }
  return slide;
}

export function migrateLegacySlide(slide: Slide, index: number, total = 1): Slide {
  return normalizeSlide(slide, slide.title || `Slayd ${index + 1}`, index, total);
}

export function enrichPresentationDeck(slides: Slide[], topic: string): Slide[] {
  const total = slides.length;
  return slides.map((s, i) => {
    const plan = buildPedagogicSlidePlan(topic, total);
    return normalizeSlide(s, plan[i] || s.title, i, total);
  });
}

export function looksLikeWeakDeck(slides: Slide[], expected: number): boolean {
  if (!Array.isArray(slides) || slides.length < Math.max(6, Math.floor(expected * 0.65))) return true;
  const withVisual = slides.filter((s) => s.visual?.type).length;
  const withTitles = slides.filter((s) => (s.title || '').length >= 4).length;
  return withVisual < Math.max(5, expected - 3) || withTitles < Math.max(5, expected - 2);
}

async function extractTextFromPdfBase64(pdfBase64: string): Promise<string> {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const line = content.items.map((it) => ('str' in it ? String(it.str) : '')).join(' ');
    pageTexts.push(line);
  }
  return pageTexts.join('\n');
}

export async function generateMedicalPresentation(
  topic: string,
  description: string = '',
  count: number = 12,
  language: AppLanguage = 'uz',
  onPhase?: (phase: PresentationPhase) => void,
): Promise<Slide[]> {
  const safeCount = Math.min(24, Math.max(8, count));
  const raw = await generatePresentationViaOpenAI({
    topic,
    context: description,
    slideCount: safeCount,
    language,
    onPhase,
  });
  if (!Array.isArray(raw) || raw.length < 4) {
    throw new Error('AI taqdimot strukturasini qaytarmadi');
  }
  return enrichPresentationDeck(raw.slice(0, safeCount), topic);
}

export async function generateMedicalPresentationFromFile(
  file: File,
  topicHint: string,
  language: AppLanguage = 'uz',
  onPhase?: (phase: PresentationPhase) => void,
): Promise<Slide[]> {
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const payload = (reader.result as string)?.split(',')[1];
      if (!payload) reject(new Error('Unable to read file'));
      else resolve(payload);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  let pdfText = '';
  try {
    pdfText = await extractTextFromPdfBase64(base64Data);
  } catch {
    pdfText = '';
  }

  const topic = topicHint || file.name.replace(/\.[^.]+$/, '').trim() || 'Taqdimot';
  const raw = await generatePresentationFromTextViaOpenAI({
    topic,
    sourceText:
      pdfText.trim().length > 80
        ? pdfText.slice(0, 100_000)
        : `PDF: ${file.name}. Mavzu: ${topic}. Kontekst bo'yicha professional tibbiy taqdimot yarating.`,
    slideCount: 14,
    language,
    onPhase,
  });

  const targetCount = Math.min(16, Math.max(8, raw.length || 12));
  return enrichPresentationDeck(raw.slice(0, targetCount), topic);
}
