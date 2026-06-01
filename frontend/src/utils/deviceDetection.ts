/**
 * Veb-ilovada "kompyuter vs telefon" taxminiy ajratish.
 * 100% ishonchli emas (planshet, katta telefon) — faqat UI maslahati uchun.
 */
/** Keng ekran / kompyuter (hodim QR kirish) */
export function isDesktopBrowser(): boolean {
  return !isLikelyPhoneOrSmallTablet();
}

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
