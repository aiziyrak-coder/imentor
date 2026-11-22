/**
 * Baza (prepared-content) mijozi xatoni "bo'sh" yoki "topilmadi" deb yashirmasligi kerak
 * (2026-11-17 audit):
 *  - ro'yxat yuklanmasa — `ok: false` (ilgari `[]` qaytarardi va Ma'ruza sahifasi keshdagi
 *    ma'ruzani "Bazada yo'q" deb o'chirib yuborardi);
 *  - PATCH tarmoq/server xatosida — `failed` (ilgari `false` qaytarardi va chaqiruvchilar
 *    YANGI nusxa yaratardi — Bazada takror versiyalar paydo bo'lardi). Faqat 404/403 —
 *    `not_found` (o'qituvchi o'z nusxasini yaratadi).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../api/httpClient';

const httpJson = vi.fn();
vi.mock('../api/httpClient', async (orig) => ({
  ...(await orig<typeof import('../api/httpClient')>()),
  httpJson: (...args: unknown[]) => httpJson(...args),
}));

const getToken = vi.fn<() => Promise<string | null>>();
vi.mock('./backendAuth', () => ({
  getBackendAccessToken: () => getToken(),
}));

vi.mock('./localStaffAuth', () => ({
  getCurrentLocalUser: () => ({ uid: 'stf_1', phoneDigits: '998901234567' }),
}));

const {
  listPreparedForTopicResult,
  listPreparedForTopicSynced,
  patchPreparedContentPayload,
} = await import('./preparedContentStore');

/** Tuzilmali kalit (`fan::variant::kod`) — faqat shunday kalit bilan so'rov yuboriladi. */
const TOPIC_KEY = 'syl1::uz::t5';

describe('listPreparedForTopicResult', () => {
  beforeEach(() => {
    httpJson.mockReset();
    getToken.mockReset();
    getToken.mockResolvedValue('tok');
  });

  it('server bo‘sh ro‘yxat bersa — ok: true, items: []', async () => {
    httpJson.mockResolvedValue({ results: [], count: 0 });
    const res = await listPreparedForTopicResult('lecture', TOPIC_KEY);
    expect(res).toEqual({ ok: true, items: [] });
  });

  it('tarmoq xatosi "bo‘sh" emas — ok: false va xato qaytadi', async () => {
    const err = new TypeError('Failed to fetch');
    httpJson.mockRejectedValue(err);
    const res = await listPreparedForTopicResult('lecture', TOPIC_KEY);
    expect(res.ok).toBe(false);
    expect(res.items).toEqual([]);
    expect(res.error).toBe(err);
  });

  it('server 500 qaytarsa ham — ok: false', async () => {
    httpJson.mockRejectedValue(new HttpError('boom', 500, null));
    const res = await listPreparedForTopicResult('test', TOPIC_KEY);
    expect(res.ok).toBe(false);
  });

  it('topilgan yozuvlar ok: true bilan qaytadi', async () => {
    httpJson.mockResolvedValue({
      results: [{ id: 12, topic: 'Mavzu', topic_norm: TOPIC_KEY, created_at: '2026-11-17T08:00:00Z' }],
      count: 1,
    });
    const res = await listPreparedForTopicResult('case', TOPIC_KEY);
    expect(res.ok).toBe(true);
    expect(res.items.map((r) => r.id)).toEqual(['cloud_12']);
  });

  it('eski `listPreparedForTopicSynced` (AI konteksti uchun) xatoda baribir [] qaytaradi', async () => {
    httpJson.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(listPreparedForTopicSynced('case', TOPIC_KEY)).resolves.toEqual([]);
  });
});

describe('patchPreparedContentPayload', () => {
  beforeEach(() => {
    httpJson.mockReset();
    getToken.mockReset();
    getToken.mockResolvedValue('tok');
  });

  it('muvaffaqiyat — updated', async () => {
    httpJson.mockResolvedValue({});
    await expect(patchPreparedContentPayload('cloud_7', { content: 'x' })).resolves.toEqual({ status: 'updated' });
    expect(httpJson).toHaveBeenCalledWith(
      expect.stringContaining('/v1/prepared-content/7/'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('404 — not_found (chaqiruvchi yangi yozuv yaratadi)', async () => {
    httpJson.mockRejectedValue(new HttpError('Topilmadi.', 404, null));
    await expect(patchPreparedContentPayload('cloud_7', {})).resolves.toEqual({ status: 'not_found' });
  });

  it('403 (boshqa muallifning yozuvi) — not_found: o‘qituvchi o‘z nusxasini yaratadi', async () => {
    httpJson.mockRejectedValue(new HttpError('Faqat muallif', 403, null));
    await expect(patchPreparedContentPayload('cloud_7', {})).resolves.toEqual({ status: 'not_found' });
  });

  it('Bazaga tegishli bo‘lmagan id — so‘rovsiz not_found', async () => {
    await expect(patchPreparedContentPayload('local_abc', {})).resolves.toEqual({ status: 'not_found' });
    expect(httpJson).not.toHaveBeenCalled();
  });

  it('tarmoq xatosi — failed (yangi nusxa YARATILMASLIGI kerak)', async () => {
    const err = new TypeError('Failed to fetch');
    httpJson.mockRejectedValue(err);
    const res = await patchPreparedContentPayload('cloud_7', {});
    expect(res.status).toBe('failed');
    expect(res.status === 'failed' && res.error).toBe(err);
  });

  it('server 500 — failed', async () => {
    httpJson.mockRejectedValue(new HttpError('boom', 502, null));
    await expect(patchPreparedContentPayload('cloud_7', {})).resolves.toMatchObject({ status: 'failed' });
  });

  it('sessiya (token) yo‘q — failed, not_found emas', async () => {
    getToken.mockResolvedValue(null);
    await expect(patchPreparedContentPayload('cloud_7', {})).resolves.toMatchObject({ status: 'failed' });
    expect(httpJson).not.toHaveBeenCalled();
  });
});
