import { type AppLanguage, inferPdfLanguage } from '../i18n/language';
import { translate } from '../i18n/translations';
import {
  extractTopicsByRegex,
  guessSubjectFromDocumentText,
  isWeakSyllabusExtraction,
  normalizeSyllabusTopics,
  scoreSyllabusTopics,
} from '../utils/syllabusTopicParse';
import {
  extractSyllabusDocumentText,
  stripSyllabusFileExtension,
} from '../utils/syllabusDocumentText';
import { parseAiJson } from '../utils/parseAiJson';
import {
  DEEPSEEK_CHAT,
  DEEPSEEK_FAST,
  assertDeepseekApiKey,
  deepseekJson,
  deepseekText,
} from './deepseekClient';

const SYS_MEDICAL =
  'Siz FJSTI tibbiyot professori va klinik ta\'lim metodistisiz. Javoblar ilmiy, aniq, darsga tayyor.';

import {
  buildAvoidRepeatsBlock,
  buildCaseStructurePrompt,
  buildCaseKeywordsFocusPrompt,
  buildTestVarietyPrompt,
  GENERATION_UNIQUENESS_RULE,
  summarizeCaseForAvoid,
  summarizeTestForAvoid,
} from '../utils/generationVariety';
import { listPreparedForTopic, loadPreparedById } from '../utils/preparedContentStore';
import { normalizeCaseFocus } from '../utils/caseFocusLabels';
import {
  LECTURE_REFERENCES_AI_RULES,
  MEDICAL_REFERENCES_AI_RULES,
  mergeReferences,
  normalizeMedicalReferences,
  type MedicalReference,
} from '../utils/medicalReferences';

function previousCaseAvoidBlock(topic: string): string {
  const summaries = listPreparedForTopic('case', topic)
    .slice(0, 6)
    .map((v) => loadPreparedById<CaseStudySession>('case', v.id))
    .filter((s): s is CaseStudySession => Boolean(s?.questions?.length))
    .map(summarizeCaseForAvoid);
  return buildAvoidRepeatsBlock(summaries);
}

function previousTestAvoidBlock(topic: string): string {
  const summaries = listPreparedForTopic('test', topic)
    .slice(0, 6)
    .map((v) => loadPreparedById<TestSession>('test', v.id))
    .filter((s): s is TestSession => Boolean(s?.questions?.length))
    .map(summarizeTestForAvoid);
  return buildAvoidRepeatsBlock(summaries);
}

export type { MedicalReference };

export interface CaseStudyQuestion {
  scenario: string;
  answer: string;
  focus?: 'profilaktika' | 'davolash' | 'tashxis';
  options?: string[];
  correctOptionIndex?: number;
  explanation?: string;
  references?: MedicalReference[];
}

export interface CaseStudySession {
  topic: string;
  questions: CaseStudyQuestion[];
  references?: MedicalReference[];
  keywords?: string[];
}

export interface TestQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  references?: MedicalReference[];
}

export interface TestSession {
  id?: string;
  topic: string;
  questions: TestQuestion[];
  references?: MedicalReference[];
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
  /** Fan katalogi identifikatori (mavzu konteksti) */
  syllabusId?: number;
  subjectName?: string;
  variantLabel?: string;
}

export interface SyllabusExtractResult {
  subject_name: string;
  topics: SyllabusTopic[];
  instruction_language: AppLanguage;
}

function languageName(lang: AppLanguage): string {
  if (lang === 'ru') return 'Russian';
  if (lang === 'en') return 'English';
  return 'Uzbek';
}

const SYLLABUS_AI_JSON_HINT =
  '{"subject_name":"...","instruction_language":"uz|en|ru","topics":[{"id":"L1","title":"...","type":"lecture|practical"}]}';

const SYLLABUS_NO_TRANSLATE_RULE =
  'CRITICAL: subject_name and every topic title MUST stay in the original document language. NEVER translate.';

const SYLLABUS_AI_SYSTEM =
  'You are an academic syllabus parser for university medical courses. Return JSON only. ' +
  `Schema: ${SYLLABUS_AI_JSON_HINT}. ` +
  'Rules: subject_name = ONE course/discipline (fan), NOT university or faculty name. ' +
  'Each topic = one numbered syllabus line (mavzu) in document order. ' +
  'Topic ids: L or M + number for lectures (ma\'ruza/лекция), A or P + number for practicals (amaliy/практика). ' +
  'Include ALL topics; do not skip or merge. If only lectures OR only practicals exist, do NOT invent the other type. ' +
  SYLLABUS_NO_TRANSLATE_RULE;

function pickBetterExtract(a: SyllabusExtractResult, b: SyllabusExtractResult): SyllabusExtractResult {
  const scoreA = scoreSyllabusTopics(a.topics);
  const scoreB = scoreSyllabusTopics(b.topics);
  if (scoreB > scoreA) return b;
  if (scoreA > scoreB) return a;
  if (b.subject_name.length > a.subject_name.length) return b;
  return a;
}

