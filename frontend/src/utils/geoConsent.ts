/**
 * Joylashuv ruxsati BIR MARTA so'raladi (2026-11-12, shikoyat: "har safar GPS'ga ruxsat so'rayvermasin").
 *
 * iPhone Safari saytga berilgan ruxsatni doimiy saqlamaydi: har `getCurrentPosition` / `watchPosition`
 * chaqiruvi yana oyna ochadi. Ilgari kuzatuv har sahifa ochilganda va har safar ilovaga qaytganda
 * chaqirilardi — o'qituvchi har gal "ruxsat berasizmi?" ko'rardi. Endi:
 *   * ruxsat berilgan bo'lsa (Permissions API `granted` yoki oldin muvaffaqiyatli olingan) — jim ishlaydi;
 *   * hali hech so'ralmagan bo'lsa — bir marta so'raladi;
 *   * so'ralgan-u, berilmagan bo'lsa — avtomatik QAYTA so'ralmaydi, faqat "Ruxsat berish" tugmasi bilan.
 */
const KEY = 'imentor-geo-consent-v1';

type Stored = 'asked' | 'granted' | 'denied';

function read(): Stored | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'asked' || v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

function write(v: Stored): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* xotira yopiq — keyingi safar yana bir marta so'raladi */
  }
}

export function markGeoGranted(): void {
  write('granted');
}

export function markGeoFailed(err: GeolocationPositionError | { code?: number } | null | undefined): void {
  write(err?.code === 1 ? 'denied' : read() === 'granted' ? 'granted' : 'asked');
}

async function permissionState(): Promise<PermissionState | null> {
  try {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms?.query) return null;
    return (await perms.query({ name: 'geolocation' as PermissionName })).state;
  } catch {
    return null;
  }
}

/**
 * Avtomatik (tugmasiz) joylashuv olish mumkinmi — oyna ochilmasligi yoki faqat birinchi marta ochilishi uchun.
 * `true` qaytsa va ruxsat hali so'ralmagan bo'lsa, "so'raldi" deb belgilanadi.
 */
export async function mayLocateAutomatically(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
  const stored = read();
  const state = await permissionState();
  if (state === 'granted') return true;
  if (state === 'denied') {
    write('denied');
    return false;
  }
  // 'prompt' yoki Permissions API yo'q (eski iOS).
  if (stored === null) {
    write('asked');
    return true;
  }
  // Permissions API yo'q, lekin oldin muvaffaqiyatli olingan — ehtimol hali amal qiladi.
  return state === null && stored === 'granted';
}

/** Kartochka uchun: ruxsat so'ralgan-u, olinmagan (avtomatik qayta so'ralmaydi). */
export async function geoNeedsUserAction(): Promise<'denied' | 'prompt' | null> {
  const state = await permissionState();
  if (state === 'granted') return null;
  if (state === 'denied') return 'denied';
  const stored = read();
  if (stored === 'granted') return null;
  return stored === null ? null : stored === 'denied' ? 'denied' : 'prompt';
}
