/**
 * Tibbiy taqdimot yaratish — AI + post-process (infografika, diagramma, klinik slaydlar).
 */
import { type AppLanguage } from '../i18n/language';
import {
  DEEPSEEK_CHAT,
  DEEPSEEK_REASONER,
  assertDeepseekApiKey,
  deepseekJson,
  deepseekWithPdf,
} from './deepseekClient';
import { parseAiJson } from '../utils/parseAiJson';
import type { Slide, SlideKind, SlideLayout, VisualBlock, VisualBlockType } from './presentationTypes';

const SYS =
  "Siz xalqaro tibbiy konferensiya darajasidagi taqdimot dizayneri va FJSTI professorisiz. " +
  "Har bir slayd zamonaviy infografika, raqamli diagramma yoki klinik karta bilan — oddiy bullet-list emas. " +
  "2020+ yil PowerPoint/Keynote estetikasi: qisqa matn, kuchli vizual, klinik aniqlik.";

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

function languageName(lang: AppLanguage): string {
  if (lang === 'ru') return 'Russian';
  if (lang === 'en') return 'English';
  return 'Uzbek';
}

function parseSlideArray(text: string): Slide[] {
  const parsed = parseAiJson<Slide[]>(text);
  if (!Array.isArray(parsed)) throw new Error('AI javobi massiv emas');
  return parsed;
}

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
          value: ['↑', '↓', '~', '•'][i % 4],
          unit: i === 0 ? '%' : undefined,
        })),
      };
    case 'compare':
      return {
        type: 'compare',
        caption: slide.title,
        left: { title: 'Asosiy', items: bullets.slice(0, 2) },
        right: { title: 'Farqli', items: bullets.slice(2, 4).length ? bullets.slice(2, 4) : ['Alternativa 1', 'Alternativa 2'] },
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
        steps: bullets.slice(0, 5).map((b) => ({ label: b.slice(0, 50), detail: b.length > 50 ? b.slice(50, 120) : undefined })),
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
    const base = normalizeSlide(s, plan[i] || s.title, i, total);
    return base;
  });
}

export function looksLikeWeakDeck(slides: Slide[], expected: number): boolean {
  if (!Array.isArray(slides) || slides.length < Math.max(6, Math.floor(expected * 0.65))) return true;
  const withVisual = slides.filter((s) => s.visual?.type).length;
  const withTitles = slides.filter((s) => (s.title || '').length >= 4).length;
  return withVisual < Math.max(5, expected - 3) || withTitles < Math.max(5, expected - 2);
}

const JSON_SCHEMA_HINT = `
Har bir slayd obyekti:
{
  "title": "string",
  "subtitle": "string (ixtiyoriy)",
  "slideKind": "title|section|content|diagram|clinical|summary|hook",
  "content": ["2-4 qisqa punkt — faqat asosiy matn, uzun paragraf emas"],
  "keyTakeaway": "1 jumla — talaba eslab qolishi kerak",
  "notes": "o'qituvchi uchun 3-5 gap",
  "visual": {
    "type": "flow|stats|compare|pyramid|timeline|cycle|table|icon-grid|clinical",
    "caption": "diagramma sarlavhasi",
    ... type bo'yicha maydonlar:
    flow: "steps": [{"label":"", "detail":""}]
    stats: "stats": [{"label":"","value":"42","unit":"%"}]
    compare: "left": {"title":"","items":[]}, "right": {...}
    pyramid: "levels": [{"label":"","items":[]}]
    timeline: "events": [{"time":"1-hafta","text":""}]
    cycle: "nodes": [{"id":"a","label":""}], "links": [{"from":"a","to":"b"}]
    table: "rows": [["Ustun1","Ustun2"], ["",""]]
    icon-grid: "icons": [{"icon":"🫀","label":"","text":""}]
    clinical: "vignette": {"patient":"","findings":[],"question":""}
  }
}
`;

