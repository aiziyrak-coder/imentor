/**
 * Test savolidagi qisqartmalarning to'liq nomi qavsda (2026-10-21).
 *
 * Talab: "qisqartmalar yozganda qavs ichida kengaytmasini ham berib ketsin".
 * Model buni promptda so'ralsa ham har doim bajarmaydi, shuning uchun eng ko'p
 * uchraydiganlari KOD bilan, AI'siz to'ldiriladi: savol matnida va izohda
 * qisqartma BIRINCHI kelgan joyda, agar to'liq nomi yonida hali bo'lmasa.
 * Variantlarga tegilmaydi — to'g'ri variant uzayib, "eng uzun javob" bo'lib
 * qolmasin (talaba shundan topib olardi).
 */
import type { AppLanguage } from '../i18n/language';

type Entry = { abbr: string; full: string; /** Faqat ortidan raqam kelsa (AB 120/80). */ beforeNumber?: boolean };

const UZ: Entry[] = [
  { abbr: 'EKG', full: 'elektrokardiografiya' },
  { abbr: 'ExoKG', full: 'exokardiografiya' },
  { abbr: 'EhoKG', full: 'exokardiografiya' },
  { abbr: 'EEG', full: 'elektroensefalografiya' },
  { abbr: 'UTT', full: 'ultratovush tekshiruvi' },
  { abbr: 'UZI', full: 'ultratovush tekshiruvi' },
  { abbr: 'MRT', full: 'magnit-rezonans tomografiya' },
  { abbr: 'KT', full: 'kompyuter tomografiya' },
  { abbr: 'AQB', full: 'arterial qon bosimi' },
  { abbr: 'AB', full: 'arterial bosim', beforeNumber: true },
  { abbr: 'YuUS', full: 'yurak urishlari soni' },
  { abbr: 'YuQS', full: 'yurak qisqarishlari soni' },
  { abbr: 'NOS', full: 'nafas olish soni' },
  { abbr: 'SpO2', full: 'qonning kislorod bilan to‘yinishi' },
  { abbr: 'UQT', full: 'umumiy qon tahlili' },
  { abbr: 'EChT', full: 'eritrotsitlar cho‘kish tezligi' },
  { abbr: 'ECHT', full: 'eritrotsitlar cho‘kish tezligi' },
  { abbr: 'ALT', full: 'alaninaminotransferaza' },
  { abbr: 'AST', full: 'aspartataminotransferaza' },
  { abbr: 'HbA1c', full: 'glikozillangan gemoglobin' },
  { abbr: 'CRP', full: 'C-reaktiv oqsil' },
  { abbr: 'SRO', full: 'S-reaktiv oqsil' },
  { abbr: 'PZR', full: 'polimeraza zanjirli reaksiya' },
  { abbr: 'PCR', full: 'polimeraza zanjirli reaksiya' },
  { abbr: 'OIV', full: 'odam immunitet tanqisligi virusi' },
  { abbr: 'OITS', full: 'orttirilgan immunitet tanqisligi sindromi' },
  { abbr: 'MNS', full: 'markaziy nerv sistemasi' },
  { abbr: 'YuIK', full: 'yurak ishemik kasalligi' },
  { abbr: 'SYuE', full: 'surunkali yurak yetishmovchiligi' },
  { abbr: 'KFT', full: 'koptokchalar filtratsiyasi tezligi' },
  { abbr: 'TTG', full: 'tireotrop gormon' },
  { abbr: 'IFA', full: 'immunoferment tahlil' },
  { abbr: 'NYaQV', full: 'nosteroid yallig‘lanishga qarshi vositalar' },
  { abbr: 'XNM', full: 'xalqaro normallashtirilgan munosabat' },
  { abbr: 'INR', full: 'xalqaro normallashtirilgan munosabat' },
  { abbr: 'LDL', full: 'past zichlikdagi lipoproteinlar' },
  { abbr: 'HDL', full: 'yuqori zichlikdagi lipoproteinlar' },
];

