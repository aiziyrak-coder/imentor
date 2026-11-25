/**
 * O'qituvchi sozlamalari — o'zi bajaradigan ishlar (backend `routes/staff_self.py`).
 * Hammasi faqat O'Z ma'lumotiga yoki O'Z kafedrasiga ta'sir qiladi.
 */
import { HttpError, httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return { Authorization: `Bearer ${token}` };
}

export function errorText(err: unknown, fallback: string): string {
  if (err instanceof HttpError) {
    const detail = (err.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string' && detail) return detail;
  }
  return fallback;
}

// ---------------------------------------------------------------- profil

export type MyProfile = {
  login: string;
  first_name: string;
  last_name: string;
  job_title: string;
  faculty: string;
  department_id: number | null;
  department: string;
  face_linked: boolean;
  pinfl_linked: boolean;
};

export type Department = { id: number; name: string };

export async function fetchMyProfile(): Promise<MyProfile> {
  return httpJson<MyProfile>(`${apiBaseUrl()}/v1/staff/me/profile/`, { headers: await authHeaders() });
}

/** Jonli test vaqtlari (2026-11-25): savolni o'qish va javob belgilash, soniya (10–120). */
export type TestTiming = {
  read_seconds: number;
  answer_seconds: number;
  custom: boolean;
  default_read: number;
  default_answer: number;
  min: number;
  max: number;
};

export async function fetchTestTiming(): Promise<TestTiming> {
  return httpJson<TestTiming>(`${apiBaseUrl()}/v1/staff/me/test-timing/`, { headers: await authHeaders() });
}

export async function saveTestTiming(input: { read_seconds: number | null; answer_seconds: number | null }): Promise<TestTiming> {
  return httpJson<TestTiming>(`${apiBaseUrl()}/v1/staff/me/test-timing/`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: input,
  });
}

export async function saveMyProfile(input: {
  first_name: string;
  last_name: string;
  job_title: string;
  department_id: number | null;
}): Promise<MyProfile> {
  return httpJson<MyProfile>(`${apiBaseUrl()}/v1/staff/me/profile/`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: input,
  });
}

export async function fetchDepartments(): Promise<Department[]> {
  return httpJson<Department[]>(`${apiBaseUrl()}/v1/staff/departments/`, {
    headers: await authHeaders(),
    timeoutMs: 20000,
  });
}

// ---------------------------------------------------------------- kafedra kutubxonasi

export type LibraryItem = {
  id: number;
  title: string;
  kind: 'book' | 'protocol';
  status: 'ready' | 'processing' | 'failed';
  status_note: string;
  chunk_count: number;
  owner_key: string;
  uploader_name: string;
  can_delete: boolean;
  created_at: string | null;
};

export async function fetchLibrary(): Promise<{ department: string; items: LibraryItem[] }> {
  return httpJson(`${apiBaseUrl()}/v1/staff/library/`, { headers: await authHeaders(), timeoutMs: 30000 });
}

export async function uploadLibraryItem(file: File, kind: 'book' | 'protocol', title: string): Promise<LibraryItem> {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  form.append('title', title);
  const res = await fetch(`${apiBaseUrl()}/v1/staff/library/`, {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, body);
  return body as LibraryItem;
}

/** Hujjat nomi va/yoki turini tuzatish (yuklagan o'qituvchi yoki admin). */
export async function updateLibraryItem(
  id: number,
  patch: { title?: string; kind?: 'book' | 'protocol' },
): Promise<LibraryItem> {
  return httpJson<LibraryItem>(`${apiBaseUrl()}/v1/staff/library/${id}/`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: patch,
  });
}

