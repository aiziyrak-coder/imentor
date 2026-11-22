import { getCurrentLocalUser } from './localStaffAuth';
import { HttpError, httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import { topicNormLookupKeys, topicNormsOverlap } from './syllabusTopicContext';
import type { SyllabusTopic } from '../services/aiService';
import type { SyllabusTopicContext } from './syllabusTopicContext';

export type PreparedContentKind = 'lecture' | 'presentation' | 'case' | 'test';

export type PreparedContentMeta = {
  authorDisplayName?: string;
  subjectName?: string;
  subjectCode?: string;
  variantLabel?: string;
  topicCode?: string;
  topicNorm?: string;
};

export type PreparedContentSummary = {
  id: string;
  topic: string;
  topicNorm?: string;
  createdAt: number;
  source: 'local' | 'cloud';
  /** Kim yaratgan — versiyalar ro'yxatida ko'rsatiladi. */
  author?: string;
  /** Faqat server `can_delete: true` desa o'chirish tugmasi chiqadi (bulutdagi yozuvlarda). */
  canDelete?: boolean;
  /** Bo'sh bo'lmasa — material eskirgan (masalan klinik bo'lmagan fanga bemor
   *  ssenariysi bilan yozilgan). Tarixda ko'rinadi, lekin avtomatik ochilmaydi. */
  retiredReason?: string;
};

const CLOUD_ID_PREFIX = 'cloud_';

function ownerKey(): string | null {
  const u = getCurrentLocalUser();
  if (!u) return null;
  return u.phoneDigits || u.uid || null;
}

export function normTopicKey(topic: string): string {
  return topic.trim().toLowerCase();
}

function normTopic(topic: string): string {
  return normTopicKey(topic);
}

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

async function requireAuthToken(): Promise<string> {
  const token = await getBackendAccessToken();
  if (!token) {
    throw new Error('Tizimga kiring — kontent FastAPI bazasiga saqlanadi.');
  }
  return token;
}

/**
 * data:URL rasmlar JSON ni shishiradi, shuning uchun bazaga yozilmaydi.
 * Lekin `imageSourceUrl` SAQLANADI — saqlangan taqdimot qayta ochilganda
 * rasm o\'sha havoladan tortiladi. Ilgari havola ham qolmagani uchun
 * saqlangan deck butunlay rasmsiz chiqardi.
 */
function stripHeavyMediaFromPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const deck = payload as { slides?: unknown };
  if (!Array.isArray(deck.slides)) return payload;
  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      if (!slide || typeof slide !== 'object') return slide;
      const s = slide as Record<string, unknown>;
      const imageUrl = typeof s.imageUrl === 'string' ? s.imageUrl : '';
      if (!imageUrl.startsWith('data:')) return slide;
      const { imageUrl: _drop, ...rest } = s;
      return rest;
    }),
  };
}

function cloudId(numericId: number | string): string {
  return `${CLOUD_ID_PREFIX}${numericId}`;
}

function parseCloudNumericId(id: string): string | null {
  if (id.startsWith(CLOUD_ID_PREFIX)) return id.slice(CLOUD_ID_PREFIX.length);
  if (/^\d+$/.test(id)) return id;
  return null;
}

type CloudRow = {
  id: number;
  topic: string;
  topic_norm?: string;
  payload?: unknown;
  created_at: string;
};

/** Saqlash — AI generatsiyasidan keyingi eng muhim qadam: bu yerda yiqilsa
 * o'qituvchining bir necha daqiqalik ishi yo'qoladi. Shuning uchun:
 *  - timeout uzun (payload katta, mobil internet sekin bo'lishi mumkin),
 *  - vaqtinchalik xatolarda (tarmoq, timeout, 5xx) qisqa kutib qayta uriniladi.
 * 4xx (validatsiya/autentifikatsiya) da qayta urinilmaydi — natija o'zgarmaydi. */
