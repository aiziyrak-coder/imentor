import { httpJson, HttpError } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import type { TestQuestion } from '../services/aiService';

/** Talaba uchun — javob kaliti va tushuntirishsiz savollar. */
export type StudentTestQuestion = Pick<TestQuestion, 'question' | 'options' | 'references'>;

export type LiveTestSessionPayload = {
  topic: string;
  questions: TestQuestion[];
  createdAt: number;
  isClosed?: boolean;
  closedAtMs?: number | null;
  /** Fan kesimida talaba natijalari/admin statistikasi uchun. */
  subjectCode?: string;
};

export type StudentLiveTestSessionPayload = Omit<LiveTestSessionPayload, 'questions'> & {
  questions: StudentTestQuestion[];
  /** Testga ajratilgan vaqt, soniya (0 — chegarasiz; eski server — undefined). */
  timeLimitSec?: number;
  /** Test tili (savollardan, server aniqlaydi): 'ru' | 'en' | 'uz' | ''. */
  language?: string;
  /** Mavzu nomi test tilida (tarjima bo'lmasa — asl nom). */
  topicDisplay?: string;
  /** "monitor" — savol monitorda, telefonda faqat variantlar (2026-11-12). */
  mode?: 'monitor';
  questionCount?: number;
};

export function stripQuestionsForStudent(questions: TestQuestion[]): StudentTestQuestion[] {
  return questions.map((q) => {
    const item: StudentTestQuestion = {
      question: q.question,
      options: q.options,
    };
    if (q.references?.length) item.references = q.references;
    return item;
  });
}

export type LiveTestSubmissionRow = {
  firstName: string;
  lastName: string;
  answers: number[];
  submittedAt: number;
  /** Server hisoblagan ball — sessiyaning o'z kaliti bo'yicha (eski serverda yo'q). */
  correct?: number;
  total?: number;
  /** Test ochiq paytida (2026-10-21): topshirdimi yoki hali yechmoqdami, nechta javob. Ball yo'q. */
  status?: 'submitted' | 'in_progress' | 'time_over';
  answered?: number;
  /** Yechayotgan talabaning qolgan vaqti, soniya (2026-10-22). */
  secondsLeft?: number | null;
  /** Tahlilda (2026-10-22): test sahifasidan chiqishlar, tashqarida o'tgan vaqt, testga ketgan vaqt. */
  awayCount?: number;
  awaySec?: number;
  durationSec?: number;
  /** `left_app` | `fast` | `same_answers` */
  flags?: string[];
  /** Bir xil xato javob bergan talabalar. */
  sameAs?: string[];
};

/** Talaba telefonida natija — o'qituvchi testni tahlilga yopgandan keyin. */
export type LiveTestMyResult = {
  ready: boolean;
  submitted: boolean;
  score?: number;
  total?: number;
  questions?: { question: string; options: string[]; correctIndex: number; answer: number; explanation: string }[];
};

export type LiveTestFinalizeResult = {
  isClosed: boolean;
  closedAtMs: number | null;
  autoSubmitted: number;
  submissions: LiveTestSubmissionRow[];
};

const PARTICIPANT_KEY_PREFIX = 'imentor-live-test-participant-';

/** Talaba QR rejimi (`?mode=student&sid=` / `id=`) — login OnlineTest orqali. */
export function isPublicStudentTestUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const p = new URLSearchParams(window.location.search);
  const sid = (p.get('sid') || p.get('id') || '').trim();
  return p.get('mode') === 'student' && sid.length > 0;
}

