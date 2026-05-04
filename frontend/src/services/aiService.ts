import { GoogleGenAI, Type } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';
import { type AppLanguage, inferPdfLanguage } from '../i18n/language';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export interface Slide {
  title: string;
  content: string[];
  imagePrompt?: string;
  imageUrl?: string;
  layout?: 'standard' | 'split' | 'title' | 'image-focus';
  notes?: string;
}

export interface CaseStudyQuestion {
  scenario: string;
  answer: string;
  options?: string[];
  correctOptionIndex?: number;
  explanation?: string;
}

export interface CaseStudySession {
  topic: string;
  questions: CaseStudyQuestion[];
}

export interface TestQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
}

export interface TestSession {
  id?: string;
  topic: string;
  questions: TestQuestion[];
  createdAt?: number;
  authorUid?: string;
}

export interface LectureNote {
  id?: string;
  topic: string;
  content: string;
  createdAt?: number;
  authorUid?: string;
}

export interface Exercise {
  title: string;
  description: string;
  tasks: {
    task: string;
    type: 'multiple_choice' | 'true_false' | 'short_answer';
    options?: string[];
    answer: string;
  }[];
}

function parseJSONSafe<T>(text: string | undefined): T {
  if (!text) throw new Error("Empty response from AI");
  
  // Try to extract JSON from markdown code blocks
  let jsonString = text.trim();
  const match = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) {
    jsonString = match[1];
  }

  try {
    return JSON.parse(jsonString) as T;
  } catch (err) {
    // Fallback: attempt to parse the first JSON object/array slice from noisy text.
    const objStart = jsonString.indexOf('{');
    const arrStart = jsonString.indexOf('[');
    const start =
      objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
    const objEnd = jsonString.lastIndexOf('}');
    const arrEnd = jsonString.lastIndexOf(']');
    const end = Math.max(objEnd, arrEnd);
    if (start >= 0 && end > start) {
      try {
        const sliced = jsonString.slice(start, end + 1);
        return JSON.parse(sliced) as T;
      } catch {
        // continue to throw canonical error below
      }
    }
    console.error("JSON Parsing Error. Raw text:", text);
    throw new Error("Failed to parse JSON response");
  }
}

const MAX_BULLET_LEN = 140;
const MAX_TITLE_SLIDE_LINES = 2;

function shortenBullet(s: string, maxLen: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

/**
 * Matnni ixchamlashtiradi: kamroq punkt, qisqa qatorlar — slayd odamlarga “vizual” ko‘rinadi.
 */
function compressSlideCopy(slides: Slide[]): Slide[] {
  return slides.map((slide, i) => {
    const raw = Array.isArray(slide.content) ? slide.content : [];
    if (i === 0 && (slide.layout === 'title' || raw.length <= 2)) {
      const lines = raw.slice(0, MAX_TITLE_SLIDE_LINES).map((c) => shortenBullet(c, 160));
      return { ...slide, content: lines };
    }
    const capped = raw.slice(0, 3).map((c) => shortenBullet(c, MAX_BULLET_LEN));
    return { ...slide, content: capped };
  });
}

/**
 * Model ba'zan hamma slaydga `standard` beradi — vizual joylashuvni majburan taqsimlaymiz:
 * title + asosan split/image-focus (diagramma/infografika uchun joy).
 */
function enrichSlidesWithVisualLayouts(slides: Slide[]): Slide[] {
  return slides.map((slide, i) => {
    return {
      ...slide,
      layout: i === 0 ? 'title' : 'standard',
      imagePrompt: undefined,
      imageUrl: undefined,
    };
  });
}

export interface SyllabusTopic {
  id: string; // M1/L1/Л1 or A1/P1/П1
  title: string;
  type: 'lecture' | 'practical';
}

function languageName(lang: AppLanguage): string {
  if (lang === 'ru') return 'Russian';
  if (lang === 'en') return 'English';
  return 'Uzbek';
}

function normalizeSyllabusTopics(input: SyllabusTopic[]): SyllabusTopic[] {
  const lecturePrefixes = ['M', 'L', 'Л'];
  const practicalPrefixes = ['A', 'P', 'П'];
  const topics = input
    .filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string')
    .map((t) => {
      const id = t.id.toUpperCase().replace(/\s+/g, '');
      const first = id[0] || '';
      const inferredType: 'lecture' | 'practical' =
        lecturePrefixes.includes(first) ? 'lecture' : practicalPrefixes.includes(first) ? 'practical' : t.type;
      return {
        id,
        title: t.title.trim(),
        type: inferredType,
      } as SyllabusTopic;
    })
    .filter((t) => /^([MALPЛП])\d+$/iu.test(t.id) && t.title.length > 2);

  const dedup = new Map<string, SyllabusTopic>();
  for (const t of topics) {
    if (!dedup.has(t.id)) dedup.set(t.id, t);
  }
  const parseOrder = (id: string): [number, number] => {
    const prefix = id[0] || '';
    const num = Number((id.match(/\d+/) || ['0'])[0]);
    const group = ['M', 'L', 'Л'].includes(prefix) ? 0 : 1;
    return [group, Number.isFinite(num) ? num : 0];
  };
  return Array.from(dedup.values()).sort((a, b) => {
    const [ga, na] = parseOrder(a.id);
    const [gb, nb] = parseOrder(b.id);
    if (ga !== gb) return ga - gb;
    if (na !== nb) return na - nb;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

function needsSyllabusFallback(topics: SyllabusTopic[]): boolean {
  if (topics.length < 2) return true;
  const hasLecture = topics.some((t) => t.type === 'lecture');
  const hasPractical = topics.some((t) => t.type === 'practical');
  return !hasLecture || !hasPractical;
}

async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ('str' in it ? String(it.str) : ''))
      .join(' ');
    pageTexts.push(line);
  }
  return pageTexts.join('\n');
}

function extractTopicsByRegex(text: string): SyllabusTopic[] {
  const result: SyllabusTopic[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/\b([MALPЛП])\s*[-.):]?\s*(\d{1,2})\b[\s:.)-]*(.+)$/iu);
    if (!match) continue;
    const prefix = match[1].toUpperCase();
    const num = match[2];
    const title = match[3].trim();
    if (!title || title.length < 3) continue;
    const isLecture = ['M', 'L', 'Л'].includes(prefix);
    result.push({
      id: `${prefix}${num}`,
      title,
      type: isLecture ? 'lecture' : 'practical',
    });
  }
  return normalizeSyllabusTopics(result);
}