async function postWithRetry(
  url: string,
  token: string,
  body: unknown,
): Promise<{ id?: number } | null> {
  const delaysMs = [800, 2500];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await httpJson<{ id?: number }>(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
        timeoutMs: 60_000,
      });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 0;
      const retriable = status === 0 || status === 429 || status >= 500;
      if (!retriable || attempt >= delaysMs.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}

/** Material saqlandi/yangilandi/o'chirildi — "Mening fanlarim"dagi
 * tayyorlik nuqtalari shu hodisa bilan yangilanadi (sahifa fonda ochiq
 * turadi, aks holda nuqtalar eskiligicha qolardi). */
export const PREPARED_CONTENT_CHANGED_EVENT = 'imentor:prepared-content-changed';

function notifyPreparedContentChanged(): void {
  try {
    window.dispatchEvent(new Event(PREPARED_CONTENT_CHANGED_EVENT));
  } catch {
    /* SSR / test muhiti */
  }
}

/** Asosiy saqlash — FastAPI `/v1/prepared-content/` (Postgres). localStorage ishlatilmaydi.
 * Qaytaradi: yaratilgan yozuvning Baza id'si (`cloud_<n>`) — chaqiruvchi uni
 * keyinroq yangilashi (PATCH) yoki fayl bilan bog'lashi mumkin. Server id
 * qaytarmasa `null`. */
export async function savePreparedContent(
  kind: PreparedContentKind,
  topic: string,
  payload: unknown,
  meta?: PreparedContentMeta,
): Promise<string | null> {
  const owner = ownerKey();
  if (!owner) {
    throw new Error('Tizimga kiring — kontent FastAPI bazasiga saqlanadi.');
  }
  const token = await requireAuthToken();
  const topicNorm = meta?.topicNorm?.trim() || normTopic(topic);
  const lightPayload = stripHeavyMediaFromPayload(payload);

  const created = await postWithRetry(`${apiBaseUrl()}/v1/prepared-content/`, token, {
      owner_key: owner,
      kind,
      topic: topic.trim() || 'Nomsiz',
      topic_norm: topicNorm,
      author_display_name: meta?.authorDisplayName?.trim() || '',
      subject_name: meta?.subjectName?.trim() || '',
      subject_code: meta?.subjectCode?.trim() || '',
      variant_label: meta?.variantLabel?.trim() || '',
      topic_code: meta?.topicCode?.trim() || '',
      payload: lightPayload,
  });
  notifyPreparedContentChanged();
  return created?.id != null ? cloudId(created.id) : null;
}

/** PATCH natijasi (2026-11-17 audit):
 *  - `updated`   — yozuv yangilandi;
 *  - `not_found` — bu yozuvni yangilab bo'lmaydi: id Bazaniki emas, yozuv yo'q (404)
 *                  yoki boshqa muallifniki (403) — chaqiruvchi O'Z nusxasini yaratadi;
 *  - `failed`    — tarmoq/server xatosi yoki sessiya yo'q. Yangi nusxa YARATILMAYDI
 *                  (aks holda har uzilishda Bazada takror versiya paydo bo'lardi) —
 *                  foydalanuvchiga xabar beriladi va u qayta urinadi. */
export type PreparedContentPatchResult =
  | { status: 'updated' }
  | { status: 'not_found' }
  | { status: 'failed'; error: unknown };

/** Mavjud yozuvning payload'ini almashtirish — Bazada nusxa ko'paymasligi uchun.
 * Masalan test avval asosiy tilda saqlanadi, tarjimalar tayyor bo'lgach
 * SHU yozuv yangilanadi.
 *
 * Ilgari har qanday xatoda `false` qaytarardi va chaqiruvchilar buni "yozuv
 * yo'q" deb tushunib YANGI nusxa yaratardi — tarmoq uzilishi takror versiyaga
 * aylanardi. Endi "topilmadi" va "yiqildi" ajratiladi. */