/** `owner` — kirgan talaba: bitta telefondan ikki talaba yechsa, ular aralashmaydi. */
export function getLiveTestParticipantKey(sessionKey: string, owner = ''): string {
  const storageKey = `${PARTICIPANT_KEY_PREFIX}${sessionKey}${owner ? `:${owner}` : ''}`;
  try {
    // localStorage: sahifa yangi oynada qayta ochilsa ham talaba O'SHA
    // ishtirokchi bo'lib qoladi. Ilgari kalit sessionStorage'da edi — har
    // yangi oyna serverda alohida bo'sh qoralama ochardi va test yopilganda
    // u ikkinchi "talaba" bo'lib 0 ball bilan qo'shilardi (2026-10-09).
    const existing = localStorage.getItem(storageKey) || (owner ? null : sessionStorage.getItem(storageKey));
    if (existing) {
      localStorage.setItem(storageKey, existing);
      return existing;
    }
    const created = `lp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return `lp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

const ANSWERS_PREFIX = 'imentor-live-test-answers-';

/** Talaba belgilagan javoblar shu qurilmada saqlanadi — sahifa yangilansa ham yo'qolmaydi. */
export function saveLocalLiveTestAnswers(sessionKey: string, answers: number[], owner = ''): void {
  try {
    localStorage.setItem(`${ANSWERS_PREFIX}${sessionKey}:${owner}`, JSON.stringify(answers));
  } catch {
    /* xotira to'lgan yoki yopiq — serverdagi qoralama baribir bor */
  }
}

export function loadLocalLiveTestAnswers(sessionKey: string, questionCount: number, owner = ''): number[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(`${ANSWERS_PREFIX}${sessionKey}:${owner}`) || 'null');
    if (!Array.isArray(raw) || raw.length !== questionCount) return null;
    return raw.map((v) => (Number.isInteger(v) && v >= 0 ? v : -1));
  } catch {
    return null;
  }
}

export function clearLocalLiveTestAnswers(sessionKey: string, owner = ''): void {
  try {
    localStorage.removeItem(`${ANSWERS_PREFIX}${sessionKey}:${owner}`);
  } catch {
    /* ahamiyatsiz */
  }
}

/** Ikki javob ro'yxati bir xilmi (holatni keraksiz yangilamaslik uchun). */
export function sameAnswers(a: number[], b: number[]): boolean {
  return a === b || (a.length === b.length && a.every((x, i) => x === b[i]));
}

export function countAnswered(answers: number[]): number {
  return answers.filter((a) => a >= 0).length;
}

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

type ServerSubmissionRow = {
  first_name: string;
  last_name: string;
  answers: number[];
  correct?: number | null;
  total?: number;
  submitted_at: string | null;
  status?: 'submitted' | 'in_progress' | 'time_over';
  answered?: number;
  seconds_left?: number | null;
  away_count?: number;
  away_sec?: number;
  duration_sec?: number;
  flags?: string[];
  same_as?: string[];
};

function mapSubmissionRows(rows: ServerSubmissionRow[]): LiveTestSubmissionRow[] {
  return rows.map((r) => ({
    firstName: r.first_name,
    lastName: r.last_name,
    answers: Array.isArray(r.answers) ? r.answers : [],
    submittedAt: r.submitted_at ? Date.parse(r.submitted_at) : 0,
    ...(typeof r.correct === 'number' && typeof r.total === 'number' ? { correct: r.correct, total: r.total } : {}),
    ...(r.status ? { status: r.status, answered: r.answered ?? 0, total: r.total } : {}),
    ...(r.seconds_left !== undefined ? { secondsLeft: r.seconds_left } : {}),
    ...(Array.isArray(r.flags)
      ? {
          flags: r.flags,
          sameAs: Array.isArray(r.same_as) ? r.same_as : [],
          awayCount: r.away_count ?? 0,
          awaySec: r.away_sec ?? 0,
          durationSec: r.duration_sec ?? 0,
        }
      : {}),
  }));
}

