import { postLiveTestAnticheatEvents } from './analyticsApi';

export type AnticheatEvent = {
  event_type: string;
  question_index?: number;
  option_index?: number;
  client_ts_ms?: number;
};

const buffers = new Map<string, AnticheatEvent[]>();
const STORE_PREFIX = 'imentor-live-events:';

function key(sessionKey: string) {
  return sessionKey.trim();
}

/**
 * Bufer sessionStorage'da ham turadi (2026-10-23): boshqa ilovadan qaytib sahifani
 * yangilagan talabaning "chiqib ketdi" yozuvlari yo'qolmasin.
 */
function load(k: string): AnticheatEvent[] {
  const mem = buffers.get(k);
  if (mem) return mem;
  try {
    const raw = sessionStorage.getItem(STORE_PREFIX + k);
    const list = raw ? (JSON.parse(raw) as AnticheatEvent[]) : [];
    buffers.set(k, Array.isArray(list) ? list : []);
  } catch {
    buffers.set(k, []);
  }
  return buffers.get(k)!;
}

function save(k: string, list: AnticheatEvent[]): void {
  buffers.set(k, list);
  try {
    if (list.length) sessionStorage.setItem(STORE_PREFIX + k, JSON.stringify(list));
    else sessionStorage.removeItem(STORE_PREFIX + k);
  } catch {
    /* saqlab bo'lmasa — faqat xotirada */
  }
}

export function pushLiveTestEvent(sessionKey: string, ev: AnticheatEvent): void {
  const k = key(sessionKey);
  if (!k) return;
  const list = [...load(k), { ...ev, client_ts_ms: ev.client_ts_ms ?? Date.now() }];
  if (list.length > 300) list.splice(0, list.length - 300);
  save(k, list);
}

export async function flushLiveTestEvents(sessionKey: string, participantKey: string): Promise<void> {
  const k = key(sessionKey);
  const list = load(k);
  if (!list.length) return;
  save(k, []);
  try {
    await postLiveTestAnticheatEvents(k, participantKey, list);
  } catch (e) {
    // Yuborilmadi — keyingi safar qayta (ilgari jim yo'qolardi).
    save(k, [...list, ...load(k)].slice(-300));
    throw e;
  }
}

/**
 * `onReturn` — talaba sahifaga qaytgan payt (masalan, voqealarni darhol yuborish).
 */
export function bindLiveTestVisibilityTracking(sessionKey: string, onReturn?: () => void): () => void {
  const onVis = () => {
    pushLiveTestEvent(sessionKey, {
      event_type: document.hidden ? 'visibility_hidden' : 'visibility_visible',
    });
    if (!document.hidden) onReturn?.();
  };
  const onBlur = () => pushLiveTestEvent(sessionKey, { event_type: 'tab_blur' });
  const onFocus = () => pushLiveTestEvent(sessionKey, { event_type: 'tab_focus' });
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
  };
}
