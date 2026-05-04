import { getCurrentLocalUser, normalizeUserRole } from './localStaffAuth';
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

export async function getBackendAccessToken(): Promise<string | null> {
  const now = Date.now();
  const leewayMs = 30_000;
  const cached = readCached();
  if (cached?.access && cached.accessExpMs - leewayMs > now) {
    return cached.access;
  }
  const renewed = await localLoginAndGetTokens();
  return renewed?.access ?? null;
}

