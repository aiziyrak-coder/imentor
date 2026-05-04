import { httpJson, HttpError } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import type { TestQuestion } from '../services/aiService';

export type LiveTestSessionPayload = {
  topic: string;
  questions: TestQuestion[];
  createdAt: number;
};

export type LiveTestSubmissionRow = {
  firstName: string;
  lastName: string;
  answers: number[];
  submittedAt: number;
};

/** Talaba QR rejimi: login talab qilinmaydi (`?mode=student&sid=` yoki `id=`). */
export function isPublicStudentTestUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const p = new URLSearchParams(window.location.search);
  const sid = (p.get('sid') || p.get('id') || '').trim();
  return p.get('mode') === 'student' && sid.length > 0;
}

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

/** O‘qituvchi: sessiyani serverga yozadi (talaba QR boshqa qurilmada ochishi uchun). */
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
    },
    timeoutMs: 60000,
  });
}

/** Talaba: login talab qilinmaydi. */
export async function fetchLiveTestSessionFromServer(sessionKey: string): Promise<LiveTestSessionPayload | null> {
  try {
    const data = await httpJson<{
      topic: string;
      questions: TestQuestion[];
      created_at_ms: number;
    }>(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/`, {
      timeoutMs: 30000,
    });
    if (!data?.questions?.length) return null;
    return {
      topic: data.topic,
      questions: data.questions,
      createdAt: data.created_at_ms,
    };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

/** Talaba: javoblarni serverga yuboradi. */
export async function submitLiveTestOnServer(
  sessionKey: string,
  body: { firstName: string; lastName: string; answers: number[] }
): Promise<void> {
  await httpJson(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/submissions/`, {
    method: 'POST',
    body: {
      first_name: body.firstName,
      last_name: body.lastName,
      answers: body.answers,
    },
    timeoutMs: 30000,
  });
}

/** O‘qituvchi: realtime ro‘yxat (JWT). */
export async function fetchLiveTestSubmissionsFromServer(sessionKey: string): Promise<LiveTestSubmissionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const rows = await httpJson<
    Array<{
      first_name: string;
      last_name: string;
      answers: number[];
      submitted_at: string;
    }>
  >(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/submissions/`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 20000,
  });
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    firstName: r.first_name,
    lastName: r.last_name,
    answers: Array.isArray(r.answers) ? r.answers : [],
    submittedAt: Date.parse(r.submitted_at),
  }));
}