/** Talaba: o'z natijasi va savollar tahlili (test yopilmaguncha `ready: false`). */
export async function fetchMyLiveTestResult(sessionKey: string): Promise<LiveTestMyResult | null> {
  const token = await getBackendAccessToken();
  if (!token) return null;
  const data = await httpJson<{
    ready: boolean;
    submitted: boolean;
    score?: number;
    total?: number;
    questions?: { question: string; options: string[]; correct_index: number; answer: number; explanation: string }[];
  }>(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/my-result/`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 15000,
  });
  return {
    ready: Boolean(data.ready),
    submitted: Boolean(data.submitted),
    score: data.score,
    total: data.total,
    questions: (data.questions || []).map((q) => ({
      question: q.question,
      options: Array.isArray(q.options) ? q.options : [],
      correctIndex: q.correct_index,
      answer: q.answer,
      explanation: q.explanation || '',
    })),
  };
}

/** O‘qituvchi: sessiyani serverga yozadi (talaba QR boshqa qurilmada ochishi uchun). */
export async function createLiveTestSessionOnServer(
  payload: LiveTestSessionPayload
): Promise<string> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const data = await httpJson<{ ok: boolean; session_key: string }>(`${apiBaseUrl()}/v1/live-tests/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      topic: payload.topic,
      questions: payload.questions,
      created_at_ms: payload.createdAt,
      subject_code: payload.subjectCode || '',
    },
    timeoutMs: 60000,
  });
  const sessionKey = data.session_key?.trim();
  if (!sessionKey) throw new Error('missing-session-key');
  return sessionKey;
}

/** O‘qituvchi: mavjud sessiyani serverga yangilaydi. */
export async function upsertLiveTestSessionOnServer(
  sessionKey: string,
  payload: LiveTestSessionPayload
): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson(`${apiBaseUrl()}/v1/live-tests/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      session_key: sessionKey,
      topic: payload.topic,
      questions: payload.questions,
      created_at_ms: payload.createdAt,
      subject_code: payload.subjectCode || '',
    },
    timeoutMs: 60000,
  });
}

/** Serverda sessiya yo‘q bo‘lsa (yangi server / DB ko‘chirish) — qayta yozadi. */
export async function syncLiveTestSessionToServer(
  sessionKey: string,
  payload: LiveTestSessionPayload
): Promise<boolean> {
  try {
    await upsertLiveTestSessionOnServer(sessionKey, payload);
    return true;
  } catch {
    return false;
  }
}

/** Talaba: login talab qilinmaydi (javob kaliti yashirilgan). */
export async function fetchLiveTestSessionFromServer(
  sessionKey: string
): Promise<StudentLiveTestSessionPayload | null> {
  try {
    const data = await httpJson<{
      topic: string;
      questions: TestQuestion[];
      created_at_ms: number;
      is_closed?: boolean;
      closed_at_ms?: number | null;
      time_limit_sec?: number;
      language?: string;
      topic_display?: string;
      mode?: string;
      question_count?: number;
    }>(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/`, {
      timeoutMs: 30000,
    });
    // Monitor rejimida savollar telefonga berilmaydi (2026-11-12) — ro'yxat bo'sh keladi.
    const monitor = data?.mode === 'monitor';
    if (!data?.questions?.length && !monitor) return null;
    return {
      topic: data.topic,
      questions: stripQuestionsForStudent(data.questions),
      createdAt: data.created_at_ms,
      isClosed: Boolean(data.is_closed),
      closedAtMs: data.closed_at_ms ?? null,
      ...(typeof data.time_limit_sec === 'number' ? { timeLimitSec: data.time_limit_sec } : {}),
      ...(data.language ? { language: data.language } : {}),
      ...(data.topic_display ? { topicDisplay: data.topic_display } : {}),
      ...(monitor ? { mode: 'monitor' as const, questionCount: data.question_count ?? 0 } : {}),
    };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

export type LiveTestDraftResult = {
  /** Serverda saqlangan javoblar (boshqa qurilma yoki oldingi oynadan). */
  answers: number[];
  /** Talaba allaqachon topshirgan yoki test yopilganda avtomatik topshirilgan. */
  alreadySubmitted: boolean;
  /** Vaqt chegarasi (2026-10-22): tugash payti va server soati — telefon soati noto'g'ri bo'lsa ham. */
  deadlineMs: number | null;
  serverNowMs: number | null;
  /** Vaqt tugagan — javoblar endi o'zgarmaydi. */
  expired: boolean;
};

