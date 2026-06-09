import * as pdfjsLib from 'pdfjs-dist';
import { type AppLanguage, inferPdfLanguage } from '../i18n/language';
import { parseAiJson } from '../utils/parseAiJson';
import {
  DEEPSEEK_CHAT,
  DEEPSEEK_FAST,
  assertDeepseekApiKey,
  deepseekJson,
  deepseekText,
  deepseekWithImage,
  deepseekWithPdf,
} from './deepseekClient';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

const SYS_MEDICAL =
  'Siz FJSTI tibbiyot professori va klinik ta\'lim metodistisiz. Javoblar ilmiy, aniq, darsga tayyor.';

export type { Slide } from './presentationTypes';
export { migrateLegacySlide } from './presentationEngine';
import type { Slide } from './presentationTypes';
import {
  generateMedicalPresentation,
  generateMedicalPresentationFromFile,
} from './presentationEngine';

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
  return parseAiJson<T>(text);
}

export interface SyllabusTopic {
  id: string; // M1/L1/Л1 or A1/P1/П1
  title: string;
  type: 'lecture' | 'practical';
}

export interface SyllabusExtractResult {
  subject_name: string;
  topics: SyllabusTopic[];
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

const SYLLABUS_AI_JSON_HINT =
  '{"subject_name":"Fan nomi PDF dan","topics":[{"id":"M1","title":"...","type":"lecture|practical"}]}';

function normalizeSyllabusExtract(
  data: Partial<SyllabusExtractResult> | SyllabusTopic[] | null | undefined,
  fileName: string,
  pdfText = '',
): SyllabusExtractResult {
  let subject_name = '';
  let rawTopics: SyllabusTopic[] = [];

  if (Array.isArray(data)) {
    rawTopics = data;
  } else if (data && typeof data === 'object') {
    subject_name = String(data.subject_name || '').trim();
    rawTopics = Array.isArray(data.topics) ? data.topics : [];
  }

  const topics = normalizeSyllabusTopics(rawTopics);
  if (!subject_name) {
    subject_name = guessSubjectFromPdfText(pdfText);
  }
  if (!subject_name) {
    subject_name = fileName
      .replace(/\.pdf$/i, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim();
  }

  return {
    subject_name: subject_name.slice(0, 255) || 'Fan',
    topics,
  };
}

function guessSubjectFromPdfText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 50);

  const labelPatterns = [
    /^(?:fan(?:\s+nomi)?|fani|kurs(?:\s+nomi)?|predmet|subject|course|дисциплина|название\s+предмета|наименование\s+дисциплины)[:\s.\-–]+(.+)$/iu,
    /^syllabus[:\s.\-–]+(.+)$/iu,
    /^учебная\s+программа[:\s.\-–]+(.+)$/iu,
  ];

  for (const line of lines) {
    for (const pattern of labelPatterns) {
      const match = line.match(pattern);
      const candidate = match?.[1]?.trim();
      if (candidate && candidate.length > 2 && candidate.length < 180) {
        return candidate;
      }
    }
  }