export async function patchPreparedContentPayload(
  id: string,
  payload: unknown,
): Promise<PreparedContentPatchResult> {
  const numericId = parseCloudNumericId(id);
  if (!numericId) return { status: 'not_found' };
  try {
    const token = await getBackendAccessToken();
    if (!token) return { status: 'failed', error: new Error('Tizimga kiring.') };
    await httpJson(`${apiBaseUrl()}/v1/prepared-content/${numericId}/`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: { payload: stripHeavyMediaFromPayload(payload) },
      timeoutMs: 60_000,
    });
    notifyPreparedContentChanged();
    return { status: 'updated' };
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 0;
    if (status === 404 || status === 403) return { status: 'not_found' };
    return { status: 'failed', error };
  }
}

/** `cloud_12` → `12` (Baza id'sini fayl nomiga bog'lash uchun). */
export function preparedContentNumericId(id: string): string | null {
  return parseCloudNumericId(id);
}

/** @deprecated Faqat sync ro'yxatdan foydalaning — localStorage o'chirilgan. */
export function listPreparedForTopic(
  _kind: PreparedContentKind,
  _topic: SyllabusTopic | SyllabusTopicContext | string,
): PreparedContentSummary[] {
  return [];
}

/** @deprecated localStorage o'rniga `listAllPreparedForKindSynced` ishlating. */
export function listAllPreparedForKind(_kind: PreparedContentKind): PreparedContentSummary[] {
  return [];
}

type MineRow = {
  id: number;
  topic: string;
  topic_norm?: string;
  author_display_name?: string;
  created_at: string;
  can_delete?: boolean;
  retired_reason?: string;
};

const MINE_PAGE_SIZE = 300;
/** Xavfsizlik chegarasi — server nosoz javob bersa cheksiz aylanmaslik uchun. */
const MINE_MAX_PAGES = 20;

/** `/v1/prepared-content/mine/` — BARCHA sahifalarni yig'ib oladi.
 * Ilgari faqat birinchi 200 ta yozuv olinardi va faol o'qituvchida eski
 * materiallar Bazadan butunlay yo'qolganday ko'rinardi. */
