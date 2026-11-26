/**
 * Patofiziologiya — USMLE uslubidagi keys (2026-11-26, kafedra o'qituvchisining prompti).
 *
 * Ingliz tilidagi (xalqaro, asosan hind) guruhlar USMLE Step 1 ga tayyorlanadi:
 * keys tashxisni emas, MEXANIZMNI o'rgatadi — vinyeta, bitta eng to'g'ri javobli
 * savol (A–E), har variant izohi, patogenez zanjiri, high-yield nuqtalar va
 * muhokama savollari. Mavjud keys JSON kalitlari saqlanadi, mazmuni boshqacha.
 */
import type { AppLanguage } from '../i18n/language';

const PATHOPHYS_RE = /pato\s*fiziolog|patho\s*physiolog|патофизиолог/i;

/** Patofiziologiya fani va ingliz tili — USMLE keys rejimi. */
export function isUsmlePathophysiology(subjectName: string | undefined, language: AppLanguage): boolean {
  return language === 'en' && PATHOPHYS_RE.test(String(subjectName || ''));
}

/** Vaziyat bo'limlari sarlavhalari (CASE_SCENARIO_PARTS tartibida). */
export const USMLE_SCENARIO_TITLES = [
  'Case title',
  'Learning objectives',
  'Clinical vignette',
  '',
  '',
  'Laboratory / imaging results',
  'Question',
];

/** Yechim bo'limlari sarlavhalari (CASE_SECTION_KEYS tartibida). */
export const USMLE_SECTION_TITLES = [
  'Answer and explanation',
  'Why the other options are wrong',
  'Pathogenesis chain',
  'High-yield points',
  'Class discussion questions',
];

const FOCUS_ANGLE: Record<string, string> = {
  tashxis: 'Choose the most classic clinical disease that illustrates the topic.',
  davolash: 'Choose a DIFFERENT disease or setting than the most classic one; the question may target how a drug or compensation changes the mechanism.',
  profilaktika: 'Choose a third, different clinical scenario (e.g., another age group or etiology) that still illustrates the same mechanism.',
};

export const USMLE_SYSTEM =
  'You are an experienced pathophysiology professor and USMLE Step 1 item writer. You create clinical cases for ' +
  'practical classes at a medical institute. Students are 2nd–3rd year international (Indian) medical students ' +
  'preparing for USMLE. The goal is to TEACH MECHANISMS (pathogenesis), not just diagnosis. ' +
  'Accuracy: follow current standard textbooks (Robbins Basic Pathology, Guyton & Hall, First Aid for USMLE Step 1). ' +
  'Do not invent data. Clear, simple academic English for non-native speakers. ' +
  'Return ONLY a valid JSON object with EXACTLY these keys: {"patient","complaints","history","lifestyle",' +
  '"examination","labs","task","diagnosis","differential","investigations","management","recommendations"}. ' +
  'Plain text inside values (no markdown headings); you may bold the decisive finding with **text** (2–6 times in total).';

export function usmleUserPrompt(topic: string, focus: string, extra: string): string {
  return (
    `TOPIC: ${topic}\nDIFFICULTY: Intermediate (two-step reasoning, USMLE Step 1 standard)\n\n` +
    'TASK: Create ONE USMLE-style clinical case with ONE single-best-answer question that precisely matches the TOPIC.\n' +
    '- If the topic is a general pathophysiology process (inflammation, fever, edema, hypoxia, acid-base disorders, shock, ' +
    'cell injury), choose a realistic clinical disease that best illustrates that process.\n' +
    '- If the topic is organ/system pathophysiology (heart failure, renal failure, liver failure, anemia), build the case ' +
    'around that condition.\n' +
    '- Every element of the case must serve the topic. Do not drift into unrelated subjects.\n' +
    `- Scenario angle: ${FOCUS_ANGLE[focus] || FOCUS_ANGLE.tashxis}\n\n` +
    'JSON FIELDS:\n' +
    '"patient" — CASE TITLE: short, does NOT reveal the diagnosis (e.g., "A 58-year-old man with progressive dyspnea").\n' +
    '"complaints" — LEARNING OBJECTIVES: 2–3 numbered objectives starting with action verbs (Explain, Differentiate, Interpret).\n' +
    '"history" — CLINICAL VIGNETTE (USMLE style, 150–250 words): age, sex, setting (ER, clinic, ward); chief complaint and ' +
    'duration; HPI, past history, medications, social history only if relevant; vital signs (T, HR, BP, RR, SpO2); physical ' +
    'examination findings. Never name the diagnosis; avoid buzzword giveaways.\n' +
    '"lifestyle" — "" (empty).\n' +
    '"examination" — "" (empty).\n' +
    '"labs" — LABORATORY / IMAGING results as lines "Test: value (reference range)" in conventional units, SI units in ' +
    'brackets where useful. All values physiologically consistent with each other and with the vignette.\n' +
    '"task" — exactly ONE question testing the KEY PATHOGENETIC MECHANISM ("Which of the following is the most likely ' +
    'mechanism of...", "Which of the following best explains the finding of..."), requiring two-step reasoning (recognize the ' +
    'condition → apply the mechanism). Then exactly 5 options on separate lines "A. ...", "B. ...", "C. ...", "D. ...", "E. ...": ' +
    'same category, similar length, all plausible, only ONE clearly correct, no "all/none of the above".\n' +
    '"diagnosis" — ANSWER AND EXPLANATION: "Correct answer: X." then why it is correct (mechanism-based, 4–6 sentences; ' +
    'include a key formula or calculation if relevant).\n' +
    '"differential" — one line for EACH wrong option ("A. ... — why wrong").\n' +
    '"investigations" — PATHOGENESIS CHAIN with arrows: Etiology → primary damage → mechanism → functional disorder → ' +
    'clinical/lab findings; mark where compensatory mechanisms start and where they fail (decompensation).\n' +
    '"management" — HIGH-YIELD POINTS: 4–6 short lines students must remember for USMLE (classic associations, key numbers).\n' +
    '"recommendations" — CLASS DISCUSSION QUESTIONS: 2–3 open-ended questions ("What would change if...", "Why doesn\'t...", ' +
    '"Compare with..."), then a final line "Alternative case scenarios for this topic: 1) ... 2) ... 3) ...".\n' +
    extra +
    '\nLanguage: English only. Strict valid JSON only.'
  );
}