async function extractSyllabusWithAi(
  file: File,
  docText: string,
): Promise<SyllabusExtractResult> {
  const docLang = inferPdfLanguage(docText);
  const docLangName = languageName(docLang);
  let best: SyllabusExtractResult = { subject_name: '', topics: [], instruction_language: docLang };

  try {
    const textRaw = await deepseekJson({
      model: DEEPSEEK_CHAT,
      system: SYLLABUS_AI_SYSTEM,
      user:
        `Document language: ${docLangName}. File: "${file.name}". ${SYLLABUS_NO_TRANSLATE_RULE}\n\n` +
        docText.slice(0, 100000),
      maxTokens: 6144,
      parse: (t) => parseJSONSafe<Partial<SyllabusExtractResult>>(t),
    });
    best = normalizeSyllabusExtract(textRaw, file.name, docText);
  } catch (firstAiError) {
    console.warn('Syllabus AI text pass failed:', firstAiError);
  }

  if (isWeakSyllabusExtraction(best.topics)) {
    try {
      const retryRaw = await deepseekJson({
        model: DEEPSEEK_FAST,
        system:
          SYLLABUS_AI_SYSTEM +
          ' List every numbered topic line from the syllabus table of contents or topic list.',
        user:
          `Document language: ${docLangName}. Extract ALL topics with correct lecture/practical type.\n\n` +
          docText.slice(0, 100000),
        maxTokens: 6144,
        parse: (t) => parseJSONSafe<Partial<SyllabusExtractResult>>(t),
      });
      best = pickBetterExtract(best, normalizeSyllabusExtract(retryRaw, file.name, docText));
    } catch (retryError) {
      console.warn('Syllabus AI retry failed:', retryError);
    }
  }

  const regexPass = extractTopicsByRegex(docText);
  if (regexPass.length > 0) {
    const regexResult = normalizeSyllabusExtract({ topics: regexPass }, file.name, docText);
    best = pickBetterExtract(best, regexResult);
  }

  if (best.topics.length > 0) {
    return best;
  }

  throw new Error('syllabus-extract-failed');
}

function inferSyllabusInstructionLanguage(
  result: Pick<SyllabusExtractResult, 'subject_name' | 'topics'>,
  pdfText: string,
  explicit?: string,
): AppLanguage {
  const raw = (explicit || '').trim().toLowerCase();
  if (raw === 'uz' || raw === 'en' || raw === 'ru') return raw;
  const blob = [pdfText, result.subject_name, ...result.topics.map((t) => t.title)].filter(Boolean).join('\n');
  return inferPdfLanguage(blob);
}

function finalizeSyllabusExtract(
  result: Omit<SyllabusExtractResult, 'instruction_language'>,
  pdfText: string,
  explicitLang?: string,
): SyllabusExtractResult {
  return {
    ...result,
    instruction_language: inferSyllabusInstructionLanguage(result, pdfText, explicitLang),
  };
}

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
    subject_name = guessSubjectFromDocumentText(pdfText);
  }
  if (!subject_name) {
    subject_name = stripSyllabusFileExtension(fileName).replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  const base = {
    subject_name: subject_name.slice(0, 255) || 'Fan',
    topics,
  };
  const explicitLang =
    data && !Array.isArray(data) && typeof data === 'object' ? data.instruction_language : undefined;
  return finalizeSyllabusExtract(base, pdfText, explicitLang);
}

function syllabusExtractionErrorMessage(err: unknown, fileName: string, lang: AppLanguage = 'uz'): string {
  const msg = err instanceof Error ? err.message : String(err || '');
  if (msg === 'empty-document') {
    return translate(lang, 'ai.error.syllabusEmpty', { fileName });
  }
  if (msg === 'doc-empty') {
    return translate(lang, 'ai.error.syllabusDocEmpty', { fileName });
  }
  if (msg === 'unsupported-format') {
    return translate(lang, 'ai.error.syllabusUnsupported', { fileName });
  }
  if (msg.startsWith('empty:')) {
    return translate(lang, 'ai.error.syllabusNoTopics', { fileName });
  }
  if (/api|key|401|403/i.test(msg)) {
    return translate(lang, 'ai.error.openai');
  }
  return translate(lang, 'ai.error.syllabusParseFailed', { fileName });
}

export { syllabusExtractionErrorMessage };

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
      const refs = normalizeMedicalReferences(q.references, topic);
      const focus = normalizeCaseFocus((q as CaseStudyQuestion).focus, i);
      return {
        scenario: scenario.length >= 120 ? scenario : fallbackScenario,
        answer: answer.length >= 120 ? answer : fallbackAnswer,
        focus,
        ...(refs.length ? { references: refs } : {}),
      };
    });
  const sessionRefs = normalizeMedicalReferences(data.references, topic);
  const allQRefs = cleanedQuestions.flatMap((q) => q.references || []);
  return {
    topic: (data.topic || topic || '').trim() || topic,
    questions: cleanedQuestions,
    references: mergeReferences(sessionRefs, allQRefs),
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
      const refs = normalizeMedicalReferences(q.references, topic);
      return {
        question: (q.question || '').trim(),
        options: options.map((o) => (o || '').trim()),
        explanation: (q.explanation || '').trim(),
        correctOptionIndex,
        ...(refs.length ? { references: refs } : {}),
      };
    });
  const sessionRefs = normalizeMedicalReferences(data.references, topic);
  const allQRefs = questions.flatMap((q) => q.references || []);
  return {
    ...data,
    topic: (data.topic || topic || '').trim() || topic,
    questions,
    references: mergeReferences(sessionRefs, allQRefs),
  };
}

