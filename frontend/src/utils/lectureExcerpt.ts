import type { SyllabusTopic } from '../services/aiService';
import type { SyllabusTopicContext } from './syllabusTopicContext';
import { listPreparedForTopicSynced, loadPreparedByIdSynced } from './preparedContentStore';
import { isLectureRefusal } from './lectureBuild';

/** Mavzu bo'yicha oxirgi saqlangan ma'ruza matni (test/keys manbasi). */
export async function loadLatestLectureText(
  topic: SyllabusTopic | SyllabusTopicContext | string,
): Promise<string> {
  try {
    const list = await listPreparedForTopicSynced('lecture', topic, { shared: true });
    // Eng yangi YAROQLI ma'ruza (2026-10-21): AI'ning rad javobi ("parcha yuboring")
    // taqdimot/test/keysga manba bo'lmasin — undan oldingi versiyaga o'tiladi.
    for (const item of list.slice(0, 4)) {
      if (!item?.id) continue;
      const payload = await loadPreparedByIdSynced<{ content?: string } | string>('lecture', item.id);
      if (!payload) continue;
      const text = typeof payload === 'string' ? payload : String(payload.content || '');
      if (isLectureRefusal(text)) continue;
      return text.replace(/\s+/g, ' ').trim();
    }
    return '';
  } catch {
    return '';
  }
}
