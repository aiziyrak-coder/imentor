/**
 * Veb-ilovada "kompyuter vs telefon" taxminiy ajratish.
 * Sensorli noutbuklar telefon deb olinmasin (fine pointer + keng ekran).
 *
 * 2026-11-16: sinfdagi sensorli doska (Windows) Chrome oynasi KICHIK ochilgan bo'lsa telefon deb
 * olinardi — oyna tor (<640px) yoki sichqonchasiz sensor (pointer: coarse). Natija: o'qituvchi telefonda
 * «Kompyuter ulandi»ni ko'radi, doskada esa ish stoli o'rniga telefon sahifasi («Kompyuterni ulash»,
 * «Yuz orqali kirish — kamera topilmadi») chiqadi. Kompyuter OS'i (Windows / macOS / Linux / ChromeOS)
 * bo'lgan qurilma oyna o'lchamidan qat'i nazar KOMPYUTER. Istisno: «kompyuter versiyasi» yoqilgan
 * telefon (UA kompyuterniki, lekin ekrani telefonniki).
 */
export function isDesktopOsDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|webOS|iPhone|iPod|iPad|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) return false;
  if (!/Windows NT|Macintosh|X11|CrOS/i.test(ua)) return false;
  // iPadOS o'zini Macintosh deb ko'rsatadi.
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return false;
  // "Kompyuter versiyasi" rejimidagi telefon: ekranning qisqa tomoni telefonniki.
  const shortSide = Math.min(window.screen?.width || 0, window.screen?.height || 0);
  if (shortSide > 0 && shortSide < 600 && navigator.maxTouchPoints > 0) return false;
  return true;
}

export function isLikelyPhoneOrSmallTablet(): boolean {
  if (typeof window === 'undefined') return false;
  if (isDesktopOsDevice()) return false;

  const ua = navigator.userAgent || '';
  const mobileUa = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const ipadUa = /iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  try {
    const narrow = window.matchMedia('(max-width: 640px)').matches;
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    const wideScreen = window.matchMedia('(min-width: 1024px)').matches;
    const coarseSmall = window.matchMedia('(max-width: 768px) and (pointer: coarse)').matches;

    // Noutbuk / monitor: keng ekran + sichqoncha/trackpad
    if (wideScreen && finePointer) return false;

    if (mobileUa && (narrow || coarseSmall)) return true;
    if (ipadUa && !finePointer) return true;
    if (narrow) return true;
    if (coarseSmall && !finePointer) return true;

    return false;
  } catch {
    return window.innerWidth < 640 || (mobileUa && window.innerWidth < 900);
  }
}

/** Keng ekran / kompyuter (hodim QR kirish) */
export function isDesktopBrowser(): boolean {
  return !isLikelyPhoneOrSmallTablet();
}
