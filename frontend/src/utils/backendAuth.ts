import {
  establishLocalSessionFromProfile,
  getCurrentLocalUser,
  loginLocalStaff,
  normalizePhoneDigits,
  normalizeUserRole,
  phoneDigitsToEmail,
  registerLocalStaff,
  syncCurrentUserRoleFromServer,
  type LocalStaffUser,
  type UserRole,
} from './localStaffAuth';
import { HttpError, httpJson } from '../api/httpClient';

type BackendTokenBundle = {
  access: string;
  refresh: string;
  role: 'admin' | 'hodim' | 'tarjimon' | 'startuper';
  username: string;
  first_name?: string;
  last_name?: string;
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

export async function performBackendLocalLogin(input: {
  phone_digits: string;
  password: string;
  role?: UserRole;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  register?: boolean;
}): Promise<BackendTokenBundle> {
  const body: Record<string, string | boolean> = {
    phone_digits: input.phone_digits,
    password: input.password,
    first_name: input.first_name ?? '',
    last_name: input.last_name ?? '',
    display_name: input.display_name ?? '',
  };
  if (input.role) body.role = input.role;
  if (input.register) body.register = true;
  return httpJson<BackendTokenBundle>(`${apiBaseUrl()}/v1/auth/local-login/`, {
    method: 'POST',
    body,
  });
}

function findStoredUserByPhone(digits: string): LocalStaffUser | null {
  try {
    const raw = localStorage.getItem('salomatlik-local-staff-users-v1');
    if (!raw) return null;
    const users = JSON.parse(raw) as LocalStaffUser[];
    if (!Array.isArray(users)) return null;
    return users.find((u) => u.phoneDigits === digits) ?? null;
  } catch {
    return null;
  }
}

function buildLocalUserFromBackendLogin(
  phoneInput: string,
  password: string,
  bundle: BackendTokenBundle,
  existing?: LocalStaffUser | null,
): LocalStaffUser {
  const digits = normalizePhoneDigits(phoneInput);
  const now = Date.now();
  const firstName = existing?.firstName || bundle.first_name || '';
  const lastName = existing?.lastName || bundle.last_name || '';
  const displayName =
    existing?.displayName || `${firstName} ${lastName}`.trim() || phoneInput.trim() || digits;
  return {
    uid: existing?.uid ?? `local_${now}_${Math.random().toString(36).slice(2, 8)}`,
    displayName,
    firstName,
    lastName,
    phoneDisplay: existing?.phoneDisplay ?? phoneInput.trim(),
    phoneDigits: digits,
    faculty: existing?.faculty ?? '',
    department: existing?.department ?? '',
    direction: existing?.direction ?? '',
    email: phoneDigitsToEmail(digits),
    password,
    role: bundle.role,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastActiveAt: now,
    photoURL: existing?.photoURL ?? null,
    participantKind: existing?.participantKind,
    studyGroup: existing?.studyGroup,
    jobTitle: existing?.jobTitle,
  };
}

async function localLoginAndGetTokens(): Promise<CachedBundle | null> {
  const user = getCurrentLocalUser();
  if (!user?.phoneDigits) return null;

  const password = user.password;
  if (!password) {
    return readCached();
  }

  const resp = await performBackendLocalLogin({
    phone_digits: user.phoneDigits,
    password,
    first_name: user.firstName,
    last_name: user.lastName,
    display_name: user.displayName,
  });
  return writeCached(resp);
}

/**
 * Server — asosiy manba. Mahalliy hisob profil keshi.
 * Boshqa qurilmada (telefon) kirish va desync holatlarini hal qiladi.
 */
export async function loginStaffWithBackendFallback(
  phoneInput: string,
  password: string,
): Promise<LocalStaffUser> {
  const digits = normalizePhoneDigits(phoneInput);
  let localMatched: LocalStaffUser | null = null;
  try {
    localMatched = loginLocalStaff(phoneInput, password);
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code !== 'user-not-found' && code !== 'wrong-password') throw err;
  }

  try {
    const bundle = await performBackendLocalLogin({
      phone_digits: digits,
      password,
    });
    writeCached(bundle);
    const existing = localMatched ?? findStoredUserByPhone(digits);
    return establishLocalSessionFromProfile(
      buildLocalUserFromBackendLogin(phoneInput, password, bundle, existing),
    );
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 401) throw new Error('wrong-password');
      if (err.status === 409) throw new Error('already-exists');
    }
    if (localMatched) return localMatched;
    throw err;
  }
}

/** Ro‘yxatdan o‘tish: avval server, keyin mahalliy profil. */
export async function registerStaffWithBackend(input: {
  phoneDisplay: string;
  password: string;
  firstName: string;
  lastName: string;
  faculty: string;
  department: string;
  direction: string;
  role: UserRole;
  participantKind?: 'student' | 'employee';
  studyGroup?: string;
  jobTitle?: string;
}): Promise<LocalStaffUser> {
  const digits = normalizePhoneDigits(input.phoneDisplay);
  const bundle = await performBackendLocalLogin({
    phone_digits: digits,
    password: input.password,
    role: input.role,
    first_name: input.firstName,
    last_name: input.lastName,
    display_name: `${input.firstName} ${input.lastName}`.trim(),
    register: true,
  });
  writeCached(bundle);

  try {
    return registerLocalStaff(input);
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'already-exists') {
      return establishLocalSessionFromProfile(
        buildLocalUserFromBackendLogin(input.phoneDisplay, input.password, bundle, null),
      );
    }
    throw err;
  }
}

/** Admin xodim yaratganda/yangilaganda server bazasiga yozadi (JWT saqlanmaydi). */
export async function provisionBackendStaffAccount(input: {
  phone_digits: string;
  password: string;
  role: UserRole;
  first_name?: string;
  last_name?: string;
}): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-admin-token');
  await httpJson(`${apiBaseUrl()}/v1/auth/admin-provision-staff/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      phone_digits: input.phone_digits,
      password: input.password,
      role: input.role,
      first_name: input.first_name ?? '',
      last_name: input.last_name ?? '',
    },
  });
}

/** Admin xodimni serverdan o‘chiradi. */
export async function deprovisionBackendStaffAccount(phone_digits: string): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-admin-token');
  await httpJson(`${apiBaseUrl()}/v1/auth/admin-deprovision-staff/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { phone_digits },
  });
}

/** Profil paroli o‘zgarganda serverni yangilash. */
export async function syncCurrentUserPasswordToBackend(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson(`${apiBaseUrl()}/v1/auth/change-password/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      current_password: currentPassword,
      new_password: newPassword,
    },
  });
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
  return renewed?.access ?? cached?.access ?? null;
}

/** AI va boshqa JWT API lar uchun — token yo‘q bo‘lsa aniq xato */
export async function ensureBackendAccessToken(): Promise<string> {
  const token = await getBackendAccessToken();
  if (!token) {
    throw new Error('no-backend-token');
  }
  return token;
}
