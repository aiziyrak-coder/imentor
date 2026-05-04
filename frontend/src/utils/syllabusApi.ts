import { httpJson, HttpError } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import type { SyllabusTopic } from '../services/aiService';

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

function mapRow(row: SyllabusApiRow): ClientSyllabusDocument {
  return {
    id: row.external_id,
    serverId: row.id,
    fileName: row.file_name,
    topics: Array.isArray(row.topics) ? row.topics : [],
    createdAt: Date.parse(row.created_at),
  };
}

export async function fetchSyllabusesFromServer(): Promise<ClientSyllabusDocument[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const rows = await httpJson<SyllabusApiRow[]>(`${apiBaseUrl()}/v1/syllabuses/`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
  return Array.isArray(rows) ? rows.map(mapRow) : [];
}

export async function upsertSyllabusOnServer(doc: ClientSyllabusDocument): Promise<ClientSyllabusDocument> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const row = await httpJson<SyllabusApiRow>(`${apiBaseUrl()}/v1/syllabuses/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      external_id: doc.id,
      file_name: doc.fileName,
      topics: doc.topics,
    },
    timeoutMs: 60000,
  });
  return mapRow(row);
}

export async function deleteSyllabusOnServer(serverId: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson<unknown>(`${apiBaseUrl()}/v1/syllabuses/${serverId}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 20000,
  });
}

export function isSyncUnavailable(err: unknown): boolean {
  if (err instanceof HttpError && (err.status === 401 || err.status === 403)) return true;
  return false;
}
