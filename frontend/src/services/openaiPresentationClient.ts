/**
 * Taqdimot AI — server OpenAI proxy (kalit brauzerga kirmaydi).
 * Boshqa vazifalar DeepSeek orqali ishlaydi.
 */
import { httpJson } from '../api/httpClient';
import { ensureBackendAccessToken, getBackendAccessToken } from '../utils/backendAuth';
import type { Slide } from './presentationTypes';
import type { AppLanguage } from '../i18n/language';

export type PresentationPhase = 'structure' | 'content' | 'images' | 'done';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

async function postPresentation<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const call = async (token: string) =>
    httpJson<T>(`${apiBaseUrl()}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
      timeoutMs: 360_000,
    });

  let token = await ensureBackendAccessToken().catch(async () => {
    const fallback = await getBackendAccessToken();
    if (!fallback) throw new Error('no-backend-token');
    return fallback;
  });

  try {
    return await call(token);
  } catch (e: unknown) {
    const status = e && typeof e === 'object' && 'status' in e ? (e as { status: number }).status : 0;
    if (status !== 401) throw e;
    const retryToken = await getBackendAccessToken();
    if (!retryToken || retryToken === token) throw new Error('no-backend-token');
    return call(retryToken);
  }
}

export async function generatePresentationViaOpenAI(opts: {
  topic: string;
  context?: string;
  slideCount?: number;
  language?: AppLanguage;
  onPhase?: (phase: PresentationPhase) => void;
}): Promise<Slide[]> {
  opts.onPhase?.('structure');
  const data = await postPresentation<{ slides?: Slide[]; detail?: string }>(
    '/v1/presentation-ai/generate/',
    {
      topic: opts.topic,
      context: opts.context ?? '',
      slide_count: opts.slideCount ?? 12,
      language: opts.language ?? 'uz',
    },
  );
  opts.onPhase?.('content');
  opts.onPhase?.('images');
  if (!data.slides?.length) {
    throw new Error(data.detail || 'OpenAI taqdimot qaytarmadi');
  }
  opts.onPhase?.('done');
  return data.slides;
}

export async function generatePresentationFromTextViaOpenAI(opts: {
  topic?: string;
  sourceText: string;
  slideCount?: number;
  language?: AppLanguage;
  onPhase?: (phase: PresentationPhase) => void;
}): Promise<Slide[]> {
  opts.onPhase?.('structure');
  const data = await postPresentation<{ slides?: Slide[]; detail?: string }>(
    '/v1/presentation-ai/from-text/',
    {
      topic: opts.topic ?? '',
      source_text: opts.sourceText,
      slide_count: opts.slideCount ?? 12,
      language: opts.language ?? 'uz',
    },
  );
  opts.onPhase?.('content');
  opts.onPhase?.('images');
  if (!data.slides?.length) {
    throw new Error(data.detail || 'OpenAI taqdimot qaytarmadi');
  }
  opts.onPhase?.('done');
  return data.slides;
}
