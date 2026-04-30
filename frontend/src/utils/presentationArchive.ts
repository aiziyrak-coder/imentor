import type { Slide } from '../services/aiService';

const STORAGE_KEY = 'salomatlik-presentation-archive-v1';
const MAX_ENTRIES = 40;

export interface ArchivedPresentation {
  id: string;
  topic: string;
  savedAt: number;
  slides: Slide[];
}

/** Strip huge base64 payloads so localStorage stays under quota; imagePrompt is kept for re-generation. */
function slidesForStorage(slides: Slide[]): Slide[] {
  return slides.map((s) => ({
    ...s,
    imageUrl: s.imageUrl?.startsWith('data:') ? undefined : s.imageUrl,
  }));
}

export function loadPresentationArchive(): ArchivedPresentation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ArchivedPresentation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addPresentationToArchive(topic: string, slides: Slide[]): ArchivedPresentation | null {
  const entry: ArchivedPresentation = {
    id: `arch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    topic: topic.trim() || 'Nomsiz taqdimot',
    savedAt: Date.now(),
    slides: slidesForStorage(slides),
  };
  try {
    const prev = loadPresentationArchive();
    const next = [entry, ...prev].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return entry;
  } catch (e) {
    console.warn('presentationArchive: save failed', e);
    try {
      const stripped = entry.slides.map((s) => ({ ...s, imageUrl: undefined }));
      const next = [{ ...entry, slides: stripped }, ...loadPresentationArchive()].slice(0, MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { ...entry, slides: stripped };
    } catch {
      return null;
    }
  }
}

export function removePresentationFromArchive(id: string): void {
  const next = loadPresentationArchive().filter((e) => e.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