export async function deleteLibraryItem(id: number): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/staff/library/${id}/`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => null);
    throw new HttpError(`HTTP ${res.status}`, res.status, body);
  }
}

// ---------------------------------------------------------------- kasallik / ta'til (2026-10-28)

export type AbsenceKind = 'kasallik' | 'tatil' | 'dekret' | 'malaka' | 'safar' | 'boshqa';

/** O'rinbosar — "o'rnimga kim dars o'tyapti" (2026-11-19). */
export type AbsenceSubstitute = { key: string; name: string; employee_id?: string; department?: string };
export type AbsenceStatus = 'pending' | 'approved' | 'rejected';

export type Absence = {
  id: number;
  owner_key: string;
  name: string;
  department: string;
  kind: AbsenceKind;
  kind_label: string;
  start_date: string;
  end_date: string;
  days: number;
  note: string;
  status: AbsenceStatus;
  has_document: boolean;
  doc_name: string;
  decided_by: string;
  decided_at: string | null;
  decision_note: string;
  created_at: string | null;
  substitute?: AbsenceSubstitute | null;
};

export async function fetchMyAbsences(): Promise<{ items: Absence[] }> {
  return httpJson(`${apiBaseUrl()}/v1/staff/me/absences/`, { headers: await authHeaders(), timeoutMs: 20000 });
}

export async function submitAbsence(input: {
  kind: AbsenceKind;
  startDate: string;
  endDate: string;
  note: string;
  file: File;
  substituteKey?: string;
}): Promise<Absence> {
  const form = new FormData();
  form.append('substitute_key', input.substituteKey || '');
  form.append('kind', input.kind);
  form.append('start_date', input.startDate);
  form.append('end_date', input.endDate);
  form.append('note', input.note);
  form.append('file', input.file);
  const res = await fetch(`${apiBaseUrl()}/v1/staff/me/absences/`, {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, body);
  return body as Absence;
}

export async function fetchSubstituteCandidates(q: string): Promise<AbsenceSubstitute[]> {
  const body = await httpJson<{ items: AbsenceSubstitute[] }>(
    `${apiBaseUrl()}/v1/staff/me/absences/teachers/?q=${encodeURIComponent(q)}`,
    { headers: await authHeaders(), timeoutMs: 20000 },
  );
  return body.items || [];
}

export async function setAbsenceSubstitute(id: number, substituteKey: string): Promise<Absence> {
  return httpJson(`${apiBaseUrl()}/v1/staff/me/absences/${id}/substitute/`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: { substitute_key: substituteKey },
  });
}

export async function withdrawAbsence(id: number): Promise<void> {
  await httpJson(`${apiBaseUrl()}/v1/staff/me/absences/${id}/`, { method: 'DELETE', headers: await authHeaders() });
}

/** Hujjatni (varaqa rasmi) yangi oynada ochadi — fayl ochiq havola bilan berilmaydi. */
export async function openAbsenceDocument(id: number, scope: 'me' | 'admin'): Promise<void> {
  const url = scope === 'me'
    ? `${apiBaseUrl()}/v1/staff/me/absences/${id}/document/`
    : `${apiBaseUrl()}/v1/admin/staff-absences/${id}/document/`;
  // Oyna oldindan ochiladi: aks holda brauzer `await` dan keyingi ochishni bloklaydi.
  const win = window.open('', '_blank');
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) {
    win?.close();
    throw new HttpError(`HTTP ${res.status}`, res.status, await res.json().catch(() => null));
  }
  const blobUrl = URL.createObjectURL(await res.blob());
  if (win) win.location.href = blobUrl;
  else window.location.href = blobUrl;
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export async function fetchAdminAbsences(
  status: AbsenceStatus | 'all',
): Promise<{ items: Absence[]; counts: Record<AbsenceStatus, number> }> {
  return httpJson(`${apiBaseUrl()}/v1/admin/staff-absences/?status_filter=${status}`, {
    headers: await authHeaders(),
    timeoutMs: 20000,
  });
}

export async function decideAbsence(id: number, approve: boolean, note: string): Promise<Absence> {
  return httpJson(`${apiBaseUrl()}/v1/admin/staff-absences/${id}/decide/`, {
    method: 'POST',
    headers: await authHeaders(),
    body: { approve, note },
  });
}
