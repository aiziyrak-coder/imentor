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

function parseJSONSafe<T>(text: string | undefined): T {
  if (!text) throw new Error('Empty response from AI');
  let jsonString = text.trim();
  const match = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) jsonString = match[1];
  try {
    return JSON.parse(jsonString) as T;
  } catch {
    const objStart = jsonString.indexOf('{');
    const arrStart = jsonString.indexOf('[');
    const start =
      objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
    const objEnd = jsonString.lastIndexOf('}');
    const arrEnd = jsonString.lastIndexOf(']');
    const end = Math.max(objEnd, arrEnd);
    if (start >= 0 && end > start) {
      return JSON.parse(jsonString.slice(start, end + 1)) as T;
    }
    throw new Error('Failed to parse JSON response');
  }
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

function normalizeVisual(raw: unknown, slide: Slide, index: number): VisualBlock {
  if (raw && typeof raw === 'object' && 'type' in raw) {
    const v = raw as VisualBlock;
    if (VISUAL_TYPES.includes(v.type)) {
      if (v.type === 'flow' && (!v.steps || v.steps.length < 2)) {
        return buildVisualFromContent(slide, 'flow');
      }
      if (v.type === 'stats' && (!v.stats || v.stats.length < 2)) {
        return buildVisualFromContent(slide, 'stats');
      }
      return v;
    }
  }
  const kind = slide.slideKind;
  const inferred = inferVisualType(slide.title, kind, index);
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

export function migrateLegacySlide(slide: Slide, index: number): Slide {
  if (slide.visual?.type) {
    return { ...slide, layout: slide.layout || assignLayout(slide, index) };
  }
  const s = normalizeSlide(slide, slide.title, index, index + 1);
  return s;
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

export async function generateMedicalPresentation(
  topic: string,
  description: string = '',
  count: number = 12,
  language: AppLanguage = 'uz',
): Promise<Slide[]> {
  assertDeepseekApiKey();
  const outLang = languageName(language);
  const safeCount = Math.min(24, Math.max(8, count));

  const requestDeck = async (strict: boolean): Promise<Slide[]> =>
    deepseekJson({
      model: DEEPSEEK_REASONER,
      system: `${SYS} JSON massiv — har slaydda visual blok bilan.`,
      user: buildGenerationPrompt(topic, description, safeCount, outLang, strict),
      maxTokens: 16384,
      temperature: strict ? 0.28 : 0.38,
      parse: (t) => parseJSONSafe<Slide[]>(t),
    });

  let raw = await requestDeck(false);
  if (looksLikeWeakDeck(raw, safeCount)) {
    raw = await requestDeck(true);
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

  const parsed = parseJSONSafe<Slide[]>(raw);
  const topic = topicHint || file.name.replace(/\.[^.]+$/, '').trim() || 'Taqdimot';
  const targetCount = Math.min(16, Math.max(8, parsed.length || 12));
  const slice = parsed.slice(0, targetCount);
  return enrichPresentationDeck(slice, topic);
}
