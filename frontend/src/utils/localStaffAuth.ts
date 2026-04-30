import { logStaffActivity } from './staffActivityLog';

/** admin — to‘liq kirish; hodim — tarjimadan boshqa modullar; tarjimon — faqat tarjima */
export type UserRole = 'admin' | 'hodim' | 'tarjimon';

export interface LocalStaffUser {
  uid: string;
  displayName: string;
  firstName: string;
  lastName: string;
  phoneDisplay: string;
  phoneDigits: string;
  faculty: string;
  department: string;
  direction: string;
  email: string;
  password: string;
  /** Agar eski hisoblarda bo‘lmasa, `hodim` deb qabul qilinadi */
  role?: UserRole;
  createdAt: number;
  updatedAt?: number;
  /** Unix ms — oxirgi kirish yoki tizimdagi so‘nggi faollik */
  lastActiveAt?: number;
  photoURL?: string | null;
}

const USERS_KEY = 'salomatlik-local-staff-users-v1';
const SESSION_KEY = 'salomatlik-local-staff-session-v1';
const AUTH_EVENT = 'salomatlik-local-auth-changed';

export const TEST_STAFF_PHONE = '+998901112233';
export const TEST_STAFF_PASSWORD = 'TestHodim123';

export const TEST_ADMIN_PHONE = '+998901110001';
export const TEST_ADMIN_PASSWORD = 'AdminDemo123';

export const TEST_TARJIMON_PHONE = '+998901110002';
export const TEST_TARJIMON_PASSWORD = 'TarjimaDemo123';

/** Demo kirish uchun (login sahifasi) */
export const DEMO_ROLE_LOGINS: {
  role: UserRole;
  title: string;
  subtitle: string;
  phone: string;
  password: string;
}[] = [
  {
    role: 'admin',
    title: 'Admin',
    subtitle: 'Barcha modullar',
    phone: TEST_ADMIN_PHONE,
    password: TEST_ADMIN_PASSWORD,
  },
  {
    role: 'hodim',
    title: 'Hodim',
    subtitle: 'Ta‘lim modullari (tarjimasiz)',
    phone: TEST_STAFF_PHONE,
    password: TEST_STAFF_PASSWORD,
  },
  {
    role: 'tarjimon',
    title: 'Tarjimon',
    subtitle: 'Faqat tarjima',
    phone: TEST_TARJIMON_PHONE,
    password: TEST_TARJIMON_PASSWORD,
  },
];

export function normalizeUserRole(user: LocalStaffUser | null | undefined): UserRole {
  const r = user?.role;
  if (r === 'admin' || r === 'hodim' || r === 'tarjimon') return r;
  return 'hodim';
}

function withRoleDefault(u: LocalStaffUser): LocalStaffUser {
  return { ...u, role: normalizeUserRole(u) };
}

function upsertDemoUser(user: LocalStaffUser): void {
  const users = readUsers();
  const idx = users.findIndex((x) => x.phoneDigits === user.phoneDigits);
  if (idx >= 0) {
    const merged: LocalStaffUser = {
      ...users[idx],
      ...user,
      uid: users[idx].uid,
      phoneDigits: user.phoneDigits,
      password: user.password,
      role: user.role,
      createdAt: users[idx].createdAt,
      updatedAt: Date.now(),
    };
    users[idx] = merged;
  } else {
    users.unshift(user);
  }
  writeUsers(users);
}

