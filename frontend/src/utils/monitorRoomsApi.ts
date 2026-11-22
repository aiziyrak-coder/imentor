/** Admin panel «Monitorli xonalar» (2026-11-16). */
import { httpJson } from '../api/httpClient';
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

async function call<T>(path: string, init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {}): Promise<T> {
  return httpJson<T>(`${apiBaseUrl()}/v1/admin/monitor-rooms/${path}`, {
    method: init.method || 'GET',
    body: init.body as Record<string, unknown> | undefined,
    headers: await authHeaders(),
    timeoutMs: 30000,
  });
}

export type MonitorRoom = {
  id: number;
  monitor_id: string;
  room_full: string;
  hemis_codes: string[];
  hemis_explicit: boolean;
  hemis: Array<{ code: string; name: string; building: string }>;
  active: boolean;
  active_from: string | null;
  active_to: string | null;
  lessons_week: number;
  /** O'tgan va shu hafta: shu xonadagi NAZORATDAGI darslar (klinik fan, amaliy mashg'ulot). */
  scope_lessons?: number;
  scope_teachers?: number;
  scope_subjects?: string[];
  note: string;
};

export type MonitorDepartment = { id: number; row: number; name: string; clinical?: boolean; rooms: MonitorRoom[] };

export type MonitorRoomsData = {
  departments: MonitorDepartment[];
  hemis_rooms_count: number;
  hemis_error: string;
  scope_from?: string;
  scope_to?: string;
  sync: { running: boolean; started: string | null; finished: string | null; error: string; result: { monitorli?: number; oraliq?: string } | null };
  today: string;
};

export type HemisRoom = { code: string; name: string; building: string; building_key: string; active: boolean; monitors: string[] };

export const fetchMonitorRooms = () => call<MonitorRoomsData>('');
export const fetchHemisRooms = (refresh = false) => call<{ rooms: HemisRoom[] }>(`hemis-rooms/${refresh ? '?refresh=true' : ''}`);
export const addMonitorDepartment = (name: string) => call<{ id: number }>('departments/', { method: 'POST', body: { name } });
export const renameMonitorDepartment = (id: number, name: string) => call(`departments/${id}/`, { method: 'PATCH', body: { name } });
export const addMonitorRoom = (department_id: number, hemis_codes: string[], room_full = '') =>
  call<{ id: number; monitor_id: string }>('rooms/', { method: 'POST', body: { department_id, hemis_codes, room_full } });
export const updateMonitorRoom = (id: number, patch: { room_full?: string; hemis_codes?: string[]; note?: string }) =>
  call(`rooms/${id}/`, { method: 'PATCH', body: patch });
export const removeMonitorRoom = (id: number) => call(`rooms/${id}/`, { method: 'DELETE' });
export const restoreMonitorRoom = (id: number) => call(`rooms/${id}/restore/`, { method: 'POST', body: {} });
export const resyncMonitorRooms = () => call<{ started: boolean }>('resync/', { method: 'POST', body: {} });

/** «Nazoratdagi fanlar» — amaliy mashg'ulotli fan klinikmi (2026-11-16). */
export type ScopeSubject = {
  key: string;
  name: string;
  departments: string[];
  lessons: number;
  monitor_lessons: number;
  teachers: number;
  monitor_teachers: number;
  auto: boolean;
  auto_mixed: boolean;
  reason: string;
  override: boolean | null;
  clinical: boolean;
  excluded: boolean;
};

export type ScopeSubjectsData = {
  subjects: ScopeSubject[];
  from: string;
  to: string;
  summary: { subjects: number; clinical: number; lessons: number; clinical_lessons: number; clinical_monitor_lessons: number };
};

export const fetchScopeSubjects = () => call<ScopeSubjectsData>('subjects/');
export const setSubjectScope = (name: string, clinical: boolean | null) =>
  call<{ key: string; override: boolean | null }>('subjects/', { method: 'PATCH', body: { name, clinical } });

/** «Monitorli xonalar» — HEMIS'dagi hamma faol xonalar, monitor qo'lda belgilanadi (2026-11-16). */
export type CatalogMonitor = {
  id: number;
  monitor_id: string;
  room_full: string;
  department: string;
  active_from: string | null;
  lessons_total: number;
  note: string;
};

export type CatalogRoom = {
  code: string;
  name: string;
  label: string;
  floor: string;
  building: string;
  building_key: string;
  type: string;
  volume: number;
  monitor: CatalogMonitor | null;
  conflict: boolean;
  lessons: number;
  scope_lessons: number;
  scope_teachers: number;
  subjects: string[];
  departments: string[];
};

export type CatalogHistory = {
  id: number;
  at: string | null;
  by: string;
  action: 'on' | 'off' | 'relink' | 'dedupe' | 'retire' | 'undo';
  monitor_id: string;
  code: string;
  room: string;
  detail: string;
  undone: boolean;
};

export type RoomsCatalog = {
  rooms: CatalogRoom[];
  conflicts: {
    duplicates: Array<{ code: string; name: string; building: string; monitors: CatalogMonitor[] }>;
    unmatched: CatalogMonitor[];
    shared: Array<CatalogMonitor & { rooms: Array<{ code: string; name: string; building: string }> }>;
  };
  history: CatalogHistory[];
  window: { from: string; to: string };
  sync: MonitorRoomsData['sync'];
  today: string;
};

export const fetchRoomsCatalog = () => call<RoomsCatalog>('catalog/');
export const applyRoomChanges = (changes: Array<{ code: string; on: boolean }>) =>
  call<{ applied: number; errors: Array<{ code: string; error: string }> }>('catalog/apply/', { method: 'POST', body: { changes } });
export const resolveDuplicateMonitor = (code: string, keep_id: number) =>
  call<{ kept: string }>(`catalog/duplicates/${encodeURIComponent(code)}/`, { method: 'POST', body: { keep_id } });
export const relinkMonitor = (roomId: number, code: string) =>
  call<{ monitor_id: string }>(`catalog/relink/${roomId}/`, { method: 'POST', body: { code } });
export const retireMonitor = (roomId: number) => call(`catalog/retire/${roomId}/`, { method: 'POST', body: {} });
export const undoMonitorChange = (logId: number) => call(`catalog/undo/${logId}/`, { method: 'POST', body: {} });