function sanitizeImagePrompt(prompt: string, maxLen: number): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.slice(0, maxLen);
}

async function fetchImageAsDataUrl(url: string, timeoutMs: number = 14000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;
    const blob = await res.blob();
    if (!blob || blob.size < 8_000) return null;
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('read-failed'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function buildPedagogicSlidePlan(topic: string, count: number): string[] {
  const core = [
    `Mavzu va dolzarblik: ${topic}`,
    "O'quv maqsadlari va kutilgan natijalar",
    "Asosiy tushunchalar va terminlar",
    "Etiologiya va xavf omillari",
    "Patogenez (bosqichma-bosqich mexanizm)",
    "Klinik belgilar va simptomlar",
    "Diagnostika algoritmi",
    "Laborator / instrumental topilmalar",
    "Differensial diagnostika",
    "Davolash strategiyasi",
    "Klinik case: vaziyat + qaror nuqtalari",
    "Asoratlar va profilaktika",
    "Xulosa va amaliy checklist",
  ];
  if (count <= core.length) return core.slice(0, count);
  const extra = Array.from({ length: count - core.length }, (_, i) => `Qo'shimcha tahlil ${i + 1}`);
  return [...core, ...extra];
}

function looksLikeWeakDeck(slides: Slide[], expected: number): boolean {
  if (!Array.isArray(slides) || slides.length < Math.max(6, Math.floor(expected * 0.7))) return true;
  const filledTitles = slides.filter((s) => (s.title || '').trim().length >= 5).length;
  const withBullets = slides.filter((s) => Array.isArray(s.content) && s.content.length >= 2).length;
  const withImagePrompt = slides.filter((s) => (s.imagePrompt || '').trim().length >= 18).length;
  return filledTitles < Math.max(5, expected - 2) || withBullets < Math.max(5, expected - 2) || withImagePrompt < Math.max(5, expected - 2);
}

function normalizePedagogicSlides(raw: Slide[], topic: string, count: number): Slide[] {
  const plan = buildPedagogicSlidePlan(topic, count);
  const base = [...raw];
  const normalized: Slide[] = [];
  for (let i = 0; i < count; i++) {
    const src = base[i];
    const title = src?.title?.trim() || plan[i];
    const rawContent = Array.isArray(src?.content) ? src.content : [];
    const content = rawContent
      .map((x) => x?.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, i === 0 ? 2 : 3);
    const fallbackBullets =
      i === 0
        ? ["Klinik amaliyot uchun tizimli ko'rib chiqish", "Talabalar bilan qaror qabul qilish ko'nikmasi"]
        : ["Asosiy g'oya", "Klinik amaliy talqin", "Esda qoladigan xulosa"];
    normalized.push({
      title,
      content: content.length > 0 ? content : fallbackBullets,
      notes: src?.notes?.trim() || `${title}: ushbu slaydni 60-90 soniyada izohlang; klinik misol va amaliy qaror nuqtasini ayting.`,
      imagePrompt: undefined,
      imageUrl: undefined,
    });
  }
  return normalized;
}

function isWeakCaseSession(data: CaseStudySession | null | undefined): boolean {
  if (!data || !Array.isArray(data.questions) || data.questions.length < 3) return true;
  const lengths = data.questions.map((q) => ({
    s: (q.scenario || '').trim().length,
    a: (q.answer || '').trim().length,
  }));
  const tooShortCount = lengths.filter((x) => x.s < 550 || x.a < 420).length;
  return tooShortCount >= 1;
}

function normalizeCaseSession(topic: string, data: CaseStudySession): CaseStudySession {
  const cleanedQuestions = (data.questions || [])
    .slice(0, 3)
    .map((q, i) => {
      const scenario = (q.scenario || '').trim();
      const answer = (q.answer || '').trim();
      const fallbackScenario = [
        `Klinik vaziyat ${i + 1}: ${topic} bo'yicha murakkab holat.`,
        "Bemorning asosiy shikoyatlari, anamnezi va xavf omillari batafsil tahlil qilinadi.",
        "Ko'rik topilmalari hamda laborator/instrumental natijalar asosida diagnostik qaror talab etiladi.",
      ].join(' ');
      const fallbackAnswer = [
        "Bosqichma-bosqich yondashuv: (1) birlamchi baholash va xavfni stratifikatsiya qilish;",
        "(2) differensial diagnostikani klinik dalillar bilan toraytirish;",
        "(3) asosiy tashxisni asoslash;",
        "(4) dalillarga asoslangan davolash rejasi va monitoring;",
        "(5) bemor xavfsizligi hamda keyingi kuzatuv rejasi.",
      ].join(' ');
      return {
        scenario: scenario.length >= 120 ? scenario : fallbackScenario,
        answer: answer.length >= 120 ? answer : fallbackAnswer,
      };
    });
  return {
    topic: (data.topic || topic || '').trim() || topic,
    questions: cleanedQuestions,
  };
}

function isWeakTestSession(data: TestSession | null | undefined, requestedCount: number): boolean {
  if (!data || !Array.isArray(data.questions)) return true;
  if (data.questions.length < Math.min(requestedCount, 6)) return true;
  const badQuestions = data.questions.filter((q) => {
    const qLen = (q.question || '').trim().length;
    const expLen = (q.explanation || '').trim().length;
    const opts = Array.isArray(q.options) ? q.options : [];
    const badOptions = opts.length !== 5 || opts.some((o) => (o || '').trim().length < 8);
    return qLen < 120 || expLen < 70 || badOptions;
  });
  return badQuestions.length > Math.max(1, Math.floor(data.questions.length * 0.35));
}

function normalizeTestSession(topic: string, data: TestSession, requestedCount: number): TestSession {
  const questions = (data.questions || [])
    .slice(0, requestedCount)
    .map((q) => {
      const options = (q.options || []).slice(0, 5);
      while (options.length < 5) options.push(`Variant ${options.length + 1}`);
      const correctOptionIndex =
        typeof q.correctOptionIndex === 'number' && q.correctOptionIndex >= 0 && q.correctOptionIndex < 5
          ? q.correctOptionIndex
          : 0;
      return {
        question: (q.question || '').trim(),
        options: options.map((o) => (o || '').trim()),
        explanation: (q.explanation || '').trim(),
        correctOptionIndex,
      };
    });
  return {
    ...data,
    topic: (data.topic || topic || '').trim() || topic,
    questions,
  };
}

export const aiService = {
  async extractSyllabusTopics(file: File, uiLanguage: AppLanguage = 'uz'): Promise<SyllabusTopic[]> {
    let firstPass: SyllabusTopic[] = [];
    let pdfText = '';
    const uiLangName = languageName(uiLanguage);

    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const payload = (reader.result as string)?.split(',')[1];
          if (!payload) reject(new Error('Unable to read PDF base64'));
          else resolve(payload);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.1-pro-preview",
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    data: base64Data,
                    mimeType: file.type
                  }
                },
                { text: `Analyze this syllabus PDF and extract lecture/practical topic list.
Return only JSON.
Keep each topic title in the SAME language as the source PDF text.
Allowed id prefixes: M/L/Л for lecture and A/P/П for practical, preserving the document style when possible.
If language is ambiguous, default to ${uiLangName}.` }
              ]
            }
          ],
          config: {
            responseMimeType: "application/json",
            maxOutputTokens: 8000,
            systemInstruction: "You are an expert syllabus parser. Return JSON list only: [{ 'id': 'M1/L1/Л1 or A1/P1/П1', 'title': 'Topic title', 'type': 'lecture' | 'practical' }]. Keep title language equal to source PDF language.",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ["lecture", "practical"] }
                },
                required: ["id", "title", "type"]
              }
            }
          }
        });
        firstPass = normalizeSyllabusTopics(parseJSONSafe<SyllabusTopic[]>(response.text));
        if (!needsSyllabusFallback(firstPass)) {
          return firstPass;
        }
      } catch (firstAiError) {
        // Continue to robust fallback path (PDF text + regex) when AI/network fails.
        console.warn("Syllabus first-pass AI failed, trying fallback:", firstAiError);
      }

      pdfText = await extractPdfText(file);
      const docLang = inferPdfLanguage(pdfText);
      const docLangName = languageName(docLang);
      try {
        const fallbackResponse = await ai.models.generateContent({
          model: "gemini-3.1-pro-preview",
          contents: `Extract as many syllabus topics as possible from the text below.
Lecture ids can be M/L/Л and practical ids can be A/P/П.
Keep title language in ${docLangName}. Return only JSON array.

Syllabus matni:
${pdfText.slice(0, 120000)}`,
          config: {
            responseMimeType: "application/json",
            maxOutputTokens: 12000,
            systemInstruction: "You are a strict syllabus parser. Return only detected topics. id format: M/L/Л + number for lecture, A/P/П + number for practical. type must be lecture or practical.",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ["lecture", "practical"] }
                },
                required: ["id", "title", "type"]
              }
            }
          }
        });
        const secondPass = normalizeSyllabusTopics(parseJSONSafe<SyllabusTopic[]>(fallbackResponse.text));
        if (secondPass.length > firstPass.length) return secondPass;
      } catch (secondAiError) {
        console.warn("Syllabus second-pass AI failed, trying regex-only fallback:", secondAiError);
      }

      const regexPass = extractTopicsByRegex(pdfText);
      if (regexPass.length > 0) return regexPass;
      if (firstPass.length > 0) return firstPass;
      throw new Error("Syllabusdan mavzular ajratib bo'lmadi. Internetni tekshirib, qayta urinib ko'ring.");
    } catch (error) {
      console.error("Syllabus extraction failed:", error);
      throw error;
    }
  },

  async generatePresentation(topic: string, description: string = '', count: number = 12, language: AppLanguage = 'uz'): Promise<Slide[]> {
    try {
      const outLang = languageName(language);
      const safeCount = Math.min(30, Math.max(8, count));
      const plan = buildPedagogicSlidePlan(topic, safeCount);
      const buildPrompt = (strict: boolean): string => `Mavzu: "${topic}".
Ma'ruza yoki kontekst matni:
${description || "(matn berilmagan — mavzu bo'yicha Professional taqdimot tuzing)"}

Talablar:
- Jami aynan ${safeCount} ta slayd.
- Quyidagi didaktik ketma-ketlikni yoping:
${plan.map((x, i) => `${i + 1}) ${x}`).join('\n')}
- Har slayd: 2-3 ta qisqa, aniq punkt, maksimal mazmun.
- Har slayd uchun: notes (o'qituvchi uchun 3-5 gaplik tushuntirish).
- Rasm/diagramma/infografika umuman ishlatmang. Faqat matnli, minimalistik, professional lecture slayd bo'lsin.
- Uzun paragraf, umumiy gap, "..." va suvli matn taqiqlanadi.
- Output language must be ${outLang}.
${strict ? "- Sifat juda yuqori bo'lishi shart: intern/rezident darsida ishlatishga tayyor daraja." : ""}`;

      const requestDeck = async (model: string, strict: boolean): Promise<Slide[]> => {
        const response = await ai.models.generateContent({
          model,
          contents: buildPrompt(strict),
          config: {
            responseMimeType: "application/json",
            maxOutputTokens: 32000,
            systemInstruction:
              `Siz klinik professor va tibbiy taqdimot arxitektorisiz. Natija real dars o'tishga tayyor bo'lishi kerak. Har slaydda: title, content (2-3 bullet), notes (teacher script). Minimalistik text-only uslub; rasm, diagramma, infografika yo'q. Output language: ${outLang}. JSON massivdan boshqa narsa qaytarmang.`,
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  content: { type: Type.ARRAY, items: { type: Type.STRING } },
                  notes: { type: Type.STRING },
                },
                required: ["title", "content", "notes"],
              },
            },
          },
        });
        return parseJSONSafe<Slide[]>(response.text);
      };

      let raw = await requestDeck("gemini-3.1-pro-preview", false);
      if (looksLikeWeakDeck(raw, safeCount)) {
        raw = await requestDeck("gemini-3.1-pro-preview", true);
      }
      const normalized = normalizePedagogicSlides(raw, topic, safeCount);
      return compressSlideCopy(enrichSlidesWithVisualLayouts(normalized));
    } catch (error) {
      console.error("Presentation generation failed:", error);
      throw error;
    }
  },

  async generatePresentationFromFile(file: File, language: AppLanguage = 'uz'): Promise<Slide[]> {
    const outLang = languageName(language);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      data: base64Data,
                      mimeType: file.type
                    }
                  },
                  { text: `Fayldan asosiy ma'lumotlarni ajratib oling va taqdimot slaydlariga aylantiring. 8-14 ta slayd.
Birinchi slayd: sarlavha. Qolganlari: har birida 2-3 ta JUDA QISQA punkt (O'zbek tilida).
Har bir slayd uchun 'notes' ham yozing: o'qituvchi nimani gapirishi kerak (3-5 gap).
Rasm/diagramma/infografika ishlatmang. Uzoq matn yozmang — faqat slayd uchun tez o'qiladigan tezislar. Output language: ${outLang}.` }
                ]
              }
            ],
            config: {
              responseMimeType: "application/json",
              maxOutputTokens: 8000,
              systemInstruction:
                `Siz professional taqdimot dizayneri va tibbiyot o'qituvchisisiz. Fayldan ixcham, real darsga tayyor, text-only taqdimot JSON qaytaring. Har slayd: title, content (2-3 bullet), notes (3-5 gaplik teacher script). Output language: ${outLang}.`,
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    content: { type: Type.ARRAY, items: { type: Type.STRING } },
                    notes: { type: Type.STRING },
                  },
                  required: ["title", "content", "notes"],
                },
              },
            }
          });
          const parsed = parseJSONSafe<Slide[]>(response.text);
          const targetCount = Math.min(14, Math.max(8, parsed.length || 10));
          const topicFromFile = file.name.replace(/\.[^.]+$/, '').trim() || 'Taqdimot';
          const normalized = normalizePedagogicSlides(parsed, topicFromFile, targetCount);
          resolve(
            compressSlideCopy(enrichSlidesWithVisualLayouts(normalized))
          );
        } catch (error) {
          console.error("Presentation generation from file failed:", error);
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  async generateCaseStudy(topic: string, language: AppLanguage = 'uz'): Promise<CaseStudySession> {
    try {
      const outLang = languageName(language);
      const requestCases = async (strict: boolean): Promise<CaseStudySession> => {
        const response = await ai.models.generateContent({
          model: "gemini-3.1-pro-preview",
          contents: `Mavzu: "${topic}".
3 ta real klinik, murakkab vaziyatli case yarating (talabalar uchun).
Har bir case quyidagilarni o'z ichiga olsin:
1) scenario: kamida 3-5 paragraf, juda batafsil:
- bemor profili (yosh, jins, asosiy fon kasalliklar),
- chief complaint va HPI (timeline bilan),
- dori tarixi, allergiya, ijtimoiy tarix,
- fizik ko'rik (vital signs bilan),
- laborator/instrumental topilmalar (real qiymatlar bilan, kerak bo'lsa birliklar).
2) answer: o'qituvchi uchun batafsil tahlil:
- ehtimoliy tashxislar (differensiallar, kamida 3 ta),
- asosiy tashxisni dalillar bilan asoslash,
- keyingi diagnostik qadamlar,
- davolash va monitoring rejasi,
- amaliy xatolar va ularning oldini olish.

Variantlar bermang. Test formatga o'tmang. Faqat klinik case va yechim.
Til: ${outLang}.
${strict ? "Sifat talabi juda yuqori: intern/rezident darsida darhol ishlatishga tayyor bo'lsin; umumiy gaplar, qisqa javoblar qat'iyan taqiqlanadi." : ""}`,
          config: {
            responseMimeType: "application/json",
            maxOutputTokens: 32000,
            systemInstruction:
              `Siz professor-darajadagi klinik mentor va case-based learning ekspertsiz. Har bir case real hayotiy bo'lishi shart. Qisqa, umumiy, kitobiy gaplardan qoching. Dalilga asoslangan klinik reasoning yozing. Output language: ${outLang}.`,
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING },
                questions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      scenario: { type: Type.STRING },
                      answer: { type: Type.STRING },
                    },
                    required: ["scenario", "answer"],
                  },
                },
              },
              required: ["topic", "questions"],
            },
          },
        });
        return parseJSONSafe<CaseStudySession>(response.text);
      };

      let data: CaseStudySession;
      try {
        data = await requestCases(false);
      } catch {
        // First attempt might fail when JSON is truncated by token limits or noisy output.
        data = await requestCases(true);
      }
      if (isWeakCaseSession(data)) {
        data = await requestCases(true);
      }
      return normalizeCaseSession(topic, data);
    } catch (error) {
      console.error("Case study generation failed:", error);
      throw error;
    }
  },

  async generateTests(topic: string, count: number = 10, language: AppLanguage = 'uz'): Promise<TestSession> {
    const outLang = languageName(language);
    const generate = async (requestedCount: number, shortMode: boolean, strict: boolean): Promise<TestSession> => {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `Mavzu: "${topic}".
${requestedCount} ta yuqori darajadagi klinik test tuzing.
Har bir savol real klinik vignette bo'lsin (3-6 gap): anamnez, shikoyat, ko'rik, laborator yoki instrumental topilmalar bo'lsin.
Savollar klinik fikrlashni talab qilsin (diagnostika, differensial diagnostika, keyingi qadam, management).
Har savol uchun 5 ta variant yozing.
MUHIM: barcha variantlar uzunligi va uslubi bir-biriga yaqin bo'lsin; to'g'ri javob uzunligi bilan ajralib turmasin.
Distraktorlar aqlli va chalg'ituvchi bo'lsin, lekin ilmiy jihatdan mantiqli bo'lsin.
${strict ? "JSON hech qachon buzilmasin: faqat valid JSON obyekt qaytaring, ortiqcha matn mutlaqo yozmang." : ""}
`,
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 32000,
          systemInstruction: `Siz ekspert klinik o'qituvchisiz. ${requestedCount} ta murakkab, imtihon darajasidagi test tuzing.
Talablar:
1) 'question' qisqa savol emas, balki klinik vaziyatli vignette bo'lsin (3-6 gap).
2) 'options' doimo 5 ta bo'lsin; har bir variant mazmunli va deyarli bir xil uzunlikda bo'lsin.
3) To'g'ri javob matni uzunligi yoki uslubi bilan bilinmasin.
4) Distraktorlar kuchli bo'lsin: klinik amaliyotda uchrashi mumkin bo'lgan xatolarni aks ettirsin.
5) 'explanation' ${shortMode ? "2-3 gap" : "3-5 gap"} bo'lsin, nima uchun to'g'ri va nega qolganlari noto'g'riligini qisqa tahlil qilsin.
6) Til: ${outLang}, terminlar tibbiy standartga mos.
7) JSON valid bo'lishi shart; markdown, izoh, prefiks/suffiks matn yozmang.
Faqat valid JSON qaytaring.`,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              topic: { type: Type.STRING },
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    },
                    correctOptionIndex: { type: Type.INTEGER },
                    explanation: { type: Type.STRING },
                  },
                  required: ["question", "options", "correctOptionIndex", "explanation"]
                }
              }
            },
            required: ["topic", "questions"]
          }
        }
      });
      const parsed = parseJSONSafe<TestSession>(response.text);
      return normalizeTestSession(topic, parsed, requestedCount);
    };

    const generateChunked = async (total: number): Promise<TestSession> => {
      const safeTotal = Math.max(1, total);
      const chunkSize = 4;
      let remaining = safeTotal;
      const merged: TestQuestion[] = [];
      while (remaining > 0) {
        const current = Math.min(chunkSize, remaining);
        const part = await generate(current, true, true);
        merged.push(...(part.questions || []).slice(0, current));
        remaining -= current;
      }
      return normalizeTestSession(topic, { topic, questions: merged }, safeTotal);
    };

    try {
      let data: TestSession;
      try {
        data = await generate(count, false, false);
      } catch {
        data = await generate(Math.min(count, 10), true, true);
      }
      if (isWeakTestSession(data, count)) {
        data = await generate(Math.min(count, 10), true, true);
      }
      if (isWeakTestSession(data, count)) {
        data = await generateChunked(Math.min(count, 12));
      }
      return normalizeTestSession(topic, data, count);
    } catch (error) {
      try {
        return await generateChunked(Math.min(count, 12));
      } catch (fallbackError) {
        console.error("Test generation failed:", fallbackError);
        throw fallbackError;
      }
    }
  },

  async generateLectureNotes(topic: string, description: string = '', language: AppLanguage = 'uz'): Promise<LectureNote> {
    try {
      const outLang = languageName(language);
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `Mavzu: "${topic}".\nQo'shimcha ma'lumot (agar mavjud bo'lsa): ${description}\n\nO'qituvchilar uchun mo'ljallangan oliy ta'lim darajasidagi, tibbiyot sohasiga oid batafsil ma'ruza matnini tayyorlang. Ma'ruza mukammal metodik tuzilishga ega bo'lishi kerak. Strukturada: Kirish (mavzuning dolzarbligi), Asosiy qism (kasallik, mexanizm, etiologiya nazariyalari yoki diagnostik kriteriylar tahlili - kamida 3-4 sohalar), Klinik amaliyotda qo'llanilishi va Xulosa (qisqacha qaytariq). Matnni faqat Markdown (MD) formatida qaytaring, ortiqcha izohlarsiz.`,
        config: {
          maxOutputTokens: 8000,
          systemInstruction: `Siz ekspert tibbiyot professori va metodistsiz. O'qituvchilar darsda to'g'ridan-to'g'ri foydalanishi uchun boy, mukammal va akademik tarzdagi ma'ruza matnlarini Markdown formatida tuzasiz. Iloji boricha batafsil, ilmiy faktlar va oxirgi tibbiy ma'lumotlarga tayaning. Output language: ${outLang}.`
        }
      });
      
      return {
        topic: topic,
        content: response.text || ''
      };
    } catch (error) {
      console.error("Lecture Note generation failed:", error);
      throw error;
    }
  },

  async generateImagePrompt(title: string, content: string[]): Promise<string> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Create one concise English image-generation prompt for a medical lecture slide.
