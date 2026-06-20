import { httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import type { CaseStudySession, TestSession } from '../services/aiService';

export type CatalogKind = 'case' | 'test';

export type CatalogItemSummary = {
  id: number;
  kind: CatalogKind;
  topic: string;
  topic_norm: string;
  subject_name: string;
  subject_code: string;
  author_display_name: string;
  created_at: string;
  question_count: number;
};

export type CatalogSubjectRow = {
  subject_code: string;
  subject_name: string;
  case_count: number;
  test_count: number;
  total_count: number;
};

export type CatalogItemDetail = CatalogItemSummary & {
  payload: CaseStudySession | TestSession;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function fetchCatalogSubjects(): Promise<CatalogSubjectRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const rows = await httpJson<CatalogSubjectRow[]>(`${apiBaseUrl()}/v1/content-catalog/subjects/`, {
    headers: authHeaders(token),
    timeoutMs: 20000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function fetchCatalogItems(params: {
  kind?: CatalogKind | '';
  subjectCode?: string;
  q?: string;
  author?: string;
  sort?: 'subject' | 'topic' | 'newest';
}): Promise<CatalogItemSummary[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const query = new URLSearchParams();
  if (params.kind) query.set('kind', params.kind);
  if (params.subjectCode) query.set('subject_code', params.subjectCode);
  if (params.q?.trim()) query.set('q', params.q.trim());
  if (params.author?.trim()) query.set('author', params.author.trim());
  if (params.sort) query.set('sort', params.sort);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const rows = await httpJson<CatalogItemSummary[]>(`${apiBaseUrl()}/v1/content-catalog/${suffix}`, {
    headers: authHeaders(token),
    timeoutMs: 30000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function fetchCatalogItemDetail(id: number): Promise<CatalogItemDetail | null> {
  const token = await getBackendAccessToken();
  if (!token) return null;
  try {
    return await httpJson<CatalogItemDetail>(`${apiBaseUrl()}/v1/content-catalog/${id}/`, {
      headers: authHeaders(token),
      timeoutMs: 30000,
    });
  } catch {
    return null;
  }
}

export function groupCatalogBySubject(items: CatalogItemSummary[]): Map<string, CatalogItemSummary[]> {
  const map = new Map<string, CatalogItemSummary[]>();
  for (const item of items) {
    const key = item.subject_name?.trim() || 'Boshqa mavzular';
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  for (const [key, list] of map) {
    list.sort((a, b) => a.topic.localeCompare(b.topic, 'uz'));
    map.set(key, list);
  }
  return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'uz')));
}