/** Uchta demo rol uchun login/parol bilan foydalanuvchilarni yaratadi yoki yangilaydi */
export function ensureDefaultRoleDemosExist(): void {
  const now = Date.now();

  upsertDemoUser({
    uid: `demo_admin_${now}`,
    displayName: 'Demo Admin',
    firstName: 'Demo',
    lastName: 'Admin',
    phoneDisplay: TEST_ADMIN_PHONE,
    phoneDigits: normalizePhoneDigits(TEST_ADMIN_PHONE),
    faculty: 'Administrator',
    department: 'Tizim',
    direction: 'To‘liq kirish',
    email: phoneDigitsToEmail(normalizePhoneDigits(TEST_ADMIN_PHONE)),
    password: TEST_ADMIN_PASSWORD,
    role: 'admin',
    createdAt: now,
    updatedAt: now,
    photoURL: null,
  });

  upsertDemoUser({
    uid: `demo_hodim_${now}`,
    displayName: 'Test Hodim',
    firstName: 'Test',
    lastName: 'Hodim',
    phoneDisplay: TEST_STAFF_PHONE,
    phoneDigits: normalizePhoneDigits(TEST_STAFF_PHONE),
    faculty: 'Tibbiyot fakulteti',
    department: 'Ichki kasalliklar kafedrasi',
    direction: "Terapiya yo'nalishi",
    email: phoneDigitsToEmail(normalizePhoneDigits(TEST_STAFF_PHONE)),
    password: TEST_STAFF_PASSWORD,
    role: 'hodim',
    createdAt: now,
    updatedAt: now,
    photoURL: null,
  });

  upsertDemoUser({
    uid: `demo_tarjimon_${now}`,
    displayName: 'Demo Tarjimon',
    firstName: 'Demo',
    lastName: 'Tarjimon',
    phoneDisplay: TEST_TARJIMON_PHONE,
    phoneDigits: normalizePhoneDigits(TEST_TARJIMON_PHONE),
    faculty: 'Tarjima',
    department: 'Tillar',
    direction: 'Tarjimon',
    email: phoneDigitsToEmail(normalizePhoneDigits(TEST_TARJIMON_PHONE)),
    password: TEST_TARJIMON_PASSWORD,
    role: 'tarjimon',
    createdAt: now,
    updatedAt: now,
    photoURL: null,
  });
}

/** @deprecated ensureDefaultRoleDemosExist ishlating */
export function ensureDefaultTestStaffExists(): void {
  ensureDefaultRoleDemosExist();
}

function readUsers(): LocalStaffUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalStaffUser[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUsers(users: LocalStaffUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function emitAuthChanged(): void {
  window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}

export function subscribeLocalAuth(listener: () => void): () => void {
  const handler = () => listener();
  window.addEventListener(AUTH_EVENT, handler);
  return () => window.removeEventListener(AUTH_EVENT, handler);
}

export function getCurrentLocalUser(): LocalStaffUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as LocalStaffUser;
    return withRoleDefault(u);
  } catch {
    return null;
  }
}

export function normalizePhoneDigits(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 9) return `998${digits}`;
  if (digits.length === 12 && digits.startsWith('998')) return digits;
  if (digits.length === 10 && digits.startsWith('0')) return `998${digits.slice(1)}`;
  return digits;
}

export function isValidPhoneDigits(digits: string): boolean {
  return digits.length === 12 && digits.startsWith('998');
}

export function phoneDigitsToEmail(digits: string): string {
  return `phone_${digits}@local.staff`;
}

export interface RegisterLocalInput {
  phoneDisplay: string;
  password: string;
  firstName: string;
  lastName: string;
  faculty: string;
  department: string;
  direction: string;
}

export function registerLocalStaff(input: RegisterLocalInput): LocalStaffUser {
  const digits = normalizePhoneDigits(input.phoneDisplay);
  if (!isValidPhoneDigits(digits)) throw new Error('invalid-phone');
  if (input.password.length < 6) throw new Error('weak-password');

  const users = readUsers();
  const exists = users.some((u) => u.phoneDigits === digits);
  if (exists) throw new Error('already-exists');

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const now = Date.now();
  const user: LocalStaffUser = {
    uid: `local_${now}_${Math.random().toString(36).slice(2, 8)}`,
    displayName: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    phoneDisplay: input.phoneDisplay.trim(),
    phoneDigits: digits,
    faculty: input.faculty.trim(),
    department: input.department.trim(),
    direction: input.direction.trim(),
    email: phoneDigitsToEmail(digits),
    password: input.password,
    role: 'hodim',
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
    photoURL: null,
  };
  users.unshift(user);
  writeUsers(users);
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  emitAuthChanged();
  logStaffActivity({
    kind: 'register',
    uid: user.uid,
    displayName: user.displayName,
    role: normalizeUserRole(user),
    phoneDigits: user.phoneDigits,
  });
  return user;
}