/** Talaba: draft javoblarni serverga saqlaydi (JWT majburiy). */
export async function upsertLiveTestDraftOnServer(
  sessionKey: string,
  body: {
    participantKey: string;
    firstName: string;
    lastName: string;
    answers: number[];
  }
): Promise<LiveTestDraftResult> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const data = await httpJson<{
    answers?: number[];
    already_submitted?: boolean;
    deadline_ms?: number | null;
    server_now_ms?: number | null;
    expired?: boolean;
  }>(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/drafts/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      participant_key: body.participantKey,
      first_name: body.firstName,
      last_name: body.lastName,
      answers: body.answers,
    },
    timeoutMs: 15000,
  });
  return {
    answers: Array.isArray(data?.answers) ? data.answers : [],
    alreadySubmitted: Boolean(data?.already_submitted),
    deadlineMs: typeof data?.deadline_ms === 'number' ? data.deadline_ms : null,
    serverNowMs: typeof data?.server_now_ms === 'number' ? data.server_now_ms : null,
    expired: Boolean(data?.expired),
  };
}

/** Talaba: javoblarni serverga yuboradi (JWT majburiy). */
/** Topshiriqni qayta yuborish oralig'i (ms): jami ~20 soniya — server qayta ishga tushishiga yetadi. */
export const SUBMIT_RETRY_MS = [1500, 4000, 8000, 8000];

/** Vaqtinchalik xato: server yo'q (502/503/504), tarmoq uzilgan yoki so'rov vaqti tugagan. */
export function isTransientError(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504;
  return e instanceof TypeError;
}

export async function submitLiveTestOnServer(
  sessionKey: string,
  body: {
    participantKey?: string;
    firstName: string;
    lastName: string;
    answers: number[];
    started_at_ms?: number;
    duration_sec?: number;
  }
): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const send = () =>
    httpJson(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/submissions/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        participant_key: body.participantKey || '',
        first_name: body.firstName,
        last_name: body.lastName,
        answers: body.answers,
        started_at_ms: body.started_at_ms,
        duration_sec: body.duration_sec,
      },
      timeoutMs: 30000,
    });
  // Server qayta ishga tushayotgan payt (502/503) yoki tarmoq uzilishi — bir necha marta
  // qayta yuboriladi (2026-10-23: yangilash paytida bir daqiqada 80 ta topshiriq 502 oldi).
  // Takror yuborish xavfsiz: server ikkinchisini "allaqachon topshirilgan" deb qabul qiladi.
  for (const wait of SUBMIT_RETRY_MS) {
    try {
      await send();
      return;
    } catch (e) {
      if (!isTransientError(e)) throw e;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  await send();
}

export type StudentMySubmissionRow = {
  id: number;
  sessionKey: string;
  topic: string;
  subjectCode: string;
  subjectName: string;
  /** Fan biriktirilgan kafedra (bo'sh bo'lishi mumkin). */
  department: string;
  firstName: string;
  lastName: string;
  answers: number[];
  /** O'qituvchi testni tahlilga yopmaguncha `null` (2026-10-21). */
  score: number | null;
  total: number;
  submittedAt: number;
  isClosed: boolean;
};

/** Talaba: o'zi topshirgan dars testlari — fan kesimida, ball bilan. */
export async function fetchMyLiveTestSubmissions(): Promise<StudentMySubmissionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const rows = await httpJson<
    Array<{
      id: number;
      session_key: string;
      topic: string;
      subject_code?: string;
      subject_name?: string;
      department?: string;
      first_name: string;
      last_name: string;
      answers: number[];
      score?: number | null;
      total?: number;
      result_ready?: boolean;
      submitted_at: string;
      is_closed: boolean;
    }>
  >(`${apiBaseUrl()}/v1/live-tests/my-submissions/`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 20000,
  });
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: r.id,
    sessionKey: r.session_key,
    topic: r.topic || '',
    subjectCode: r.subject_code || '',
    subjectName: r.subject_name || '',
    department: r.department || '',
    firstName: r.first_name,
    lastName: r.last_name,
    answers: Array.isArray(r.answers) ? r.answers : [],
    // Eski server `result_ready` yubormaydi — u holda ball darhol ko'rinadi.
    score: r.result_ready === false || r.score == null ? null : r.score,
    total: r.total ?? 0,
    submittedAt: Date.parse(r.submitted_at),
    isClosed: Boolean(r.is_closed),
  }));
}

