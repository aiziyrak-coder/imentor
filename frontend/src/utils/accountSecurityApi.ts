import { httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';

/** Hisob xavfsizligi (2026-11-17): "faqat parol bilan kirish", barcha qurilmalardan chiqish, admin sessiyani yopadi. */

export type AccountSecurity = {
  /** Parolsiz (Xodim ID / JSHSHIR / pasport) kirish yopiq. */
  password_only: boolean;
  /** Mahalliy paroli bor — himoyani faqat shunda yoqish mumkin. */
  has_password: boolean;
  /** Sozlama faqat o'qituvchi hisobi uchun. */
  can_set: boolean;
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

export async function fetchAccountSecurity(): Promise<AccountSecurity> {
  return httpJson(`${apiBaseUrl()}/v1/auth/me/security/`, { headers: await authHeaders(), timeoutMs: 20000 });
}

export async function setPasswordOnly(value: boolean): Promise<AccountSecurity> {
  return httpJson(`${apiBaseUrl()}/v1/auth/me/security/`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: { password_only: value },
    timeoutMs: 20000,
  });
}

/** Barcha qurilmalardagi sessiyalarni (shu qurilma ham) yopadi. */
export async function logoutEverywhere(): Promise<void> {
  await httpJson(`${apiBaseUrl()}/v1/auth/logout-all/`, {
    method: 'POST',
    headers: await authHeaders(),
    timeoutMs: 20000,
  });
}

/** Admin: xodimning barcha ochiq sessiyalarini yopadi (hisob begona qo'lga tushganda). */
export async function adminRevokeSessions(username: string): Promise<void> {
  await httpJson(`${apiBaseUrl()}/v1/admin/staff/${encodeURIComponent(username)}/revoke-sessions/`, {
    method: 'POST',
    headers: await authHeaders(),
    timeoutMs: 20000,
  });
}