const RU: Entry[] = [
  { abbr: 'ЭКГ', full: 'электрокардиография' },
  { abbr: 'ЭхоКГ', full: 'эхокардиография' },
  { abbr: 'ЭЭГ', full: 'электроэнцефалография' },
  { abbr: 'УЗИ', full: 'ультразвуковое исследование' },
  { abbr: 'МРТ', full: 'магнитно-резонансная томография' },
  { abbr: 'КТ', full: 'компьютерная томография' },
  { abbr: 'АД', full: 'артериальное давление', beforeNumber: true },
  { abbr: 'ЧСС', full: 'частота сердечных сокращений' },
  { abbr: 'ЧДД', full: 'частота дыхательных движений' },
  { abbr: 'SpO2', full: 'насыщение крови кислородом' },
  { abbr: 'ОАК', full: 'общий анализ крови' },
  { abbr: 'СОЭ', full: 'скорость оседания эритроцитов' },
  { abbr: 'АЛТ', full: 'аланинаминотрансфераза' },
  { abbr: 'АСТ', full: 'аспартатаминотрансфераза' },
  { abbr: 'HbA1c', full: 'гликированный гемоглобин' },
  { abbr: 'СРБ', full: 'С-реактивный белок' },
  { abbr: 'ПЦР', full: 'полимеразная цепная реакция' },
  { abbr: 'ВИЧ', full: 'вирус иммунодефицита человека' },
  { abbr: 'СПИД', full: 'синдром приобретённого иммунодефицита' },
  { abbr: 'ЦНС', full: 'центральная нервная система' },
  { abbr: 'ИБС', full: 'ишемическая болезнь сердца' },
  { abbr: 'ХСН', full: 'хроническая сердечная недостаточность' },
  { abbr: 'СКФ', full: 'скорость клубочковой фильтрации' },
  { abbr: 'ТТГ', full: 'тиреотропный гормон' },
  { abbr: 'ИФА', full: 'иммуноферментный анализ' },
  { abbr: 'НПВС', full: 'нестероидные противовоспалительные средства' },
  { abbr: 'МНО', full: 'международное нормализованное отношение' },
];

const EN: Entry[] = [
  { abbr: 'ECG', full: 'electrocardiography' },
  { abbr: 'EKG', full: 'electrocardiography' },
  { abbr: 'EEG', full: 'electroencephalography' },
  { abbr: 'MRI', full: 'magnetic resonance imaging' },
  { abbr: 'CT', full: 'computed tomography' },
  { abbr: 'BP', full: 'blood pressure', beforeNumber: true },
  { abbr: 'HR', full: 'heart rate', beforeNumber: true },
  { abbr: 'RR', full: 'respiratory rate', beforeNumber: true },
  { abbr: 'SpO2', full: 'oxygen saturation' },
  { abbr: 'CBC', full: 'complete blood count' },
  { abbr: 'ESR', full: 'erythrocyte sedimentation rate' },
  { abbr: 'ALT', full: 'alanine aminotransferase' },
  { abbr: 'AST', full: 'aspartate aminotransferase' },
  { abbr: 'HbA1c', full: 'glycated hemoglobin' },
  { abbr: 'CRP', full: 'C-reactive protein' },
  { abbr: 'PCR', full: 'polymerase chain reaction' },
  { abbr: 'HIV', full: 'human immunodeficiency virus' },
  { abbr: 'AIDS', full: 'acquired immunodeficiency syndrome' },
  { abbr: 'CNS', full: 'central nervous system' },
  { abbr: 'CHF', full: 'congestive heart failure' },
  { abbr: 'GFR', full: 'glomerular filtration rate' },
  { abbr: 'TSH', full: 'thyroid-stimulating hormone' },
  { abbr: 'ELISA', full: 'enzyme-linked immunosorbent assay' },
  { abbr: 'NSAID', full: 'non-steroidal anti-inflammatory drug' },
  { abbr: 'DIC', full: 'disseminated intravascular coagulation' },
  { abbr: 'INR', full: 'international normalized ratio' },
  { abbr: 'LDL', full: 'low-density lipoprotein' },
  { abbr: 'HDL', full: 'high-density lipoprotein' },
];

const BY_LANG: Record<string, Entry[]> = { uz: UZ, ru: RU, en: EN };

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matndagi har qisqartma BIRINCHI uchragan joyda "QISQARTMA (to'liq nomi)". */
export function expandAbbreviations(text: string, language: AppLanguage | string): string {
  let out = text || '';
  if (!out) return out;
  const lower = () => out.toLowerCase();
  for (const e of BY_LANG[language] ?? []) {
    // To'liq nomi matnda allaqachon bor — qo'shilmaydi.
    if (lower().includes(e.full.toLowerCase())) continue;
    const tail = e.beforeNumber ? '(?=\\s*\\d)' : '(?![\\p{L}\\p{N}])';
    // Allaqachon qavs bilan ochilgan bo'lsa ("EKG (…)") — tegilmaydi.
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(e.abbr)}${tail}(?!\\s*\\()`, 'u');
    const m = re.exec(out);
    if (!m) continue;
    const at = m.index + m[0].length;
    out = `${out.slice(0, at)} (${e.full})${out.slice(at)}`;
  }
  return out;
}

type QuestionLike = { question: string; explanation?: string };

/** Testning har savoli va izohida (variantlarga tegilmaydi). */
export function expandAbbreviationsInQuestions<T extends QuestionLike>(questions: T[], language: AppLanguage | string): T[] {
  return questions.map((q) => ({
    ...q,
    question: expandAbbreviations(q.question, language),
    ...(typeof q.explanation === 'string' ? { explanation: expandAbbreviations(q.explanation, language) } : {}),
  }));
}