export const aiService = {
  async extractSyllabusFromDocument(file: File): Promise<SyllabusExtractResult> {
    try {
      const docText = await extractSyllabusDocumentText(file);
      if (!docText.trim()) {
        throw new Error('empty-document');
      }
      return await extractSyllabusWithAi(file, docText);
    } catch (error) {
      console.error('Syllabus extraction failed:', error);
      throw error;
    }
  },

  /** @deprecated use extractSyllabusFromDocument */
  async extractSyllabusFromPdf(file: File): Promise<SyllabusExtractResult> {
    return aiService.extractSyllabusFromDocument(file);
  },

  async extractSyllabusTopics(file: File): Promise<SyllabusTopic[]> {
    const result = await aiService.extractSyllabusFromDocument(file);
    return result.topics;
  },

  async generateCaseStudy(
    topic: string,
    language: AppLanguage = 'uz',
    keywords: string[] = []
  ): Promise<CaseStudySession> {
    try {
      assertDeepseekApiKey();
      const outLang = languageName(language);
      const avoid = previousCaseAvoidBlock(topic);
      const keywordFocus = buildCaseKeywordsFocusPrompt(keywords);
      const requestCases = async (strict: boolean): Promise<CaseStudySession> => {
        const structure = buildCaseStructurePrompt(topic);
        return deepseekJson({
          model: DEEPSEEK_CHAT,
          system: `${SYS_MEDICAL} ${GENERATION_UNIQUENESS_RULE} 3 ta klinik case JSON: {topic, references:[...], questions:[{focus:"profilaktika"|"davolash"|"tashxis", scenario, answer, references:[...]}]}. Aynan 3 ta: 1-profilaktika, 2-davolash, 3-tashxis. Til: ${outLang}. ${MEDICAL_REFERENCES_AI_RULES}`,
          user: `${structure}${keywordFocus}${avoid}\n\nHar scenario 3-5 paragraf. Har answer fokusga mos: profilaktika keysida profilaktik choralar, davolash keysida davolash rejasi, tashxis keysida differensial tashxis va asoslash. Javob oxirida [1][2] iqtiboslar. ${strict ? 'Maksimal sifat, faqat valid JSON.' : ''}`,
          maxTokens: 8192,
          temperature: strict ? 0.48 : 0.72,
          parse: (t) => parseJSONSafe<CaseStudySession>(t),
        });
      };

      let data: CaseStudySession;
      try {
        data = await requestCases(false);
      } catch {
        data = await requestCases(true);
      }
      if (isWeakCaseSession(data)) {
        data = await requestCases(true);
      }
      const normalized = normalizeCaseSession(topic, data);
      return keywords.length ? { ...normalized, keywords } : normalized;
    } catch (error) {
      console.error("Case study generation failed:", error);
      throw error;
    }
  },

  async generateTests(topic: string, count: number = 10, language: AppLanguage = 'uz'): Promise<TestSession> {
    assertDeepseekApiKey();
    const outLang = languageName(language);
    const avoid = previousTestAvoidBlock(topic);
    const generate = async (requestedCount: number, shortMode: boolean, strict: boolean): Promise<TestSession> => {
      const variety = buildTestVarietyPrompt(topic, requestedCount);
      const parsed = await deepseekJson({
        model: DEEPSEEK_CHAT,
        system: `${SYS_MEDICAL} ${GENERATION_UNIQUENESS_RULE} ${requestedCount} ta test JSON: {topic, references:[{title,authors,year,publisher,url}], questions:[{question, options[5], correctOptionIndex, explanation, references:[...]}]}. Til: ${outLang}. ${MEDICAL_REFERENCES_AI_RULES}`,
        user: `${variety}${avoid}\n\n${requestedCount} ta NOYOB savol. Klinik vignette 3-6 gap, 5 ta teng variant, kuchli distraktorlar. explanation ${shortMode ? '2-3' : '3-5'} gap — oxirida [1][2] iqtiboslar. ${strict ? 'Faqat valid JSON.' : ''}`,
        maxTokens: 4096,
        temperature: strict ? 0.42 : 0.68,
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
        system: `${SYS_MEDICAL} Ma'ruza faqat Markdown. Kirish, 3-4 bo'lim, klinik qo'llash, xulosa. Matn ichida muhim faktlar yonida [manba](url) havolalari. ${LECTURE_REFERENCES_AI_RULES} Til: ${outLang}.`,
        user: `Mavzu: "${topic}". Qo'shimcha: ${description || '—'}. Batafsil ma'ruza matni. Har bo'limda ilmiy dalillar va havolalar bo'lsin.`,
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
