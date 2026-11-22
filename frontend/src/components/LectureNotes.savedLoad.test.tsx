/**
 * Ma'ruza sahifasi Baza xatolarini "ma'lumot yo'q" deb yashirmaydi (2026-11-17 audit):
 *  1. Ro'yxat yuklanmasa (tarmoq) — keshdagi ma'ruza ekranda QOLADI va keshdan o'chirilmaydi,
 *     xato + "Qayta urinish" chiqadi. (Ilgari bir lahzalik uzilish keshni tozalardi.)
 *  2. Server aniq "yo'q" desa — eski xulq saqlanadi: begona kesh o'chiriladi.
 *  3. Bazadagi versiya ochilmasa — jim emas, xato ko'rsatiladi.
 *  4. Tahrirni saqlashda PATCH tarmoq xatosi bilan yiqilsa — YANGI nusxa yaratilmaydi;
 *     faqat yozuv topilmasa (404/403) yangisi saqlanadi.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppLanguageContext, GlobalTopicContext } from '../test/testContexts';
import type { SyllabusTopicContext } from '../utils/syllabusTopicContext';

vi.mock('../App', async () => {
  const { createContext } = await import('react');
  return {
    ...(await import('../test/testContexts')),
    AppNavigationContext: createContext({ openSyllabus: () => {} }),
    GlobalLectureContext: createContext({ content: '', setContent: () => {} }),
  };
});

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...(props as Record<string, unknown>)}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock('../i18n/useLocalizedTopic', () => ({ useLocalizedTopic: () => null }));

// Kesh — xotirada (o'qituvchiga bog'langan localStorage o'rniga).
const cache = new Map<string, string>();
const writeLecture = vi.fn((key: string, content: string) => {
  if (content) cache.set(key, content);
  else cache.delete(key);
});
vi.mock('../utils/lectureLocalCache', () => ({
  readLectureForTopic: (key: string) => cache.get(key) ?? '',
  writeLectureForTopic: (key: string, content: string) => writeLecture(key, content),
  rememberActiveLectureVersion: vi.fn(),
}));

const listResult = vi.fn();
const loadById = vi.fn();
const patch = vi.fn();
const save = vi.fn();
vi.mock('../utils/preparedContentStore', async (orig) => ({
  ...(await orig<typeof import('../utils/preparedContentStore')>()),
  listPreparedForTopicResult: (...a: unknown[]) => listResult(...a),
  loadPreparedByIdSynced: (...a: unknown[]) => loadById(...a),
  patchPreparedContentPayload: (...a: unknown[]) => patch(...a),
  savePreparedContent: (...a: unknown[]) => save(...a),
  fetchBankItem: vi.fn(async () => null),
  deletePreparedContent: vi.fn(),
}));

const { default: LectureNotes } = await import('./LectureNotes');
const { resolveTopicNorm } = await import('../utils/syllabusTopicContext');

const TOPIC: SyllabusTopicContext = {
  id: 'L1',
  title: 'Gipertoniya kasalligi',
  type: 'lecture' as never,
  syllabusId: 7,
  subjectName: 'Ichki kasalliklar',
  subjectCode: 'ICH-101',
  variantLabel: 'A',
  instructionLanguage: 'uz',
  departmentName: 'Fakultet terapiyasi',
};
const CACHE_KEY = `${resolveTopicNorm(TOPIC)}@uz`;
const CACHED = 'Keshdagi ma’ruza matni: arterial bosim va uning nazorati.';

function row(id: string, topic = TOPIC.title, createdAt = Date.parse('2026-11-17T08:00:00Z')) {
  return { id, topic, topicNorm: resolveTopicNorm(TOPIC), createdAt, source: 'cloud' as const, author: 'Ustoz' };
}

function page() {
  return render(
    <AppLanguageContext.Provider value={{ language: 'uz', setLanguage: () => {} }}>
      <GlobalTopicContext.Provider value={TOPIC}>
        <LectureNotes />
      </GlobalTopicContext.Provider>
    </AppLanguageContext.Provider>,
  );
}

describe('LectureNotes — Baza xatolari', () => {
  beforeEach(() => {
    cache.clear();
    writeLecture.mockClear();
    listResult.mockReset();
    loadById.mockReset();
    patch.mockReset();
    save.mockReset();
    // Kesh o'qituvchi kaliti bilan yoziladi — test uchun kalit doim mavjud.
    cache.set(CACHE_KEY, CACHED);
  });

  it('ro‘yxat yuklanmasa: kesh ekranda qoladi, o‘chirilmaydi, xato va "Qayta urinish" chiqadi', async () => {
    listResult.mockResolvedValue({ ok: false, items: [], error: new TypeError('Failed to fetch') });
    page();

    expect(await screen.findByText(/Saqlangan materiallarni yuklab bo'lmadi/)).toBeInTheDocument();
    expect(screen.getByText(/Keshdagi ma’ruza matni/)).toBeInTheDocument();
    expect(writeLecture).not.toHaveBeenCalledWith(CACHE_KEY, '');
    expect(cache.get(CACHE_KEY)).toBe(CACHED);

    // Internet qaytdi — "Qayta urinish" Bazadagi oxirgi ma'ruzani ochadi.
    listResult.mockResolvedValue({ ok: true, items: [row('cloud_5')] });
    loadById.mockResolvedValue({ topic: TOPIC.title, content: 'Bazadagi yangi ma’ruza.', primaryLanguage: 'uz' });
    fireEvent.click(screen.getByRole('button', { name: 'Qayta urinish' }));
    expect(await screen.findByText('Bazadagi yangi ma’ruza.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Saqlangan materiallarni yuklab bo'lmadi/)).not.toBeInTheDocument());
  });

  it('server aniq "yo‘q" desa — begona kesh o‘chiriladi (eski xulq)', async () => {
    listResult.mockResolvedValue({ ok: true, items: [] });
    page();
    await waitFor(() => expect(writeLecture).toHaveBeenCalledWith(CACHE_KEY, ''));
    expect(screen.queryByText(/Keshdagi ma’ruza matni/)).not.toBeInTheDocument();
  });

  it('Bazadagi versiya ochilmasa — xato ko‘rsatiladi (jim emas)', async () => {
    cache.clear();
    listResult.mockResolvedValue({
      ok: true,
      items: [row('cloud_2', 'Birinchi versiya'), row('cloud_1', 'Ikkinchi versiya', Date.parse('2026-11-16T08:00:00Z'))],
    });
    loadById.mockImplementation(async (_kind: string, id: string) =>
      id === 'cloud_2' ? { topic: TOPIC.title, content: 'Birinchi versiya matni.', primaryLanguage: 'uz' } : null,
    );
    page();
    expect(await screen.findByText('Birinchi versiya matni.')).toBeInTheDocument();

    fireEvent.click(await screen.findByText('Ikkinchi versiya'));
    expect(await screen.findByText(/Saqlangan ma'ruzani ochib bo'lmadi/)).toBeInTheDocument();
    // Ekrandagi ma'ruza joyida qoladi.
    expect(screen.getByText('Birinchi versiya matni.')).toBeInTheDocument();
  });

  it('tahrir PATCH tarmoq xatosida yiqilsa — yangi nusxa yaratilmaydi, xato chiqadi', async () => {
    cache.clear();
    listResult.mockResolvedValue({ ok: true, items: [row('cloud_9')] });
    loadById.mockResolvedValue({ topic: TOPIC.title, content: 'Asl matn.', primaryLanguage: 'uz' });
    patch.mockResolvedValue({ status: 'failed', error: new TypeError('Failed to fetch') });
    page();
    expect(await screen.findByText('Asl matn.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Tahrirlash/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '' }), { target: { value: 'Tahrirlangan matn.' } });
    fireEvent.click(screen.getByRole('button', { name: /O'zgarishlarni saqlash/ }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('cloud_9', expect.objectContaining({ content: 'Tahrirlangan matn.' })));
    expect(await screen.findByText(/bazaga saqlanmadi/)).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    // Tahrir ochiq qoladi — matn yo'qolmaydi.
    expect(screen.getByDisplayValue('Tahrirlangan matn.')).toBeInTheDocument();
  });

  it('yozuv topilmasa (not_found) — yangi yozuv saqlanadi', async () => {
    cache.clear();
    listResult.mockResolvedValue({ ok: true, items: [row('cloud_9')] });
    loadById.mockResolvedValue({ topic: TOPIC.title, content: 'Asl matn.', primaryLanguage: 'uz' });
    patch.mockResolvedValue({ status: 'not_found' });
    save.mockResolvedValue('cloud_10');
    page();
    expect(await screen.findByText('Asl matn.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Tahrirlash/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '' }), { target: { value: 'Yangi matn.' } });
    fireEvent.click(screen.getByRole('button', { name: /O'zgarishlarni saqlash/ }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toBe('lecture');
  });
});