async function fetchMineRows(
  kind: PreparedContentKind,
  topicNorms?: string[],
  options?: {
    shared?: boolean;
    syllabusId?: number;
    topicCode?: string;
    variantLabel?: string;
  },
): Promise<PreparedContentSummary[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const out: PreparedContentSummary[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= MINE_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      kind,
      page: String(page),
      page_size: String(MINE_PAGE_SIZE),
    });
    if (options?.shared) params.set('shared', '1');
    if (options?.syllabusId) params.set('syllabus_id', String(options.syllabusId));
    if (options?.topicCode) params.set('topic_code', options.topicCode);
    if (options?.variantLabel) params.set('variant_label', options.variantLabel);
    for (const norm of topicNorms || []) params.append('topic_norm', norm);
    const data = await httpJson<{ results?: MineRow[]; count?: number }>(
      `${apiBaseUrl()}/v1/prepared-content/mine/?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const rows = data.results || [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({
        id: cloudId(r.id),
        topic: r.topic,
        topicNorm: r.topic_norm || normTopic(r.topic),
        author: r.author_display_name || '',
        createdAt: new Date(r.created_at).getTime(),
        source: 'cloud' as const,
        canDelete: r.can_delete === true,
        retiredReason: r.retired_reason || '',
      });
    }
    // Backend `paginate` javobi: {count, page, page_size, results} — `next` yo'q,
    // shuning uchun to'xtash sharti sonlar bo'yicha.
    if (rows.length < MINE_PAGE_SIZE) break;
    if (typeof data.count === 'number' && out.length >= data.count) break;
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** FastAPI `/v1/prepared-content/mine/` — foydalanuvchi tarixi bazadan. */
export async function listAllPreparedForKindSynced(
  kind: PreparedContentKind,
): Promise<PreparedContentSummary[]> {
  try {
    return await fetchMineRows(kind);
  } catch {
    return [];
  }
}

/** Ro'yxat natijasi: `ok: false` — Bazaga yetib bo'lmadi (tarmoq/server).
 * Bu "material yo'q" EMAS — chaqiruvchi keshni o'chirmasligi va bo'sh
 * "hali saqlanmagan" ro'yxat o'rniga xato + "Qayta urinish" ko'rsatishi kerak. */
export type PreparedListResult =
  | { ok: true; items: PreparedContentSummary[]; error?: undefined }
  | { ok: false; items: PreparedContentSummary[]; error: unknown };

/** Xatoni bo'sh ro'yxatga aylantiradigan eski ko'rinish — faqat AI konteksti kabi
 * "bo'lsa yaxshi" joylar uchun. Foydalanuvchiga ro'yxat ko'rsatadigan joylar
 * `listPreparedForTopicResult` ishlatadi (xato ≠ bo'sh). */
export async function listPreparedForTopicSynced(
  kind: PreparedContentKind,
  topic: SyllabusTopic | SyllabusTopicContext | string,
  options?: { shared?: boolean },
): Promise<PreparedContentSummary[]> {
  return (await listPreparedForTopicResult(kind, topic, options)).items;
}

/** Mavzu bo'yicha FastAPI tarix — filtrlash SERVERDA, aniq `topic_norm`
 * tenglik bo'yicha. Faqat tuzilmali kalit (`fan::variant::kod`) — sarlavha
 * bo'yicha qidiruv fanlarni aralashtirardi. */
export async function listPreparedForTopicResult(
  kind: PreparedContentKind,
  topic: SyllabusTopic | SyllabusTopicContext | string,
  options?: { shared?: boolean },
): Promise<PreparedListResult> {
  const wantedKeys = (
    typeof topic === 'string' ? [normTopic(topic)] : topicNormLookupKeys(topic)
  )
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.includes('::'));
  const syllabusId =
    typeof topic === 'object' && topic && 'syllabusId' in topic ? topic.syllabusId : undefined;
  const topicCode =
    typeof topic === 'object' && topic?.id
      ? topic.id.trim().toLowerCase().replace(/\s+/g, '')
      : '';
  const variantLabel =
    typeof topic === 'object' && topic && 'variantLabel' in topic ? topic.variantLabel || '' : '';
  if (!wantedKeys.length && !(syllabusId && topicCode)) return { ok: true, items: [] };
  try {
    const rows = await fetchMineRows(kind, wantedKeys, {
      ...options,
      syllabusId,
      topicCode,
      variantLabel,
    });
    if (!wantedKeys.length) return { ok: true, items: rows };
    return { ok: true, items: rows.filter((r) => topicNormsOverlap(r.topicNorm || '', wantedKeys)) };
  } catch (error) {
    return { ok: false, items: [], error };
  }
}

/** @deprecated local id endi yo'q — `loadPreparedByIdSynced` ishlating. */
export function loadPreparedById<T>(_kind: PreparedContentKind, _id: string): T | null {
  return null;
}

/** FastAPI `/v1/prepared-content/{id}/` — to'liq payload. */
export async function loadPreparedByIdSynced<T>(
  kind: PreparedContentKind,
  id: string,
): Promise<T | null> {
  const numericId = parseCloudNumericId(id);
  if (!numericId) return null;
  try {
    const token = await getBackendAccessToken();
    if (!token) return null;
    const data = await httpJson<{ payload?: T; kind?: string }>(
      `${apiBaseUrl()}/v1/prepared-content/${numericId}/`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (data.kind && data.kind !== kind) return null;
    return data.payload ?? null;
  } catch {
    return null;
  }
}

export async function deletePreparedContent(kind: PreparedContentKind, id: string): Promise<void> {
  const numericId = parseCloudNumericId(id);
  if (!numericId) return;
  const token = await requireAuthToken();
  await httpJson(`${apiBaseUrl()}/v1/prepared-content/${numericId}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  notifyPreparedContentChanged();
  void kind;
}

