import type { LocalStaffUser } from './localStaffAuth';
import { isLikelyPhoneOrSmallTablet } from './deviceDetection';

const DESKTOP_PAIR_FLAG = 'imentor-desktop-paired-v1';

function pairKey(uid?: string): string {
  return uid ? `${DESKTOP_PAIR_FLAG}:${uid}` : DESKTOP_PAIR_FLAG;
}

export function markDesktopPairedSession(uid?: string): void {
  try {
    if (uid) localStorage.setItem(pairKey(uid), '1');
    localStorage.setItem(DESKTOP_PAIR_FLAG, '1');
    sessionStorage.setItem(DESKTOP_PAIR_FLAG, '1');
  } catch {
    /* ignore */
  }
}

export function isDesktopPairedSession(uid?: string): boolean {
  try {
    if (uid && localStorage.getItem(pairKey(uid)) === '1') return true;
    if (localStorage.getItem(DESKTOP_PAIR_FLAG) === '1') return true;
    return sessionStorage.getItem(DESKTOP_PAIR_FLAG) === '1';
  } catch {
    return false;
  }
}

export function clearDesktopPairedSession(uid?: string): void {
  try {
    if (uid) localStorage.removeItem(pairKey(uid));
    localStorage.removeItem(DESKTOP_PAIR_FLAG);
    sessionStorage.removeItem(DESKTOP_PAIR_FLAG);
  } catch {
    /* ignore */
  }
}

/** Hodim mobil hamroh: faqat telefon/planshetda (kompyuterda QR skaner emas). */
export function shouldHodimUseMobileCompanion(user: LocalStaffUser | null): boolean {
  if (!user || (user.role ?? 'hodim') !== 'hodim') return false;
  return isLikelyPhoneOrSmallTablet();
}