/** O‘qituvchi: draftlarni avtomatik topshirish va sessiyani yopish. */
export async function finalizeLiveTestSessionOnServer(sessionKey: string): Promise<LiveTestFinalizeResult> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const data = await httpJson<{
    is_closed: boolean;
    closed_at_ms?: number | null;
    auto_submitted: number;
    submissions: ServerSubmissionRow[];
  }>(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/finalize/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
  return {
    isClosed: Boolean(data.is_closed),
    closedAtMs: data.closed_at_ms ?? null,
    autoSubmitted: data.auto_submitted ?? 0,
    submissions: mapSubmissionRows(Array.isArray(data.submissions) ? data.submissions : []),
  };
}

/** O‘qituvchi: realtime ro‘yxat (JWT). Sessiya serverda yo‘q bo‘lsa [] (404 konsol shovqinini oldini oladi). */
export async function fetchLiveTestSubmissionsFromServer(sessionKey: string): Promise<LiveTestSubmissionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  try {
    const rows = await httpJson<ServerSubmissionRow[]>(
      `${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/submissions/`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 20000,
    });
    if (!Array.isArray(rows)) return [];
    return mapSubmissionRows(rows);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return [];
    throw e;
  }
}

export type AdminLiveTestStatRow = {
  subjectCode: string;
  subjectName: string;
  department: string;
  submissionCount: number;
  studentCount: number;
  avgScorePct: number | null;
};

/** Admin: fan (va kafedra) kesimida — kim qancha jonli test yechgani. */
export async function fetchAdminLiveTestStats(): Promise<AdminLiveTestStatRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const data = await httpJson<{
    results: Array<{
      subject_code: string;
      subject_name: string;
      department: string;
      submission_count: number;
      student_count: number;
      avg_score_pct: number | null;
    }>;
  }>(`${apiBaseUrl()}/v1/admin/live-test-stats/`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((r) => ({
    subjectCode: r.subject_code,
    subjectName: r.subject_name,
    department: r.department,
    submissionCount: r.submission_count,
    studentCount: r.student_count,
    avgScorePct: r.avg_score_pct,
  }));
}

export type AdminLiveTestSubmissionRow = {
  id: number;
  sessionKey: string;
  topic: string;
  subjectCode: string;
  subjectName: string;
  studentId: string;
  firstName: string;
  lastName: string;
  score: number;
  total: number;
  submittedAt: number;
};

