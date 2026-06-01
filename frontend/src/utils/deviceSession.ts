import type { LocalStaffUser } from './localStaffAuth';

const DESKTOP_PAIR_FLAG = 'imentor-desktop-paired-v1';

export function markDesktopPairedSession(): void {
  try {
    sessionStorage.setItem(DESKTOP_PAIR_FLAG, '1');
  } catch {
    /* ignore */
  }
}

export function isDesktopPairedSession(): boolean {
  try {
    return sessionStorage.getItem(DESKTOP_PAIR_FLAG) === '1';
  } catch {
    return false;
  }
}

export function clearDesktopPairedSession(): void {
  try {
    sessionStorage.removeItem(DESKTOP_PAIR_FLAG);
  } catch {
    /* ignore */
  }
}

export function shouldHodimUseMobileCompanion(user: LocalStaffUser | null): boolean {
  if (!user || (user.role ?? 'hodim') !== 'hodim') return false;
  return !isDesktopPairedSession();
}