  for (const line of lines) {
    if (line.length < 4 || line.length > 120) continue;
    if (/^([MALPЛП])\s*[-.):]?\s*\d+/iu.test(line)) continue;
    if (/^(ma'?ruza|lecture|amaliy|practical|лекци|практик)/iu.test(line)) continue;
    return line;
  }

  return '';
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
  async extractSyllabusFromPdf(
    file: File,
    uiLanguage: AppLanguage = 'uz',
  ): Promise<SyllabusExtractResult> {
    let firstPass: SyllabusExtractResult = { subject_name: '', topics: [] };
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
        assertDeepseekApiKey();
        const raw = await deepseekWithPdf({
          model: DEEPSEEK_CHAT,
          system:
            `Syllabus PDF dan fan nomi va mavzular ro'yxatini JSON qilib chiqaring: ${SYLLABUS_AI_JSON_HINT}. ` +
            "subject_name: PDF sarlavhasidagi fan/kurs nomi. topics id: M/L/Л+raqam (ma'ruza), A/P/П+raqam (amaliyot).",
          userText:
            `PDF tahlil. Fan nomi va mavzu sarlavhalari PDF tilida qolsin. Noaniq bo'lsa ${uiLangName}.`,
          pdfBase64: base64Data,
          maxTokens: 4096,
        });
        firstPass = normalizeSyllabusExtract(parseJSONSafe<Partial<SyllabusExtractResult>>(raw), file.name);
        if (!needsSyllabusFallback(firstPass.topics)) {
          return firstPass;
        }
      } catch (firstAiError) {
        console.warn('Syllabus first-pass AI failed, trying fallback:', firstAiError);
      }

      pdfText = await extractPdfText(file);
      const docLang = inferPdfLanguage(pdfText);
      const docLangName = languageName(docLang);
      try {
        const fallbackRaw = await deepseekJson({
          model: DEEPSEEK_FAST,
          system:
            `Syllabus matndan fan nomi va mavzular: ${SYLLABUS_AI_JSON_HINT}. ` +
            'subject_name PDF dagi fan nomi.',
          user: `Til: ${docLangName}. Matn:\n${pdfText.slice(0, 80000)}`,
          maxTokens: 4096,
          parse: (t) => parseJSONSafe<Partial<SyllabusExtractResult>>(t),
        });
        const secondPass = normalizeSyllabusExtract(fallbackRaw, file.name, pdfText);
        if (secondPass.topics.length > firstPass.topics.length) {
          return secondPass;
        }
      } catch (secondAiError) {
        console.warn('Syllabus second-pass AI failed, trying regex-only fallback:', secondAiError);
      }

      const regexPass = extractTopicsByRegex(pdfText);
      if (regexPass.length > 0) {
        return normalizeSyllabusExtract({ topics: regexPass }, file.name, pdfText);
      }
      if (firstPass.topics.length > 0) {
        return normalizeSyllabusExtract(firstPass, file.name, pdfText);
      }
      throw new Error("Syllabusdan fan nomi yoki mavzular ajratib bo'lmadi. Internetni tekshirib, qayta urinib ko'ring.");
    } catch (error) {
      console.error('Syllabus extraction failed:', error);
      throw error;
    }
  },

  async extractSyllabusTopics(file: File, uiLanguage: AppLanguage = 'uz'): Promise<SyllabusTopic[]> {
    const result = await aiService.extractSyllabusFromPdf(file, uiLanguage);
    return result.topics;
  },

  async generatePresentation(topic: string, description: string = '', count: number = 12, language: AppLanguage = 'uz'): Promise<Slide[]> {
    try {
      return await generateMedicalPresentation(topic, description, count, language);
    } catch (error) {
      console.error('Presentation generation failed:', error);
      throw error;
    }
  },

  async generatePresentationFromFile(file: File, language: AppLanguage = 'uz'): Promise<Slide[]> {
    const topicFromFile = file.name.replace(/\.[^.]+$/, '').trim() || 'Taqdimot';
    try {
      return await generateMedicalPresentationFromFile(file, topicFromFile, language);
    } catch (error) {
      console.error('Presentation generation from file failed:', error);
      throw error;
    }
  },

  async generateCaseStudy(topic: string, language: AppLanguage = 'uz'): Promise<CaseStudySession> {
    try {
      assertDeepseekApiKey();
      const outLang = languageName(language);
      const requestCases = async (strict: boolean): Promise<CaseStudySession> =>
        deepseekJson({
          model: DEEPSEEK_CHAT,
          system: `${SYS_MEDICAL} 3 ta klinik case JSON: {topic, questions:[{scenario, answer}]}. Til: ${outLang}.`,
          user: `Mavzu: "${topic}". Har scenario 3-5 paragraf (anamnez, ko'rik, lab). Har answer: differensial, tashxis, davolash. ${strict ? 'Maksimal sifat.' : ''}`,
          maxTokens: 8192,
          temperature: strict ? 0.28 : 0.38,
          parse: (t) => parseJSONSafe<CaseStudySession>(t),
        });

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
    assertDeepseekApiKey();
    const outLang = languageName(language);
    const generate = async (requestedCount: number, shortMode: boolean, strict: boolean): Promise<TestSession> => {
      const parsed = await deepseekJson({
        model: DEEPSEEK_CHAT,
        system: `${SYS_MEDICAL} ${requestedCount} ta test JSON: {topic, questions:[{question, options[5], correctOptionIndex, explanation}]}. Til: ${outLang}.`,
        user: `Mavzu: "${topic}". Klinik vignette 3-6 gap, 5 ta teng variant, kuchli distraktorlar. explanation ${shortMode ? '2-3' : '3-5'} gap. ${strict ? 'Faqat valid JSON.' : ''}`,
        maxTokens: 4096,
        temperature: strict ? 0.3 : 0.4,
        parse: (t) => parseJSONSafe<TestSession>(t),
      });
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
      assertDeepseekApiKey();
      const outLang = languageName(language);
      const content = await deepseekText({
        model: DEEPSEEK_CHAT,
        system: `${SYS_MEDICAL} Ma'ruza faqat Markdown. Kirish, 3-4 bo'lim, klinik qo'llash, xulosa. Til: ${outLang}.`,
        user: `Mavzu: "${topic}". Qo'shimcha: ${description || '—'}. Batafsil ma'ruza matni.`,
        maxTokens: 8192,
        temperature: 0.4,
      });

      return {
        topic: topic,
        content: content || ''
      };
    } catch (error) {
      console.error("Lecture Note generation failed:", error);
      throw error;
    }
  },

  async generateImagePrompt(title: string, content: string[]): Promise<string> {
    try {
      const text = await deepseekText({
        model: DEEPSEEK_FAST,
        system: 'One English image prompt for medical slide. Output prompt only, no quotes.',
        user: `Title: ${title}\nBullets:\n${content.join('\n')}`,
        maxTokens: 200,
        temperature: 0.5,
      });
      return text.trim();
    } catch (error) {
      console.error(error);
      return `Professional medical illustration for: ${title}`;
    }
  },

  async translatePageVisual(imageBase64: string, targetLang: string = 'Uzbek'): Promise<any[]> {
    try {
      assertDeepseekApiKey();
      const raw = await deepseekWithImage({
        model: DEEPSEEK_CHAT,
        system: 'OCR + translate. JSON array: [{"box":[ymin,xmin,ymax,xmax],"text":"..."}] coords 0-1000.',
        userText: `Translate text blocks to ${targetLang}.`,
        imageBase64,
        mimeType: 'image/jpeg',
        maxTokens: 4096,
      });
      return JSON.parse(raw.trim());
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

      return deepseekText({
        model: DEEPSEEK_FAST,
        system: `Professional medical translator. Target: ${targetLang}.${dictInstruction}`,
        user: text,
        maxTokens: 4096,
        temperature: 0.2,
      });
    } catch (error) {
      console.error("Translation failed:", error);
      throw error;
    }
  },

  async generateExercises(topic: string): Promise<Exercise> {
    try {
      return deepseekJson({
        model: DEEPSEEK_CHAT,
        system: `${SYS_MEDICAL} JSON: {title, description, tasks:[{task, type, options?, answer}]}. Til: O'zbek.`,
        user: `Mavzu: "${topic}". Interaktiv mashqlar.`,
        maxTokens: 2048,
        parse: (t) => parseJSONSafe<Exercise>(t),
      });
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
