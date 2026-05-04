/**
 * Veb-ilovada "kompyuter vs telefon" taxminiy ajratish.
 * 100% ishonchli emas (planshet, katta telefon) — faqat UI maslahati uchun.
 */
export function isLikelyPhoneOrSmallTablet(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const narrow = window.matchMedia('(max-width: 640px)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    return narrow || (coarse && window.matchMedia('(max-width: 900px)').matches);
  } catch {
    return window.innerWidth < 640;
  }
}

export function isHodimMobileHintDismissed(): boolean {
  try {
    return localStorage.getItem('imentor-hodim-mobile-hint-v1') === '1';
  } catch {
    return false;
  }
}

export function dismissHodimMobileHint(): void {
  try {
    localStorage.setItem('imentor-hodim-mobile-hint-v1', '1');
  } catch {
    /* ignore */
  }
}
