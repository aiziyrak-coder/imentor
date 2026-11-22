import type { ContentSlide } from './presentationContentSchema';
import type { AppLanguage } from '../i18n/language';
import { anyUzbekLeftover, outputLanguageLooksWrong } from './outputLanguage';
function textValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(textValues);
  return [];
}
/** JSON keys and English image queries are not visible teaching text. */
export function slideLanguageWrong(slide: ContentSlide, language: AppLanguage): boolean {
  const visible = [slide.title, slide.subtitle || '', ...textValues(slide.body), slide.speaker_notes || ''];
  // Butun slayd to'g'ri tilda bo'lsa ham bitta punkt o'zbekcha qolishi mumkin (2026-10-21).
  return outputLanguageLooksWrong(visible.join(' '), language) || anyUzbekLeftover(visible, language);
}