const LAST_ACTIVE_MIN_TOUCH_MS = 60_000;

/**
 * Joriy sessiya bo‘yicha foydalanuvchining `lastActiveAt`ini yangilaydi (throttle).
 * Kirishdan tashqari — sahifa ochilganda yoki oynaga qaytishda chaqiriladi.
 */
export function touchCurrentUserActivityIfNeeded(): void {
  const session = getCurrentLocalUser();
  if (!session) return;
  const users = readUsers();
  const idx = users.findIndex((u) => u.uid === session.uid);
  if (idx < 0) return;
  const prev = users[idx].lastActiveAt ?? 0;
  const now = Date.now();
  if (now - prev < LAST_ACTIVE_MIN_TOUCH_MS) return;
  const updated: LocalStaffUser = {
    ...withRoleDefault(users[idx]),
    lastActiveAt: now,
    updatedAt: now,
  };
  users[idx] = updated;
  writeUsers(users);
  localStorage.setItem(SESSION_KEY, JSON.stringify(updated));
  emitAuthChanged();
}

export function loginLocalStaff(phoneInput: string, password: string): LocalStaffUser {
  const digits = normalizePhoneDigits(phoneInput);
  const users = readUsers();
  const idx = users.findIndex((u) => u.phoneDigits === digits);
  if (idx < 0) throw new Error('user-not-found');
  if (users[idx].password !== password) throw new Error('wrong-password');
  const now = Date.now();
  const sessionUser = withRoleDefault({
    ...users[idx],
    lastActiveAt: now,
    updatedAt: now,
  });
  users[idx] = sessionUser;
  writeUsers(users);
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
  emitAuthChanged();
  logStaffActivity({
    kind: 'login',
    uid: sessionUser.uid,
    displayName: sessionUser.displayName,
    role: normalizeUserRole(sessionUser),
    phoneDigits: sessionUser.phoneDigits,
  });
  return sessionUser;
}

export function updateCurrentLocalUser(
  patch: Partial<Pick<LocalStaffUser, 'firstName' | 'lastName' | 'displayName' | 'phoneDisplay' | 'faculty' | 'department' | 'direction' | 'password'>>
): LocalStaffUser {
  const current = getCurrentLocalUser();
  if (!current) throw new Error('not-authenticated');
  const users = readUsers();
  const idx = users.findIndex((u) => u.uid === current.uid);
  if (idx < 0) throw new Error('not-found');

  const updated: LocalStaffUser = withRoleDefault({
    ...users[idx],
    ...patch,
    updatedAt: Date.now(),
  });
  if (updated.phoneDisplay) {
    const digits = normalizePhoneDigits(updated.phoneDisplay);
    if (isValidPhoneDigits(digits)) {
      updated.phoneDigits = digits;
      updated.email = phoneDigitsToEmail(digits);
    }
  }
  users[idx] = updated;
  writeUsers(users);
  localStorage.setItem(SESSION_KEY, JSON.stringify(updated));
  emitAuthChanged();
  return updated;
}

export function logoutLocalStaff(): void {
  const current = getCurrentLocalUser();
  if (current) {
    logStaffActivity({
      kind: 'logout',
      uid: current.uid,
      displayName: current.displayName,
      role: normalizeUserRole(current),
      phoneDigits: current.phoneDigits,
    });
  }
  localStorage.removeItem(SESSION_KEY);
  emitAuthChanged();
}

