import { httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';

export type StaffScheduleSlotDto = {
  id: number;
  owner_key: string;
  weekday: number;
  start_time: string;
  end_time: string;
  building_name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  title: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type StaffLocationPingDto = {
  id: number;
  owner_key: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  recorded_at: string;
  client_ts_ms: number | null;
};

export type StaffLocationAlertDto = {
  id: number;
  owner_key: string;
  slot: number | null;
  building_name: string;
  expected_lat: number;
  expected_lng: number;
  actual_lat: number;
  actual_lng: number;
  distance_m: number;
  radius_m: number;
  slot_start: string | null;
  slot_end: string | null;
  message: string;
  created_at: string;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return { Authorization: `Bearer ${token}` };
}

export async function postStaffLocationPing(body: {
  latitude: number;
  longitude: number;
  accuracy_m?: number | null;
  client_ts_ms?: number | null;
}): Promise<{ ok: boolean; alerts_created: number; alert_ids: number[] }> {
  return httpJson(`${apiBaseUrl()}/v1/staff/location-ping/`, {
    method: 'POST',
    headers: await authHeaders(),
    body,
    timeoutMs: 20000,
  });
}

export async function getMyStaffSchedule(): Promise<StaffScheduleSlotDto[]> {
  const rows = await httpJson<StaffScheduleSlotDto[]>(`${apiBaseUrl()}/v1/staff/schedule/`, {
    headers: await authHeaders(),
    timeoutMs: 20000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function listAdminStaffSchedule(ownerKey?: string): Promise<StaffScheduleSlotDto[]> {
  const q = ownerKey?.trim() ? `?owner_key=${encodeURIComponent(ownerKey.trim())}` : '';
  const rows = await httpJson<StaffScheduleSlotDto[]>(`${apiBaseUrl()}/v1/admin/staff-schedule/${q}`, {
    headers: await authHeaders(),
    timeoutMs: 30000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function createAdminStaffSchedule(
  body: Omit<StaffScheduleSlotDto, 'id' | 'created_at' | 'updated_at'>
): Promise<StaffScheduleSlotDto> {
  return httpJson(`${apiBaseUrl()}/v1/admin/staff-schedule/`, {
    method: 'POST',
    headers: await authHeaders(),
    body,
    timeoutMs: 20000,
  });
}

export async function patchAdminStaffSchedule(
  id: number,
  body: Partial<Omit<StaffScheduleSlotDto, 'id' | 'created_at' | 'updated_at'>>
): Promise<StaffScheduleSlotDto> {
  return httpJson(`${apiBaseUrl()}/v1/admin/staff-schedule/${id}/`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body,
    timeoutMs: 20000,
  });
}

export async function deleteAdminStaffSchedule(id: number): Promise<void> {
  await httpJson<unknown>(`${apiBaseUrl()}/v1/admin/staff-schedule/${id}/`, {
    method: 'DELETE',
    headers: await authHeaders(),
    timeoutMs: 15000,
  });
}

export async function listAdminStaffPings(ownerKey?: string): Promise<StaffLocationPingDto[]> {
  const q = ownerKey?.trim() ? `?owner_key=${encodeURIComponent(ownerKey.trim())}` : '';
  const rows = await httpJson<StaffLocationPingDto[]>(`${apiBaseUrl()}/v1/admin/staff-location-pings/${q}`, {
    headers: await authHeaders(),
    timeoutMs: 30000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function listAdminStaffAlerts(ownerKey?: string): Promise<StaffLocationAlertDto[]> {
  const q = ownerKey?.trim() ? `?owner_key=${encodeURIComponent(ownerKey.trim())}` : '';
  const rows = await httpJson<StaffLocationAlertDto[]>(`${apiBaseUrl()}/v1/admin/staff-location-alerts/${q}`, {
    headers: await authHeaders(),
    timeoutMs: 30000,
  });
  return Array.isArray(rows) ? rows : [];
}