function buildGenerationPrompt(
  topic: string,
  description: string,
  count: number,
  outLang: string,
  strict: boolean,
): string {
  const plan = buildPedagogicSlidePlan(topic, count);
  return `Mavzu: "${topic}".
Kontekst (ma'ruza / qo'llanma):
${description || '(kontekst berilmagan — mavzu bo\'yicha to\'liq professional taqdimot)'}

Vazifa: Aynan ${count} ta slaydli tibbiy taqdimot JSON massivi.
Til: ${outLang}.

Didaktik reja (har slaydga mos visual tanlang):
${plan.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Qoidalar:
- Har slaydda majburiy "visual" — to'liq to'ldirilgan JSON (steps, stats, vignette va h.k.).
- "content" qisqa (har biri 6–14 so'z), asosiy ma'lumot VISUALda; matn faqat qo'llab-quvvatlovchi.
- Kamida 3 ta "clinical", 3 ta "stats" (haqiqiy raqamlar % yoki n/1000), 2 ta "flow", 1 ta "compare", 1 ta "timeline".
- stats.value — raqamli (masalan "24", "1.2", "85"), unit "%" yoki "ml" bo'lishi mumkin.
- Birinchi slayd: slideKind "title", stats yoki icon-grid.
- Oxirgi slayd: slideKind "summary".
- Talabalar uchun qiziqarli: raqamlar, klinik savol, taqqoslash.
- Suvli matn, "..." va umumiy gaplar taqiqlanadi.
${strict ? '- Yuqori sifat: xalqaro konferensiya darajasidagi tuzilma.' : ''}
${JSON_SCHEMA_HINT}
Faqat JSON massiv qaytaring.`;
}

const JSON_STRICT_SUFFIX = `

MUHIM JSON qoidalari:
- Faqat double-quote (") ishlating; satr ichidagi " belgisini \\" qilib yozing.
- Satr ichida yangi qator bo'lmasin — bitta qator yoki \\n.
- Trailing comma yo'q.
- Faqat JSON massiv, boshqa matn yo'q.`;

async function requestPresentationDeck(
  topic: string,
  description: string,
  safeCount: number,
  outLang: string,
  strict: boolean,
  jsonStrict: boolean,
): Promise<Slide[]> {
  return deepseekJson({
    model: DEEPSEEK_REASONER,
    system: `${SYS} JSON massiv — har slaydda visual blok bilan.`,
    user:
      buildGenerationPrompt(topic, description, safeCount, outLang, strict) +
      (jsonStrict ? JSON_STRICT_SUFFIX : ''),
    maxTokens: 16384,
    temperature: jsonStrict ? 0.22 : strict ? 0.28 : 0.38,
    parse: parseSlideArray,
  });
}

export async function generateMedicalPresentation(
  topic: string,
  description: string = '',
  count: number = 12,
  language: AppLanguage = 'uz',
): Promise<Slide[]> {
  assertDeepseekApiKey();
  const outLang = languageName(language);
  const safeCount = Math.min(24, Math.max(8, count));

  let raw: Slide[];
  try {
    raw = await requestPresentationDeck(topic, description, safeCount, outLang, false, false);
  } catch {
    raw = await requestPresentationDeck(topic, description, safeCount, outLang, true, true);
  }
  if (looksLikeWeakDeck(raw, safeCount)) {
    try {
      raw = await requestPresentationDeck(topic, description, safeCount, outLang, true, false);
    } catch {
      raw = await requestPresentationDeck(topic, description, safeCount, outLang, true, true);
    }
  }
  if (!Array.isArray(raw) || raw.length < 4) {
    throw new Error('AI taqdimot strukturasini qaytarmadi');
  }
  const trimmed = raw.slice(0, safeCount);
  while (trimmed.length < safeCount) {
    trimmed.push({
      title: buildPedagogicSlidePlan(topic, safeCount)[trimmed.length] || `Slayd ${trimmed.length + 1}`,
      content: ['Mavzu davomi'],
      slideKind: 'content',
    });
  }
  return enrichPresentationDeck(trimmed, topic);
}

export async function generateMedicalPresentationFromFile(
  file: File,
  topicHint: string,
  language: AppLanguage = 'uz',
): Promise<Slide[]> {
  assertDeepseekApiKey();
  const outLang = languageName(language);
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

  const raw = await deepseekWithPdf({
    model: DEEPSEEK_CHAT,
    system: `${SYS} Fayldan 10-16 slayd JSON — har birida visual blok. ${JSON_SCHEMA_HINT}`,
    userText: `Fayl asosida tibbiy taqdimot. Mavzu: ${topicHint || file.name}. Til: ${outLang}. Vizual diagrammalar bilan.`,
    pdfBase64: base64Data,
    maxTokens: 16384,
  });

  const parsed = parseSlideArray(raw);
  const topic = topicHint || file.name.replace(/\.[^.]+$/, '').trim() || 'Taqdimot';
  const targetCount = Math.min(16, Math.max(8, parsed.length || 12));
  const slice = parsed.slice(0, targetCount);
  return enrichPresentationDeck(slice, topic);
}
