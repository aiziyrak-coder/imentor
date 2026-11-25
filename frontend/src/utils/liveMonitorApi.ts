/**
 * Jonli test — monitor rejimi (2026-11-12): savol monitorda, telefonda faqat variantlar,
 * hamma bir vaqtda, har savolga 1 daqiqa, orqaga qaytib bo'lmaydi.
 */
import { httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

async function headers(): Promise<Record<string, string>> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return { Authorization: `Bearer ${token}` };
}

function url(sessionKey: string, path: string): string {
  return `${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/monitor/${path}`;
}

export type MonitorPhase = 'lobby' | 'running' | 'done';
/** read — 40 s savol monitorda; answer — 10 s javob belgilash (2026-11-12). */
export type MonitorStage = 'read' | 'answer' | '';

type Timing = {
  stage: MonitorStage;
  read_seconds: number;
  answer_seconds: number;
  read_ends_at_ms: number | null;
  ends_at_ms: number | null;
};

export type StudentMonitorState = Timing & {
  phase: MonitorPhase;
  index: number;
  total: number;
  options: string[];
  /** O'qishning oxirgi soniyalarida joriy savol variantlari OLDINDAN (ko'rsatilmaydi — belgilashgacha). */
  next_options?: string[];
  joined: boolean;
  ready: boolean;
  my_answer: number;
  server_now_ms: number;
  submitted: boolean;
  /** Monitor aloqasi uzilgan — test to'xtab turibdi; monitor qaytgach shu savol boshidan (2026-11-25). */
  paused?: boolean;
};

export type HostMonitorState = Timing & {
  phase: MonitorPhase;
  index: number;
  total: number;
  question: string;
  options: string[];
  joined: number;
  ready: number;
  answered_current: number;
  can_start: boolean;
  people: { name: string; ready: boolean; answered_current: boolean }[];
  submitted: number;
  server_now_ms: number;
  is_closed: boolean;
  /** Monitor uzoq yo'q bo'lib qaytdi — joriy savol shu so'rovda boshidan boshlandi. */
  restarted?: boolean;
};

type Who = { participantKey: string; firstName?: string; lastName?: string };

function who(w: Who) {
  return { participant_key: w.participantKey, first_name: w.firstName || '', last_name: w.lastName || '' };
}

export async function joinMonitor(sessionKey: string, w: Who): Promise<StudentMonitorState> {
  return httpJson(url(sessionKey, 'join/'), { method: 'POST', headers: await headers(), body: who(w), timeoutMs: 15000 });
}

export async function markReady(sessionKey: string, w: Who): Promise<StudentMonitorState> {
  return httpJson(url(sessionKey, 'ready/'), { method: 'POST', headers: await headers(), body: who(w), timeoutMs: 15000 });
}

export async function fetchStudentMonitor(sessionKey: string, participantKey: string): Promise<StudentMonitorState> {
  return httpJson(`${url(sessionKey, 'state/')}?participant_key=${encodeURIComponent(participantKey)}`, {
    headers: await headers(),
    // Qisqa: osilgan so'rov keyingisini 8 s ushlab turmasin (2026-11-13: variantlar kechikardi).
    timeoutMs: 3500,
  });
}

export async function answerMonitor(
  sessionKey: string,
  participantKey: string,
  index: number,
  option: number,
): Promise<StudentMonitorState> {
  return httpJson(url(sessionKey, 'answer/'), {
    method: 'POST',
    headers: await headers(),
    body: { participant_key: participantKey, index, option },
    timeoutMs: 8000,
  });
}

export async function fetchHostMonitor(sessionKey: string): Promise<HostMonitorState> {
  return httpJson(url(sessionKey, 'host/'), { headers: await headers(), timeoutMs: 8000 });
}

/** Faqat "start": test boshlangach hammasi vaqt bo'yicha o'zi ketadi (inson omili yo'q). */
export async function controlMonitor(sessionKey: string, action: 'start'): Promise<HostMonitorState> {
  return httpJson(url(sessionKey, 'control/'), {
    method: 'POST',
    headers: await headers(),
    body: { action },
    timeoutMs: 15000,
  });
}

export const OPTION_LETTERS = 'ABCDEFGH';

/**
 * Keyingi so'rov qachon (ms) — yoki `null` (test tugadi, boshqa so'ralmaydi).
 *
 * 2026-11-13: har telefon HAR SONIYA so'rardi — 20 dan ortiq sinf bir vaqtda testda bo'lganda
 * serverga sekundiga ~120 so'rov keldi, baza ulanishlari tugab, test yaratish va boshqa sahifalar
 * ham ishlamay qoldi. Aslida bosqich almashish vaqti oldindan ma'lum (`read_ends_at_ms`,
 * `ends_at_ms`): so'rov aynan shu chegaradan sal keyin (hamma telefon bir millisekundda urmasin —
 * tasodifiy kechikish bilan) va oraliqda zaxira uchun `maxMs` da bir yuboriladi. Taymer va chiziq
 * baribir mahalliy soatdan chiziladi.
 */
