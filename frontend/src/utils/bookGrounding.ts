/**
 * Test faqat yuklangan kitob va protokoldan (2026-11-18).
 *
 * Kafedralar: "tizim savolni umumiy manbalardan tuzyapti, atamalar va chuqurlik darslik va dasturimizdan
 * farq qiladi — biz yuklagan kitoblardan yaratsin; qaysi kitob, qaysi betdan olingani chiqmayapti".
 * Server parchalarni raqamlab beradi (P… darslik, K… protokol) va model har savolda tayangan parcha raqamini
 * `source` da qaytaradi. Shu yerda raqam o'sha parchaning kitobi va betiga aylanadi (`references`, `grounded`).
 * Ilgari manba savol yozilgandan KEYIN o'xshash parcha qidiruvi bilan yopishtirilardi — savol o'sha betdan
 * olinganini bildirmasdi. Kitobi bor fanda raqamsiz (yoki ro'yxatda yo'q raqamli) savol testga kirmaydi.
 */
import type { BookFragment } from '../services/openaiClient';
import type { MedicalReference } from './medicalReferences';

type Groundable = { source?: unknown; references?: MedicalReference[]; grounded?: boolean };

export function fragmentReference(f: BookFragment): MedicalReference {
  return {
    title: f.title,
    ...(f.pages ? { pages: f.pages } : {}),
    kind: f.kind === 'protocol' ? 'protocol' : 'book',
  } as MedicalReference;
}

/** Savoldagi `source` dan parcha raqami ("P3", "[K1]", "p 3" → "P3"). */
export function sourceId(raw: unknown): string {
  const m = String(raw ?? '').toUpperCase().match(/([PK])\s*(\d{1,3})/);
  return m ? `${m[1]}${Number(m[2])}` : '';
}

export function groundQuestions<T extends Groundable>(
  questions: T[],
  fragments: BookFragment[],
): { kept: T[]; dropped: number } {
  if (!fragments.length) return { kept: questions, dropped: 0 };
  const byId = new Map(fragments.map((f) => [f.id.toUpperCase(), f]));
  const kept: T[] = [];
  let dropped = 0;
  for (const q of questions) {
    const f = byId.get(sourceId(q.source));
    if (!f) {
      dropped += 1;
      continue;
    }
    const { source: _drop, ...rest } = q;
    kept.push({ ...(rest as T), references: [fragmentReference(f)], grounded: true });
  }
  return { kept, dropped };
}

/**
 * Model qaytargan savollar: parchaga tayanganlari manba bilan. Tayanganlar `minShare` dan kam bo'lsa
 * (mavzu kitobda kam yoritilgan) — manbasizlari ham qoladi (manba ko'rsatilmaydi), aks holda test
 * qayta-qayta yozilib qimmatga tushardi va bo'sh qolishi mumkin edi.
 */
export function groundOrKeep<T extends Groundable>(
  questions: T[],
  fragments: BookFragment[],
  wanted: number,
  minShare = 0.5,
): { questions: T[]; grounded: number; dropped: number } {
  if (!fragments.length) return { questions, grounded: 0, dropped: 0 };
  const { kept, dropped } = groundQuestions(questions, fragments);
  if (kept.length >= Math.ceil(Math.max(1, wanted) * minShare)) return { questions: kept, grounded: kept.length, dropped };
  const byId = new Map(fragments.map((f) => [f.id.toUpperCase(), f]));
  const all = questions.map((q) => {
    const f = byId.get(sourceId(q.source));
    const { source: _drop, ...rest } = q;
    return (f ? { ...(rest as T), references: [fragmentReference(f)], grounded: true } : { ...(rest as T), references: [] }) as T;
  });
  return { questions: all, grounded: kept.length, dropped: 0 };
}
