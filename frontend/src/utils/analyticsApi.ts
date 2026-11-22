import { HttpError, httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import { getCurrentLocalUser } from './localStaffAuth';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

type ActivityEvent = {
  event_type: string;
  duration_sec?: number;
  meta?: Record<string, unknown>;
  /** Hodisa haqiqatan bo'lgan payt. Navbatdan kechikib yuborilganda server
   *  vaqtni SHU paytga yozadi — aks holda darsdagi daqiqalar keyingi vaqtga
   *  tushib, dars "o'tilmagan" bo'lib chiqardi. */
  client_ts_ms?: number;
};

/** Faollik yuborilish holati — banner shu hodisani tinglaydi. */
export type TelemetryStatus = { ok: boolean; reason?: 'auth' | 'network' };

function newQid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function emitStatus(status: TelemetryStatus): void {
  window.dispatchEvent(new CustomEvent<TelemetryStatus>('imentor:telemetry-status', { detail: status }));
}

/* ── Yuborilmagan vaqt navbati ───────────────────────────────────────────
   Internet uzilsa yoki server javob bermasa, shu daqiqalardagi ish ilgari
   butunlay yo'qolardi: hisoblagich yuborishdan OLDIN nolga tushirilardi.
   Rektor hisobotida "dars o'tildimi" aynan shu qaydlarga qaraydi.
   Endi yuborilmagani brauzerda saqlanadi va keyingi muvaffaqiyatli
   yuborishda asl vaqti bilan jo'natiladi.

   Navbat FOYDALANUVCHI bo'yicha: sinf doskasida bir kompyuterda bir necha
   o'qituvchi ishlaydi — birining vaqti ikkinchisiga yozilib ketmasin. */
const QUEUE_PREFIX = 'imentor-activity-queue-v1:';
/** Eskirgani yuborilmaydi (server ham 24 soatdan eskisini qabul qilmaydi). */
const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const QUEUE_MAX_ITEMS = 600;
const BATCH = 50;

type Queued = { page: string; event: ActivityEvent };

function queueKey(): string | null {
  const uid = getCurrentLocalUser()?.uid;
  return uid ? QUEUE_PREFIX + uid : null;
}

function readQueue(key: string): Queued[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(raw)) return [];
    const cutoff = Date.now() - QUEUE_MAX_AGE_MS;
    return raw.filter(
      (q): q is Queued =>
        q && typeof q.page === 'string' && q.event && (q.event.client_ts_ms ?? 0) >= cutoff,
    );
  } catch {
    return [];
  }
}

function writeQueue(key: string, items: Queued[]): void {
  try {
    if (items.length) localStorage.setItem(key, JSON.stringify(items.slice(-QUEUE_MAX_ITEMS)));
    else localStorage.removeItem(key);
  } catch {
    /* xotira to'la yoki yopiq — navbatsiz davom etamiz */
  }
}

function enqueue(events: ActivityEvent[], page: string): void {
  const key = queueKey();
  // Faqat vaqt qaydlari saqlanadi: "bo'limni ochdi" kechikib kelsa ma'nosiz.
  const keep = events.filter((e) => e.event_type === 'heartbeat' && (e.duration_sec ?? 0) > 0);
  if (!key || !keep.length) return;
  writeQueue(key, [...readQueue(key), ...keep.map((event) => ({ page, event }))]);
}

/** Navbatdagilarni yuboradi (sahifa bo'yicha guruhlab). Xato bo'lsa qolgani navbatda qoladi. */
async function drainQueue(url: string, token: string): Promise<void> {
  const key = queueKey();
  if (!key) return;
  let items = readQueue(key);
  while (items.length) {
    const page = items[0].page;
    const chunk = items.filter((q) => q.page === page).slice(0, BATCH);
    await httpJson(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { events: chunk.map((q) => q.event), page, sent_at_ms: Date.now() },
      timeoutMs: 12000,
    });
    const sent = new Set(chunk);
    items = items.filter((q) => !sent.has(q));
    writeQueue(key, items);
  }
}

export async function postActivityEvents(
  events: ActivityEvent[],
  page: string,
  options?: { beacon?: boolean },
): Promise<void> {
  if (events.length === 0) return;
  const stamped = events.map((e) => ({
    ...e,
    client_ts_ms: e.client_ts_ms ?? Date.now(),
    // Noyob belgi: navbatdan qayta yuborilsa server ikki marta sanamaydi.
    meta: { ...(e.meta || {}), qid: (e.meta?.qid as string) || newQid() },
  }));
  const token = await getBackendAccessToken();
  if (!token) {
    enqueue(stamped, page);
    emitStatus({ ok: false, reason: 'auth' });
    return;
  }
  const url = `${apiBaseUrl()}/v1/analytics/events/`;

  /* Sahifa yopilayotganda oddiy so'rov bekor qilinadi va oxirgi bo'lakdagi
     vaqt yo'qoladi. `keepalive` esa so'rovni sahifadan uzib qo'yadi —
     brauzer uni varaq yopilgandan keyin ham oxirigacha yuboradi.
     `navigator.sendBeacon` ishlatilmadi: u sarlavha qo'sha olmaydi, ya'ni
     token URL ga chiqib, server loglariga yozilib qolardi. */
  if (options?.beacon) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ events: stamped, page, sent_at_ms: Date.now() }),
        keepalive: true,
      });
      if (!res.ok) enqueue(stamped, page);
    } catch {
      // Keyingi ochilishda navbatdan yuboriladi.
      enqueue(stamped, page);
    }
    return;
  }

  try {
    await httpJson(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { events: stamped, page, sent_at_ms: Date.now() },
      timeoutMs: 12000,
    });
  } catch (err) {
    enqueue(stamped, page);
    const auth = err instanceof HttpError && (err.status === 401 || err.status === 403);
    emitStatus({ ok: false, reason: auth ? 'auth' : 'network' });
    return;
  }
  emitStatus({ ok: true });
  // Ulanish bor — avval yuborilmay qolganlarini ham jo'natamiz.
  await drainQueue(url, token).catch(() => undefined);
}

export async function postLiveTestAnticheatEvents(
  sessionKey: string,
  participantKey: string,
  events: Array<{
    event_type: string;
    question_index?: number;
    option_index?: number;
    client_ts_ms?: number;
  }>,
): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token || !sessionKey || events.length === 0) return;
  await httpJson(`${apiBaseUrl()}/v1/analytics/live-test-events/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { session_key: sessionKey, participant_key: participantKey, events },
    timeoutMs: 15000,
  }).catch(() => undefined);
}