export function nextMonitorPollDelay(
  st: Pick<Timing, 'stage' | 'read_ends_at_ms' | 'ends_at_ms'> & { phase: MonitorPhase; server_now_ms: number; is_closed?: boolean; submitted?: boolean },
  opts: { lobbyMs: number; maxMs: number; jitterMs: number },
  rand: () => number = Math.random,
): number | null {
  if (st.phase === 'done' || st.is_closed || st.submitted) return null;
  if (st.phase !== 'running') return opts.lobbyMs;
  const boundary = st.stage === 'answer' ? st.ends_at_ms : st.read_ends_at_ms;
  const jitter = 120 + Math.floor(rand() * opts.jitterMs);
  if (!boundary) return Math.min(opts.maxMs, 1000 + jitter);
  const until = boundary - st.server_now_ms;
  return Math.max(250, Math.min(opts.maxMs, until + jitter));
}

/**
 * Talaba telefoni uchun keyingi so'rov (ms) yoki `null`.
 *
 * 2026-11-13: variantlar faqat chegaradagi bitta so'rov bilan kelardi — u kechiksa (mobil internet,
 * token yangilanishi) 15 soniyalik belgilash vaqti tugab qolardi. Endi server variantlarni o'qish
 * tugashidan 6 s oldin `next_options` da beradi; telefon shu oynaga (tugashdan 4,5–3 s oldin) so'raydi va
 * belgilashni o'z soati bilan ochadi. Variantlar qo'lda bo'lmasa — tez (0,7 s) qayta so'raydi.
 */
export function nextStudentPollDelay(
  st: Pick<Timing, 'stage' | 'read_ends_at_ms' | 'ends_at_ms'> & { phase: MonitorPhase; server_now_ms: number; submitted?: boolean; paused?: boolean },
  haveOptions: boolean,
  rand: () => number = Math.random,
): number | null {
  if (st.phase === 'done' || st.submitted) return null;
  if (st.phase !== 'running') return STUDENT_LOBBY_MS;
  if (st.paused) return STUDENT_PAUSED_MS + Math.floor(rand() * 600);
  const now = st.server_now_ms;
  const readEnds = st.read_ends_at_ms ?? 0;
  const ends = st.ends_at_ms ?? 0;
  if (!readEnds || !ends) return STUDENT_FAST_MS;
  const toNextQuestion = Math.max(250, Math.min(STUDENT_MAX_MS, ends - now + 150 + Math.floor(rand() * 450)));
  if (haveOptions) return toNextQuestion;
  if (st.stage === 'read' && readEnds - now > STUDENT_PREFETCH_AT_MS) {
    return Math.max(250, Math.min(STUDENT_MAX_MS, readEnds - now - STUDENT_PREFETCH_AT_MS + Math.floor(rand() * 1500)));
  }
  return STUDENT_FAST_MS;
}

export const STUDENT_LOBBY_MS = 2500;
/** Test to'xtab turganda (monitor aloqasi yo'q) — monitor qaytganini bilish uchun. */
export const STUDENT_PAUSED_MS = 3000;
export const STUDENT_MAX_MS = 5000;
export const STUDENT_FAST_MS = 700;
/** Server belgilash vaqti tugagach javobni shuncha ms qabul qiladi (`live_monitor.ANSWER_GRACE`, 6 s); telefon
 * biroz oldinroq to'xtaydi. */
export const ANSWER_GRACE_MS = 5500;

/**
 * Holat so'rovi yiqilgandan keyingi kutish (2026-11-17). Ilgari xatodan keyin 0,7 soniyada qayta so'ralardi:
 * server band bo'lsa yuzlab telefon uni yanada band qilardi (10:40–12:35 da so'rovlarning 30% gacha qismi
 * javobsiz qoldi). Endi ketma-ket xatolar soniga qarab 0,7 → 1,4 → 2,8 → 4 s, ustiga tasodifiy 0–0,6 s.
 */
export function pollRetryDelay(failures: number, rand: () => number = Math.random): number {
  const base = Math.min(4000, STUDENT_FAST_MS * 2 ** Math.max(0, failures - 1));
  return base + Math.floor(rand() * 600);
}
/** O'qish tugashidan shuncha ms oldin so'raladi (server oynasi 6 s). */
export const STUDENT_PREFETCH_AT_MS = 4500;
