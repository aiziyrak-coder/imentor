import {
  getCurrentLocalUser,
  normalizeUserRole,
  syncCurrentUserRoleFromServer,
} from './localStaffAuth';
import { httpJson } from '../api/httpClient';

type BackendTokenBundle = {
  access: string;
  refresh: string;
  role: 'admin' | 'hodim' | 'tarjimon' | 'startuper';
  username: string;
};

type CachedBundle = BackendTokenBundle & {
  accessExpMs: number;
  refreshExpMs: number;
};

const TOKEN_KEY = 'salomatlik-backend-jwt-v1';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

function decodeJwtExpMs(token: string): number {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return 0;
    const payload = JSON.parse(atob(parts[1]));
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function readCached(): CachedBundle | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedBundle;
  } catch {
    return null;
  }
}

function writeCached(bundle: BackendTokenBundle): CachedBundle {
  syncCurrentUserRoleFromServer(bundle.role);
  const next: CachedBundle = {
    ...bundle,
    accessExpMs: decodeJwtExpMs(bundle.access),
    refreshExpMs: decodeJwtExpMs(bundle.refresh),
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(next));
  return next;
}

export function clearBackendAuthTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** QR juftlashdan keyin kompyuter JWT saqlash */
export function writeBackendTokensFromPair(bundle: {
  access: string;
  refresh: string;
  role: BackendTokenBundle['role'];
  username: string;
}): void {
  writeCached({
    access: bundle.access,
    refresh: bundle.refresh,
    role: bundle.role,
    username: bundle.username,
  });
}

async function localLoginAndGetTokens(): Promise<CachedBundle | null> {
  const user = getCurrentLocalUser();
  if (!user?.phoneDigits || !user?.password) return null;

  const resp = await httpJson<BackendTokenBundle>(`${apiBaseUrl()}/v1/auth/local-login/`, {
    method: 'POST',
    body: {
      phone_digits: user.phoneDigits,
      password: user.password,
      role: normalizeUserRole(user),
      first_name: user.firstName,
      last_name: user.lastName,
      display_name: user.displayName,
    },
  });
  return writeCached(resp);
}

async function refreshAccessToken(cached: CachedBundle): Promise<CachedBundle | null> {
  if (!cached.refresh) return null;
  const now = Date.now();
  const leewayMs = 30_000;
  if (cached.refreshExpMs > 0 && cached.refreshExpMs - leewayMs <= now) return null;
  try {
    const resp = await httpJson<{ access: string; refresh?: string }>(
      `${apiBaseUrl()}/v1/auth/token/refresh/`,
      {
        method: 'POST',
        body: { refresh: cached.refresh },
        timeoutMs: 20000,
      },
    );
    if (!resp.access) return null;
    return writeCached({
      access: resp.access,
      refresh: resp.refresh || cached.refresh,
      role: cached.role,
      username: cached.username,
    });
  } catch {
    return null;
  }
}

export async function getBackendAccessToken(): Promise<string | null> {
  const now = Date.now();
  const leewayMs = 30_000;
  let cached = readCached();
  const localUser = getCurrentLocalUser();
  if (localUser && cached && normalizeUserRole(localUser) !== cached.role) {
    clearBackendAuthTokens();
    cached = null;
  }
  if (cached?.access && cached.accessExpMs - leewayMs > now) {
    return cached.access;
  }
  if (cached?.refresh) {
    const refreshed = await refreshAccessToken(cached);
    if (refreshed?.access) return refreshed.access;
  }
  const renewed = await localLoginAndGetTokens();
  return renewed?.access ?? null;
}

/** AI va boshqa JWT API lar uchun — token yo‘q bo‘lsa aniq xato */
export async function ensureBackendAccessToken(): Promise<string> {
  const token = await getBackendAccessToken();
  if (!token) {
    throw new Error('no-backend-token');
  }
  return token;
}