/** FastAPI latest by topic_norm — birinchi mos kelgan kalit. */
export async function loadLatestPreparedContent<T>(
  kind: PreparedContentKind,
  topic: SyllabusTopic | SyllabusTopicContext | string,
): Promise<T | null> {
  const lookupKeys = (
    typeof topic === 'string' ? [normTopic(topic)] : topicNormLookupKeys(topic)
  )
    .map((k) => k.toLowerCase())
    .filter((k) => k.includes('::'));
  const syllabusId =
    typeof topic === 'object' && topic && 'syllabusId' in topic ? topic.syllabusId : undefined;
  const topicCode =
    typeof topic === 'object' && topic?.id
      ? topic.id.trim().toLowerCase().replace(/\s+/g, '')
      : '';
  if (!lookupKeys.length && !(syllabusId && topicCode)) return null;

  try {
    const token = await getBackendAccessToken();
    if (!token) return null;
    const params = new URLSearchParams({ kind });
    if (lookupKeys[0]) params.set('topic_norm', lookupKeys[0]);
    if (syllabusId) params.set('syllabus_id', String(syllabusId));
    if (topicCode) params.set('topic_code', topicCode);
    const data = await httpJson<{
      id?: number;
      payload?: unknown;
      created_at?: string;
    } & CloudRow>(
      `${apiBaseUrl()}/v1/prepared-content/?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (data.payload == null) return null;
    return data.payload as T;
  } catch {
    return null;
  }
}

/** Translate just the requested language and keep the complete result on the server. */
export async function translatePreparedContent<T>(id: string, language: 'uz' | 'ru' | 'en'): Promise<T> {
  const numericId = parseCloudNumericId(id);
  if (!numericId) throw new Error('Save the material before translating.');
  const token = await requireAuthToken();
  const result = await httpJson<{ payload: T }>(`${apiBaseUrl()}/v1/prepared-content/${numericId}/translate/${language}/`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, timeoutMs: 300_000,
  });
  return result.payload;
}

/** O'qituvchi AI tarjimasini tekshirib tasdiqlaydi (yoki tasdiqni bekor qiladi). Yangi payload qaytadi. */
export async function reviewPreparedTranslation<T>(
  id: string,
  language: 'uz' | 'ru' | 'en',
  reviewed: boolean,
): Promise<T> {
  const numericId = parseCloudNumericId(id);
  if (!numericId) throw new Error('Save the material first.');
  const token = await requireAuthToken();
  const result = await httpJson<{ payload: T }>(
    `${apiBaseUrl()}/v1/prepared-content/${numericId}/translation-review/${language}/`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { reviewed },
    },
  );
  return result.payload;
}

export type QuestionPoolTopic = { code: string; title: string; type?: string };
export type QuestionPool = {
  plan: { current: QuestionPoolTopic | null; taught: QuestionPoolTopic[]; later: QuestionPoolTopic[] };
  questions: Array<{
    question: string;
    options: string[];
    correctOptionIndex: number;
    explanation: string;
    optionExplanations?: string[];
    references?: unknown[];
    level?: 'hard' | 'medium' | 'easy' | null;
    link?: string | null;
  }>;
  /** Mavzu bankidagi yaroqli savollar soni va "to'la" chegarasi (2026-10-26): to'la bo'lsa test AI'siz. */
  bank_size?: number;
  bank_target?: number;
  /** Har testda yangi yoziladigan savollar soni (2026-10-26: 2 ta, qolgan 8 tasi bankdan). */
  new_questions?: number;
  /** Claude banki yozilmoqda (2026-11-20): shu vaqtgacha (ISO) OpenAI chaqirilmay bank kutiladi. */
  bank_pending_until?: string | null;
};

/**
 * Test uchun o'tilgan/o'tilmagan mavzular va shu mavzuda avval yaratilgan
 * savollar zaxirasi (2026-10-21). Xato bo'lsa `null` — test oddiy yo'l bilan
 * (to'liq AI) yaratiladi, o'qituvchi hech narsa sezmaydi.
 */
/** Keyslar zaxirasi: shu mavzuda boshqa o'qituvchilar avval yaratgan keyslar (2026-10-22). */
export type CasePool = {
  cases: Record<'profilaktika' | 'davolash' | 'tashxis', Array<Record<string, unknown>>>;
  references: Array<Record<string, unknown>>;
};

/**
 * Institut banki (2026-10-22, "bir mavzuga bir marta"): shu mavzuga tayyor ma'ruza yoki
 * taqdimot — avval o'qituvchining o'zi, keyin hamkasbi, keyin o'xshash nomli mavzu.
 * Topilmasa `null` — AI yozadi.
 */
export type BankItem = {
  id: number;
  /** AYNAN shu mavzudagi o'z materiali (nusxa kerak emas). */
  own: boolean;
  /** Shu sillabus mavzusidanmi (false — o'xshash nomli boshqa mavzudan). */
  exact?: boolean;
  author: string;
  topic: string;
  created_at: string | null;
  payload: Record<string, unknown>;
};

export async function fetchBankItem(
  kind: 'lecture' | 'presentation',
  ctx: { syllabusId?: number; id?: string | number; title?: string; variantLabel?: string } | null | undefined,
  language: 'uz' | 'ru' | 'en',
): Promise<BankItem | null> {
  try {
    const token = await getBackendAccessToken();
    if (!token || !ctx?.syllabusId || !ctx.id) return null;
    const params = new URLSearchParams({
      kind,
      language,
      syllabus_id: String(ctx.syllabusId),
      topic_code: String(ctx.id),
      title: ctx.title || '',
      // Semestr varianti (2026-10-23): 10-semestrning L1 mavzusi 9-semestrnikiga berilmasin.
      variant_label: ctx.variantLabel || '',
    });
    const data = await httpJson<{ item: BankItem | null }>(`${apiBaseUrl()}/v1/prepared-content/bank/?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 20_000,
    });
    return data?.item ?? null;
  } catch {
    return null;
  }
}