function assertAdmin(): void {
  const u = getCurrentLocalUser();
  if (!u || normalizeUserRole(u) !== 'admin') {
    throw new Error('forbidden');
  }
}

/** Barcha hisoblar (faqat administrator uchun UI) */
export function listAllStaffUsers(): LocalStaffUser[] {
  assertAdmin();
  return readUsers().map(withRoleDefault);
}

export interface AdminMutateStaffInput {
  phoneDisplay: string;
  password: string;
  firstName: string;
  lastName: string;
  faculty: string;
  department: string;
  direction: string;
  role: UserRole;
}

export function adminCreateStaffUser(input: AdminMutateStaffInput): LocalStaffUser {
  assertAdmin();
  const digits = normalizePhoneDigits(input.phoneDisplay);
  if (!isValidPhoneDigits(digits)) throw new Error('invalid-phone');
  if (input.password.length < 6) throw new Error('weak-password');
  const users = readUsers();
  if (users.some((u) => u.phoneDigits === digits)) throw new Error('already-exists');

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const now = Date.now();
  const user: LocalStaffUser = {
    uid: `local_${now}_${Math.random().toString(36).slice(2, 8)}`,
    displayName: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    phoneDisplay: input.phoneDisplay.trim(),
    phoneDigits: digits,
    faculty: input.faculty.trim(),
    department: input.department.trim(),
    direction: input.direction.trim(),
    email: phoneDigitsToEmail(digits),
    password: input.password,
    role: input.role,
    createdAt: now,
    updatedAt: now,
    photoURL: null,
  };
  users.unshift(user);
  writeUsers(users);
  emitAuthChanged();
  return user;
}

export function adminUpdateStaffUser(
  uid: string,
  patch: Partial<
    Pick<
      LocalStaffUser,
      | 'firstName'
      | 'lastName'
      | 'displayName'
      | 'phoneDisplay'
      | 'faculty'
      | 'department'
      | 'direction'
      | 'password'
      | 'role'
    >
  >
): LocalStaffUser {
  assertAdmin();
  const users = readUsers();
  const idx = users.findIndex((u) => u.uid === uid);
  if (idx < 0) throw new Error('not-found');

  const existing = withRoleDefault(users[idx]);
  const merged: LocalStaffUser = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  };
  if (patch.phoneDisplay) {
    const d = normalizePhoneDigits(patch.phoneDisplay);
    if (isValidPhoneDigits(d) && d !== existing.phoneDigits) {
      if (users.some((u, i) => i !== idx && u.phoneDigits === d)) {
        throw new Error('phone-exists');
      }
      merged.phoneDigits = d;
      merged.email = phoneDigitsToEmail(d);
    }
  }
  if (merged.firstName || merged.lastName) {
    merged.displayName = `${merged.firstName} ${merged.lastName}`.trim();
  }
  if (patch.role !== undefined && normalizeUserRole(existing) === 'admin') {
    const adminCount = users.filter((u) => normalizeUserRole(withRoleDefault(u)) === 'admin').length;
    if (adminCount <= 1 && patch.role !== 'admin') {
      throw new Error('last-admin');
    }
  }
  users[idx] = merged;
  writeUsers(users);

  const session = getCurrentLocalUser();
  if (session?.uid === uid) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(merged));
  }
  emitAuthChanged();
  return merged;
}

export function adminDeleteStaffUser(uid: string): void {
  assertAdmin();
  const current = getCurrentLocalUser()!;
  if (current.uid === uid) throw new Error('cannot-delete-self');
  const users = readUsers();
  const target = users.find((u) => u.uid === uid);
  if (!target) throw new Error('not-found');
  if (normalizeUserRole(withRoleDefault(target)) === 'admin') {
    const admins = users.filter((u) => normalizeUserRole(withRoleDefault(u)) === 'admin').length;
    if (admins <= 1) throw new Error('last-admin');
  }
  writeUsers(users.filter((u) => u.uid !== uid));
  emitAuthChanged();
}

