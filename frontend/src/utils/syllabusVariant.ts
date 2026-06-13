import type { SyllabusTopic } from '../services/aiService';

export type SyllabusVariant = {
  label: string;
  file_name: string;
  topics: SyllabusTopic[];
};

/** `Falsafa (PI).pdf` → `PI`; yo'q bo'lsa fayl nomi */
export function parseVariantLabel(fileName: string): string {
  const base = fileName.replace(/\.(pdf|docx?)$/i, '').trim();
  const m = base.match(/\(([^)]+)\)\s*$/);
  if (m?.[1]?.trim()) return m[1].trim();
  return base || 'Asosiy';
}

export function resolveSyllabusVariants(row: {
  variants?: SyllabusVariant[];
  file_name?: string;
  topics?: SyllabusTopic[];
}): SyllabusVariant[] {
  if (row.variants?.length) return row.variants;
  if (row.topics?.length) {
    return [
      {
        label: parseVariantLabel(row.file_name || 'syllabus.pdf'),
        file_name: row.file_name || 'syllabus.pdf',
        topics: row.topics,
      },
    ];
  }
  return [];
}

export function totalTopicCount(variants: SyllabusVariant[]): number {
  return variants.reduce((n, v) => n + (v.topics?.length ?? 0), 0);
}