/** Admin: har bir talabaning jonli test (QR) topshirig'i — sahifalangan, fan/sessiya bo'yicha filtrlanadi. */
export async function fetchAdminLiveTestSubmissions(params?: {
  subjectCode?: string;
  sessionKey?: string;
  studentId?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ results: AdminLiveTestSubmissionRow[]; count: number; page: number; pageSize: number }> {
  const token = await getBackendAccessToken();
  if (!token) return { results: [], count: 0, page: 1, pageSize: 50 };
  const query = new URLSearchParams();
  if (params?.subjectCode) query.set('subject_code', params.subjectCode);
  if (params?.sessionKey) query.set('session_key', params.sessionKey);
  if (params?.studentId) query.set('student_id', params.studentId);
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('page_size', String(params.pageSize));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const data = await httpJson<{
    count: number;
    page: number;
    page_size: number;
    results: Array<{
      id: number;
      session_key: string;
      topic: string;
      subject_code: string;
      subject_name: string;
      student_id: string;
      first_name: string;
      last_name: string;
      score: number;
      total: number;
      submitted_at: string;
    }>;
  }>(`${apiBaseUrl()}/v1/admin/live-test-submissions/${suffix}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    count: data.count ?? 0,
    page: data.page ?? 1,
    pageSize: data.page_size ?? 50,
    results: results.map((r) => ({
      id: r.id,
      sessionKey: r.session_key,
      topic: r.topic || '',
      subjectCode: r.subject_code || '',
      subjectName: r.subject_name || '',
      studentId: r.student_id || '',
      firstName: r.first_name,
      lastName: r.last_name,
      score: r.score,
      total: r.total,
      submittedAt: Date.parse(r.submitted_at),
    })),
  };
}

export type AdminLiveTestSessionRow = {
  sessionKey: string;
  topic: string;
  createdAtMs: number;
  isClosed: boolean;
  submissionCount: number;
};

/** Admin: fan ichidagi har bir jonli test (mavzu + sana) — nechta talaba yechgani bilan. */
export async function fetchAdminLiveTestSessions(subjectCode: string): Promise<AdminLiveTestSessionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const query = new URLSearchParams();
  if (subjectCode) query.set('subject_code', subjectCode);
  const data = await httpJson<{
    results: Array<{
      session_key: string;
      topic: string;
      created_at_ms: number;
      is_closed: boolean;
      submission_count: number;
    }>;
  }>(`${apiBaseUrl()}/v1/admin/live-test-sessions/?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((r) => ({
    sessionKey: r.session_key,
    topic: r.topic || '',
    createdAtMs: r.created_at_ms,
    isClosed: Boolean(r.is_closed),
    submissionCount: r.submission_count,
  }));
}

export type StudentReportSessionRow = {
  sessionKey: string;
  topic: string;
  createdAtMs: number;
  isClosed: boolean;
  questionCount: number;
  participantCount: number;
  /** Talaba shu darsning testini topshirganmi. */
  taken: boolean;
  score: number | null;
  total: number;
  submittedAt: number | null;
};

export type StudentReportSubjectRow = {
  subjectCode: string;
  subjectName: string;
  totalSessions: number;
  takenSessions: number;
  avgScorePct: number | null;
  sessions: StudentReportSessionRow[];
};

export type StudentLiveTestReport = {
  found: boolean;
  studentId: string;
  firstName: string;
  lastName: string;
  subjects: StudentReportSubjectRow[];
};

/**
 * Admin: bitta talabaning to'liq hisoboti — fanlar, ular ichida har bir dars
 * testi (yechgan/yechmagan va ball bilan).
 */
export async function fetchStudentLiveTestReport(studentId: string): Promise<StudentLiveTestReport> {
  const token = await getBackendAccessToken();
  const empty: StudentLiveTestReport = {
    found: false,
    studentId,
    firstName: '',
    lastName: '',
    subjects: [],
  };
  if (!token || !studentId.trim()) return empty;
  const data = await httpJson<{
    found: boolean;
    student_id: string;
    first_name: string;
    last_name: string;
    subjects: Array<{
      subject_code: string;
      subject_name: string;
      total_sessions: number;
      taken_sessions: number;
      avg_score_pct: number | null;
      sessions: Array<{
        session_key: string;
        topic: string;
        created_at_ms: number;
        is_closed: boolean;
        question_count: number;
        participant_count: number;
        taken: boolean;
        score: number | null;
        total: number;
        submitted_at: string | null;
      }>;
    }>;
  }>(`${apiBaseUrl()}/v1/admin/student-live-test-report/?student_id=${encodeURIComponent(studentId.trim())}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
  return {
    found: Boolean(data.found),
    studentId: data.student_id || studentId,
    firstName: data.first_name || '',
    lastName: data.last_name || '',
    subjects: (Array.isArray(data.subjects) ? data.subjects : []).map((s) => ({
      subjectCode: s.subject_code,
      subjectName: s.subject_name || '',
      totalSessions: s.total_sessions ?? 0,
      takenSessions: s.taken_sessions ?? 0,
      avgScorePct: s.avg_score_pct,
      sessions: (Array.isArray(s.sessions) ? s.sessions : []).map((r) => ({
        sessionKey: r.session_key,
        topic: r.topic || '',
        createdAtMs: r.created_at_ms,
        isClosed: Boolean(r.is_closed),
        questionCount: r.question_count ?? 0,
        participantCount: r.participant_count ?? 0,
        taken: Boolean(r.taken),
        score: r.score,
        total: r.total ?? 0,
        submittedAt: r.submitted_at ? Date.parse(r.submitted_at) : null,
      })),
    })),
  };
}