export async function fetchCasePool(
  ctx: { syllabusId?: number; topicCode?: string; subjectCode?: string; topicNorm?: string; title?: string },
  language: 'uz' | 'ru' | 'en',
): Promise<CasePool | null> {
  try {
    const token = await getBackendAccessToken();
    const hasTopic = (ctx.syllabusId && ctx.topicCode) || (ctx.subjectCode && ctx.topicNorm);
    if (!token || !hasTopic) return null;
    const params = new URLSearchParams({ language });
    if (ctx.syllabusId && ctx.topicCode) {
      params.set('syllabus_id', String(ctx.syllabusId));
      params.set('topic_code', ctx.topicCode);
    }
    if (ctx.subjectCode && ctx.topicNorm) {
      params.set('subject_code', ctx.subjectCode);
      params.set('topic_norm', ctx.topicNorm);
    }
    // O'xshash nomli boshqa sillabus mavzusi ham qidiriladi (2026-10-22).
    if (ctx.title) params.set('title', ctx.title.slice(0, 300));
    return await httpJson<CasePool>(`${apiBaseUrl()}/v1/prepared-content/case-pool/?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 20_000,
    });
  } catch {
    return null;
  }
}

export async function fetchQuestionPool(
  ctx: { syllabusId: number; topicCode: string; variantLabel?: string },
  language: 'uz' | 'ru' | 'en',
): Promise<QuestionPool | null> {
  try {
    const token = await getBackendAccessToken();
    if (!token || !ctx.syllabusId || !ctx.topicCode) return null;
    const params = new URLSearchParams({
      syllabus_id: String(ctx.syllabusId),
      topic_code: ctx.topicCode,
      variant: ctx.variantLabel || '',
      language,
    });
    return await httpJson<QuestionPool>(`${apiBaseUrl()}/v1/prepared-content/question-pool/?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 20_000,
    });
  } catch {
    return null;
  }
}
