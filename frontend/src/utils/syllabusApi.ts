import { httpJson, HttpError } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import type { SyllabusTopic } from '../services/aiService';
import type { SyllabusVariant } from './syllabusVariant';

/** Markaziy fan syllabus (admin katalog) */
export type CourseSyllabusRow = {
  id: number;
  subject_name: string;
  subject_code: string;
  description: string;
  file_name: string;
  topics: SyllabusTopic[];
  variants: SyllabusVariant[];
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type StaffCourseSelectionRow = {
  id: number;
  syllabus: CourseSyllabusRow;
  selected_at: string;
};

/** @deprecated Legacy per-user syllabus */
export type SyllabusApiRow = {
  id: number;
  external_id: string;
  file_name: string;
  topics: SyllabusTopic[];
  created_at: string;
};

export type ClientSyllabusDocument = {
  id: string;
  serverId?: number;
  fileName: string;
  topics: SyllabusTopic[];
  createdAt: number;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ——— Admin: markaziy katalog ———

export async function fetchAdminCourseSyllabuses(): Promise<CourseSyllabusRow[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const rows = await httpJson<CourseSyllabusRow[]>(`${apiBaseUrl()}/v1/admin/course-syllabuses/`, {
    headers: authHeaders(token),
    timeoutMs: 30000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function createAdminCourseSyllabus(payload: {
  subject_name: string;
  subject_code?: string;
  description?: string;
  file_name?: string;
  topics?: SyllabusTopic[];
  variants?: SyllabusVariant[];
  sort_order?: number;
}): Promise<CourseSyllabusRow> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return httpJson<CourseSyllabusRow>(`${apiBaseUrl()}/v1/admin/course-syllabuses/`, {
    method: 'POST',
    headers: authHeaders(token),
    body: payload,
    timeoutMs: 120000,
  });
}

export async function updateAdminCourseSyllabus(
  id: number,
  payload: Partial<{
    subject_name: string;
    description: string;
    file_name: string;
    topics: SyllabusTopic[];
    variants: SyllabusVariant[];
    append_variants: boolean;
    sort_order: number;
    is_active: boolean;
  }>,
): Promise<CourseSyllabusRow> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return httpJson<CourseSyllabusRow>(`${apiBaseUrl()}/v1/admin/course-syllabuses/${id}/`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: payload,
    timeoutMs: 120000,
  });
}

export async function deleteAdminCourseSyllabus(id: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson<unknown>(`${apiBaseUrl()}/v1/admin/course-syllabuses/${id}/`, {
    method: 'DELETE',
    headers: authHeaders(token),
    timeoutMs: 20000,
  });
}

// ——— Hodim: katalog va tanlov ———

export async function fetchCourseSyllabusCatalog(): Promise<CourseSyllabusRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const rows = await httpJson<CourseSyllabusRow[]>(`${apiBaseUrl()}/v1/course-syllabuses/catalog/`, {
    headers: authHeaders(token),
    timeoutMs: 30000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function fetchMyCourseSelections(): Promise<StaffCourseSelectionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const rows = await httpJson<StaffCourseSelectionRow[]>(`${apiBaseUrl()}/v1/course-syllabuses/my/`, {
    headers: authHeaders(token),
    timeoutMs: 30000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function selectCourseSyllabus(syllabusId: number): Promise<StaffCourseSelectionRow> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return httpJson<StaffCourseSelectionRow>(`${apiBaseUrl()}/v1/course-syllabuses/my/`, {
    method: 'POST',
    headers: authHeaders(token),
    body: { syllabus_id: syllabusId },
    timeoutMs: 20000,
  });
}

export async function unselectCourseSyllabus(syllabusId: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson<unknown>(`${apiBaseUrl()}/v1/course-syllabuses/my/${syllabusId}/`, {
    method: 'DELETE',
    headers: authHeaders(token),
    timeoutMs: 20000,
  });
}

export function isSyncUnavailable(err: unknown): boolean {
  if (err instanceof HttpError && (err.status === 401 || err.status === 403)) return true;
  return false;
}