Choose the BEST fit: educational infographic / pathway diagram / anatomical schematic / statistics chart / OR realistic clinical photograph — whichever matches the bullets.

Title: ${title}
Bullets: ${content.join('\n')}

Output ONLY the prompt string (no markdown, no quotes). Prefer clear diagram or infographic wording when the content describes processes, comparisons, or mechanisms.`,
      });
      return response.text.trim();
    } catch (error) {
      console.error(error);
      return `Professional medical illustration for: ${title}`;
    }
  },

  async translatePageVisual(imageBase64: string, targetLang: string = 'Uzbek'): Promise<any[]> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [
          `Analyze the image and identify all distinct readable text blocks (titles, paragraphs, labels, list items, table cells).
          For each text block, provide its bounding box [ymin, xmin, ymax, xmax] using coordinates from 0 to 1000.
          Also, translate the text of that block into ${targetLang}.
          Respond ONLY with a valid JSON array of objects.
          Format: [{"box": [ymin, xmin, ymax, xmax], "text": "Translated text here"}]`,
          {
            inlineData: {
              data: imageBase64,
              mimeType: 'image/jpeg'
            }
          }
        ],
        config: {
          responseMimeType: "application/json",
          temperature: 0.2
        }
      });
      
      const text = response.text.trim();
      return JSON.parse(text);
    } catch (error) {
      console.error("Visual translation failed:", error);
      throw error;
    }
  },

  async translateText(text: string, targetLang: string = 'Uzbek', customDictionary?: Record<string, string>): Promise<string> {
    try {
      let dictInstruction = '';
      if (customDictionary && Object.keys(customDictionary).length > 0) {
        const dictEntries = Object.entries(customDictionary).map(([k, v]) => `- ${k} -> ${v}`).join('\n');
        dictInstruction = `\n\nPlease use the following custom dictionary for terminology:\n${dictEntries}`;
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Translate the following text to ${targetLang}: \n\n${text}`,
        config: {
          systemInstruction: `You are a professional medical translator. Preserve technical accuracy while making it readable in the target language.${dictInstruction}`
        }
      });
      return response.text;
    } catch (error) {
      console.error("Translation failed:", error);
      throw error;
    }
  },

  async generateStartupInnovationPack(
    projectTitle: string,
    summary: string,
    fullDescription: string,
    profileNote: string,
    language: AppLanguage = 'uz'
  ): Promise<Record<string, unknown>> {
    const outLang = languageName(language);
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: `You are a senior innovation analyst, medical-education grant advisor, and early-stage startup mentor for Farg'ona jamoat salomatligi tibbiyot instituti (public health / medical higher education, Uzbekistan).

Inputs:
- Title: ${projectTitle}
- Short summary: ${summary}
- Full description: ${fullDescription}
- Applicant / lab context: ${profileNote}

Task: produce a RICH, structured analysis (not generic filler). If the work is more scientific R&D than a company, weight "research_evidence_block" heavily. If it is a product/startup, weight market and traction. If mixed, set project_archetype to "hybrid" and cover both.

Return ONLY valid JSON (no markdown) with EXACTLY these keys. All human-readable text must be in ${outLang}. Use numbers where specified. Be specific to THIS project, not templates.

{
  "project_archetype": "commercial_startup" | "research_innovation" | "hybrid",
  "archetype_rationale": "string (2-4 jumla)",

  "one_line_positioning": "string (1 qatorlik pitch)",
  "value_proposition": "string (foydalanuvchi va natija)",

  "market_analysis": {
    "serviceable_context": "string (qaysi bozor / segment, O'zbekiston va institut kontekstida)",
    "customer_and_payer_segments": ["string", "..."],
    "market_trends_relevant": ["string", "..."],
    "market_sizing_notes": "string (TAM/SAM/SOM yoki kvalitativ baho — ixtiyoriy, lekin halol)",
    "go_to_market_hooks": ["string", "..."]
  },

  "competitive_landscape": [
    {
      "name_or_category": "string",
      "similarity_score_1_to_5": 1,
      "how_similar_or_different": "string",
      "strategic_takeaway": "string"
    }
  ],

  "differentiation_and_moat": "string",

  "traction_readiness": {
    "estimated_stage": "idea | discovery | prototype | pilot | early_revenue | scale",
    "readiness_score_1_to_100": 50,
    "score_breakdown": ["string (har bir 8-15 so'z)", "..."],
    "strongest_evidence_in_text": ["string", "..."],
    "critical_gaps": ["string", "..."],
    "what_would_raise_readiness_fastest": ["string", "..."]
  },

  "scientific_research_block": {
    "is_research_central": true,
    "research_question": "string yoki matn 'noma'lum' agar startap bo'lsa",
    "hypothesis_or_innovation_claim": "string",
    "evidence_user_already_has": "string",
    "evidence_still_needed": "string",
    "methodology_completeness": "string (laboratoriya, klinik, simulyatsiya, statistika...)",
    "peer_review_comparables": "string (o'xshash ishlar, nima yangi?)",
    "how_to_strengthen_proof": ["string", "..."]
  },

  "fjsti_institutional_fit": "string (institut vazifalari, kafedra, salomatlik/TA bo'yicha moslik)",

  "ethics_clinical_regulatory_note": "string (tibbiy, shaxsiy ma'lumot, klinik sinov, xavfsizlik — qisqa)",

  "team_and_execution": {
    "roles_to_fill": [
      { "role": "string", "why": "string", "suggested_profile": "string" }
    ],
    "advisor_mentor_suggestions": ["string", "..."]
  },

  "milestone_roadmap": {
    "next_30_days": ["string", "..."],
    "next_90_days": ["string", "..."],
    "next_12_months": ["string", "..."],
    "key_milestones": [
      { "title": "string", "success_metric": "string", "dependency_risk": "string" }
    ]
  },

  "grant_and_partnership_fit": {
    "likely_grant_or_program_types": ["string", "..."],
    "evidence_package_to_prepare": ["string", "..."]
  },

  "investor_style_outline": {
    "problem_hook": "string",
    "solution_and_why_now": "string",
    "business_model_sketch": "string",
    "impact_metrics": ["string", "..."],
    "the_ask": "string (nimani so'rash: grant, pilot, laboratoriya vaqt...)"
  },

  "scoring_matrix": [
    { "criterion": "string", "weight_1_to_5": 4, "project_score_1_to_5": 3, "comment": "string" }
  ],

  "risk_register": [
    { "risk": "string", "likelihood_1_to_5": 3, "impact_1_to_5": 4, "mitigation": "string" }
  ],

  "recommended_documents": [
    { "document": "string", "purpose": "string", "must_include_sections": ["string", "..."] }
  ],

  "disclaimer_note": "string (maslahat xarakteri, rasmiy tasdiq emas)"
}

Rules:
- Fill arrays with 3-8 items where relevant (not empty unless truly unknown).
- similarity_score / readiness / likelihood / impact must be integers in range.
- No legal guarantees; no fabricated citations — if unknown, say what data to collect.
- Keep Uzbekistan public-health institute realism.`,
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 16384,
        temperature: 0.42,
      },
    });
    return parseJSONSafe<Record<string, unknown>>(response.text);
  },

  async generateExercises(topic: string): Promise<Exercise> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Generate interactive exercises for students on "${topic}".`,
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 2048,
          systemInstruction: "Create a set of learning tasks. Return JSON with 'title', 'description', and 'tasks'. Tasks should have 'task', 'type' (multiple_choice, true_false, short_answer), 'options' (if applicable), and 'answer'. Language: Uzbek.",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              tasks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    task: { type: Type.STRING },
                    type: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    answer: { type: Type.STRING }
                  }
                }
              }
            }
          }
        }
      });
      return parseJSONSafe<Exercise>(response.text);
    } catch (error) {
      console.error("Exercise generation failed:", error);
      throw error;
    }
  },

  async generateImage(prompt: string): Promise<string | null> {
    try {
      const p = prompt.toLowerCase();
      const isXray =
        p.includes('x-ray') || p.includes('xray') || p.includes('mri') || p.includes('ct scan');
      const isDiagram =
        /diagram|infographic|flowchart|chart|schema|pathway|vector|illustration|graph|anatom|cross-section|histolog|statistic|bar chart|pie chart|timeline|process/.test(
          p
        );
      let suffix: string;
      if (isXray) {
        suffix = ', realistic medical imaging quality, clinical radiology style';
      } else if (isDiagram) {
        suffix =
          ', professional medical infographic and diagram style, clean flat educational illustration, readable shapes and arrows, soft shadows, white or light background, high clarity, minimal overlaid text in image';
      } else {
        suffix =
          ', authentic clinical photograph, highly realistic medical photography, textbook quality, accurate anatomy, no exaggerated gore, natural lighting';
      }
      const maxCore = 300;
      const core = sanitizeImagePrompt(prompt, maxCore);
      const fullPrompt = `${core}${suffix}`;
      const candidates = [
        `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1024&height=576&nologo=true&seed=${Math.floor(Math.random() * 100000)}&model=flux-realism`,
        `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1024&height=576&nologo=true&seed=${Math.floor(Math.random() * 100000)}&model=flux`,
        `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1024&height=576&nologo=true&seed=${Math.floor(Math.random() * 100000)}`,
      ];
      for (const url of candidates) {
        const dataUrl = await fetchImageAsDataUrl(url);
        if (dataUrl) return dataUrl;
      }
      return candidates[0];
    } catch (error) {
      console.error("Image generation failed:", error);
      return null;
    }
  },
};
