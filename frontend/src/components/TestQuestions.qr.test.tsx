/**
 * O'qituvchi test yaratganda QR kod O'ZI chiqadi (2026-10-16).
 *
 * Shikoyat: "test yaratishda QR code chiqmayapti". 14-oktabrdan beri jonli
 * sessiya faqat alohida tugma bilan ochilardi va o'qituvchilar uni
 * topishmasdi: 16-oktabr ertalab 102 ta test yaratilib, 39 ta sessiya
 * ochilgan edi. Yangi yaratilgan test darsda ishlatish uchun — sessiya va QR
 * test saqlangach avtomatik. Bazadan ochilgan eski versiya esa tugma bilan.
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

// O'qituvchi kirgan.
vi.mock('../utils/localStaffAuth', () => ({
  getCurrentLocalUser: () => ({ uid: 'stf_1', role: 'hodim', displayName: 'Ustoz Test' }),
  normalizeUserRole: (u: { role?: string } | null) => u?.role || 'hodim',
}));

// Monitor rejimi (2026-11-12): QR kutish xonasida chiqadi.
vi.mock('../utils/liveMonitorApi', async (orig) => ({
  ...(await orig<object>()),
  fetchHostMonitor: vi.fn(async () => ({
    phase: 'lobby', index: 0, total: 10, seconds: 60, ends_at_ms: null, question: '', options: [],
    joined: 0, ready: 0, answered_current: 0, can_start: false, people: [], submitted: 0,
    server_now_ms: Date.now(), is_closed: false,
  })),
}));

vi.mock('qrcode', () => ({
  default: { toString: vi.fn(async () => '<svg>QRKOD</svg>') },
}));

const SESSION = {
  topic: 'O‘tkir koronar sindrom',
  primaryLanguage: 'uz',
  difficulty: 'hard',
  domain: 'clinical',
  references: [],
  questions: [
    {
      question: '58 yoshli ayol 2 soatdan beri ko‘krak og‘rig‘i bilan keldi. Troponin I 0,8 ng/ml. Keyingi eng to‘g‘ri qadam qaysi?',
      options: ['Aspirin', 'Nitroglitserin', 'Geparin', 'Beta-bloker', 'Statin'],
      correctOptionIndex: 0,
      explanation: 'Aspirin birinchi.',
    },
  ],
};

const generateTests = vi.fn();
vi.mock('../services/aiService', async (orig) => ({
  ...(await orig<object>()),
  aiService: {
    generateTests: (...args: unknown[]) => generateTests(...args),
    // Sahifa 2026-10-21 dan `composeTest` ni chaqiradi (zaxira + reja).
    composeTest: (...args: unknown[]) => generateTests(...args),
    enrichTestSession: vi.fn(async (s: unknown) => s),
  },
}));

const createSession = vi.fn();
vi.mock('../utils/liveTestApi', async (orig) => ({
  ...(await orig<typeof import('../utils/liveTestApi')>()),
  createLiveTestSessionOnServer: (...args: unknown[]) => createSession(...args),
  syncLiveTestSessionToServer: vi.fn(async () => undefined),
  fetchLiveTestSessionFromServer: vi.fn(async () => ({ isClosed: false, closedAtMs: null, questions: [], topic: '' })),
  fetchLiveTestSubmissionsFromServer: vi.fn(async () => []),
  finalizeLiveTestSessionOnServer: vi.fn(),
  upsertLiveTestDraftOnServer: vi.fn(),
  submitLiveTestOnServer: vi.fn(),
}));

vi.mock('../utils/preparedContentStore', async (orig) => ({
  ...(await orig<typeof import('../utils/preparedContentStore')>()),
  listPreparedForTopicSynced: vi.fn(async () => []),
  listPreparedForTopicResult: vi.fn(async () => ({ ok: true, items: [] })),
  loadLatestPreparedContent: vi.fn(async () => null),
  loadPreparedByIdSynced: vi.fn(async () => null),
  savePreparedContent: vi.fn(async () => 'v1'),
  patchPreparedContentPayload: vi.fn(async () => ({ status: 'updated' })),
  deletePreparedContent: vi.fn(),
}));

vi.mock('../utils/lectureExcerpt', () => ({ loadLatestLectureText: vi.fn(async () => '') }));
vi.mock('../utils/analyticsApi', async (orig) => ({
  ...(await orig<object>()),
  postActivityEvents: vi.fn(async () => undefined),
}));

const { default: TestQuestions } = await import('./TestQuestions');

const TOPIC: SyllabusTopicContext = {
  id: 'L1',
  title: 'O‘tkir koronar sindrom',
  type: 'lecture' as never,
  syllabusId: 7,
  subjectName: 'Ichki kasalliklar',
  subjectCode: 'ICH-101',
  variantLabel: 'A',
  instructionLanguage: 'uz',
  departmentName: 'Fakultet terapiyasi',
};

function view(topic: SyllabusTopicContext | null = TOPIC) {
  return (
    <AppLanguageContext.Provider value={{ language: 'uz', setLanguage: () => {} }}>
      <GlobalTopicContext.Provider value={topic}>
        <TestQuestions />
      </GlobalTopicContext.Provider>
    </AppLanguageContext.Provider>
  );
}

function page() {
  return render(view());
}

describe('O‘qituvchi: test yaratilgach QR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
    generateTests.mockResolvedValue(SESSION);
    createSession.mockResolvedValue('lts_qr_demo');
  });

  it('QR tugmasiz, o‘zi chiqadi', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: /10 ta test savoli yaratish/ }));
    const qr = await screen.findByAltText('Student test QR');
    expect(qr.getAttribute('src')).toContain(encodeURIComponent('<svg>QRKOD</svg>'));
    expect(createSession).toHaveBeenCalledTimes(1);
    // Talaba havolasi shu sessiyaga.
    expect(screen.getByDisplayValue(/mode=student&sid=lts_qr_demo/)).toBeInTheDocument();
    // "Sessiyani boshlash" tugmasi endi kerak emas.
    expect(screen.queryByRole('button', { name: /Jonli sessiyani boshlash/ })).toBeNull();
  });

  it('sessiya ochilmasa — sababi aytiladi va tugma qoladi', async () => {
    createSession.mockRejectedValue(new TypeError('Failed to fetch'));
    page();
    fireEvent.click(await screen.findByRole('button', { name: /10 ta test savoli yaratish/ }));
    await waitFor(() => expect(createSession).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /Jonli sessiyani boshlash/ })).toBeInTheDocument();
    expect(screen.queryByAltText('Student test QR')).toBeNull();
  });
});

describe('O‘qituvchi: test tayyorlanayotganda boshqa bo‘limga o‘tib qaytdi (2026-11-06)', () => {
  // Shikoyat: "test yaratyapti, lekin QR chiqmayapti" — Testlar → Sillabus → Testlar, test 20 s dan keyin
  // tayyor bo'ldi: bazaga yozildi, lekin sessiya umuman ochilmadi.
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
    createSession.mockResolvedValue('lts_qr_demo');
  });

  function deferred() {
    let resolve!: (v: typeof SESSION) => void;
    const promise = new Promise<typeof SESSION>((r) => { resolve = r; });
    return { promise, resolve };
  }

  it('chiqib ketgan bo‘lsa ham sessiya ochiladi, mavzuga qaytganda QR chiqadi', async () => {
    const job = deferred();
    generateTests.mockReturnValue(job.promise);
    const first = page();
    fireEvent.click(await screen.findByRole('button', { name: /10 ta test savoli yaratish/ }));
    // Boshqa bo'limga o'tishda avval tanlangan mavzu almashadi, keyin sahifa yopiladi.
    first.rerender(view(null));
    first.unmount();
    job.resolve(SESSION);
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    const { normTopicKey } = await import('../utils/preparedContentStore');
    await waitFor(() => expect(sessionStorage.getItem(`imentor-teacher-live-sid-v1:${normTopicKey(TOPIC.title)}`)).toBe('lts_qr_demo'));
    page();
    expect(await screen.findByAltText('Student test QR')).toBeInTheDocument();
  });

  it('qaytgan sahifa ochiq turganda test tayyor bo‘lsa — QR o‘sha zahoti chiqadi', async () => {
    const job = deferred();
    generateTests.mockReturnValue(job.promise);
    const first = page();
    fireEvent.click(await screen.findByRole('button', { name: /10 ta test savoli yaratish/ }));
    first.rerender(view(null));
    first.unmount();
    page();
    await screen.findByRole('button', { name: /10 ta test savoli yaratish/ });
    expect(screen.queryByAltText('Student test QR')).toBeNull();
    job.resolve(SESSION);
    expect(await screen.findByAltText('Student test QR')).toBeInTheDocument();
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});

describe('O‘qituvchi: tahlil qilingan sessiyaga qaytish (2026-10-23)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  it('sahifa yangilansa natijalar yana ko‘rinadi (ilgari "0 natija")', async () => {
    const { normTopicKey } = await import('../utils/preparedContentStore');
    const api = await import('../utils/liveTestApi');
    sessionStorage.setItem(`imentor-teacher-live-sid-v1:${normTopicKey(TOPIC.title)}`, 'lts_done');
    localStorage.setItem(
      'imentor-live-test-session-lts_done',
      JSON.stringify({ topic: TOPIC.title, questions: SESSION.questions, createdAt: Date.now() }),
    );
    const closed = { isClosed: true, closedAtMs: Date.now(), questions: [], topic: TOPIC.title, createdAt: 0 };
    vi.mocked(api.fetchLiveTestSessionFromServer).mockResolvedValue(closed);
    vi.mocked(api.fetchLiveTestSubmissionsFromServer).mockResolvedValue([
      { firstName: 'Zarina', lastName: 'Karimova', answers: [0], submittedAt: Date.now(), correct: 1, total: 1 },
    ]);
    try {
      page();
      expect(await screen.findByText(/Karimova/)).toBeInTheDocument();
      expect(api.fetchLiveTestSubmissionsFromServer).toHaveBeenCalledWith('lts_done');
    } finally {
      vi.mocked(api.fetchLiveTestSessionFromServer).mockResolvedValue({
        isClosed: false, closedAtMs: null, questions: [], topic: '', createdAt: 0,
      });
      vi.mocked(api.fetchLiveTestSubmissionsFromServer).mockResolvedValue([]);
    }
  });
});
