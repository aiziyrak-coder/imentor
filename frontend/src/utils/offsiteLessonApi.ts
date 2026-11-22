/**
 * Darsni sababli boshqa joyda o'tish (2026-11-12): o'qituvchi dars vaqtida telefondan qayd etadi,
 * admin alohida hisobotda ko'radi; qayd etilgan dars rektor hisobotida qizil bo'lmaydi.
 */
import { HttpError, httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import { markGeoFailed, markGeoGranted, mayLocateAutomatically } from './geoConsent';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return { Authorization: `Bearer ${token}` };
}

export type OffsiteReason = 'klinika' | 'xona' | 'monitor' | 'amaliyot' | 'boshqa';
export const OFFSITE_REASONS: OffsiteReason[] = ['klinika', 'xona', 'monitor', 'amaliyot', 'boshqa'];

export type CurrentLesson = {
  lesson_id: number;
  date: string;
  para: string;
  start_time: string;
  end_time: string;
  subject_name: string;
  group_name: string;
  room: string;
  marked: boolean;
  reason_label: string;
};

export type OffsiteItem = {
  id: number;
  owner_key: string;
  name: string;
  department: string;
  lesson_id: number;
  date: string;
  para: string;
  start_time: string;
  end_time: string;
  subject_name: string;
  group_name: string;
  scheduled_room: string;
  reason: OffsiteReason;
  reason_label: string;
  note: string;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  has_photo: boolean;
  created_at: string | null;
};

export type OffsiteReport = {
  start: string;
  end: string;
  total: number;
  teachers_count: number;
  by_reason: { reason: OffsiteReason; label: string; count: number }[];
  teachers: { owner_key: string; name: string; department: string; count: number; reasons: Record<string, number> }[];
  items: OffsiteItem[];
};

export async function fetchCurrentLessons(): Promise<{ lessons: CurrentLesson[]; next_lesson?: CurrentLesson | null }> {
  return httpJson(`${apiBaseUrl()}/v1/staff/me/offsite-lessons/current/`, { headers: await authHeaders(), timeoutMs: 20000 });
}

export async function submitOffsiteLesson(input: {
  lessonId: number;
  reason: OffsiteReason;
  note: string;
  photo: File;
  position?: { lat: number; lon: number; accuracy: number } | null;
}): Promise<OffsiteItem> {
  const form = new FormData();
  form.append('lesson_id', String(input.lessonId));
  form.append('reason', input.reason);
  form.append('note', input.note);
  if (input.position) {
    form.append('lat', String(input.position.lat));
    form.append('lon', String(input.position.lon));
    form.append('accuracy', String(input.position.accuracy));
  }
  form.append('file', input.photo);
  const res = await fetch(`${apiBaseUrl()}/v1/staff/me/offsite-lessons/`, {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, body);
  return body as OffsiteItem;
}

export async function fetchOffsiteReport(start: string, end: string): Promise<OffsiteReport> {
  return httpJson(`${apiBaseUrl()}/v1/admin/offsite-lessons/?start=${start}&end=${end}`, {
    headers: await authHeaders(),
    timeoutMs: 30000,
  });
}

/** Admin: dars rasmi (blob havola) — rasm ochiq havola bilan berilmaydi. */
export async function fetchOffsitePhotoUrl(id: number): Promise<string> {
  const res = await fetch(`${apiBaseUrl()}/v1/admin/offsite-lessons/${id}/photo/`, { headers: await authHeaders() });
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, null);
  return URL.createObjectURL(await res.blob());
}

/** Joylashuv (bir marta, 8 s); ruxsat bo'lmasa — null (qayd baribir yuboriladi). */
export async function currentPosition(): Promise<{ lat: number; lon: number; accuracy: number } | null> {
  if (!navigator.geolocation || !(await mayLocateAutomatically())) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        markGeoGranted();
        resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      (err) => {
        markGeoFailed(err);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}
