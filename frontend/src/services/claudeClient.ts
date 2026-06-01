/**
 * Anthropic Claude API (Messages). Sonnet 4.5 — sifat; Haiku 4.5 — arzon yordamchi vazifalar.
 * Prompt caching: tizim ko‘rsatmalarini qayta-qayta chaqiruvlarda arzonroq.
 */

export const CLAUDE_SONNET = 'claude-sonnet-4-5-20250929';
export const CLAUDE_HAIKU = 'claude-haiku-4-5-20251001';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

type TextBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
};

type ContentPart =
  | TextBlock
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };

function apiKey(): string {
  const k =
    typeof process.env.ANTHROPIC_API_KEY === 'string' ? process.env.ANTHROPIC_API_KEY.trim() : '';
  return k;
}

export function assertAnthropicApiKey(): void {
  if (!apiKey()) {
    throw new Error(
      'ANTHROPIC_API_KEY sozlanmagan. Mahalliy: frontend/.env.local. Server: deploy/.env.production va docker compose --build.'
    );
  }
}

function systemBlocks(system: string, cache: boolean): TextBlock[] {
  const t = system.trim();
  if (!t) return [];
  const block: TextBlock = { type: 'text', text: t };
  if (cache) block.cache_control = { type: 'ephemeral' };
  return [block];
}

async function messagesRequest(params: {
  model: string;
  system: string;
  userParts: ContentPart[];
  maxTokens: number;
  temperature?: number;
  cacheSystem?: boolean;
}): Promise<string> {
  assertAnthropicApiKey();
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens,
    temperature: params.temperature ?? 0.35,
    system: systemBlocks(params.system, params.cacheSystem ?? true),
    messages: [{ role: 'user', content: params.userParts }],
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let data: { content?: { type: string; text?: string }[]; error?: { message?: string } };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`Claude API javobi JSON emas: ${raw.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = data?.error?.message || raw.slice(0, 400);
    throw new Error(`Claude HTTP ${res.status}: ${msg}`);
  }

  const parts = data.content;
  if (!Array.isArray(parts)) throw new Error('Claude: content yo‘q');
  const text = parts
    .filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
  if (!text.trim()) throw new Error('Claude: bo‘sh javob');
  return text;
}

/** Oddiy matn javob */
export async function claudeText(opts: {
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  cacheSystem?: boolean;
}): Promise<string> {
  return messagesRequest({
    model: opts.model ?? CLAUDE_SONNET,
    system: opts.system,
    userParts: [{ type: 'text', text: opts.user }],
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature,
    cacheSystem: opts.cacheSystem,
  });
}

const JSON_ONLY_SUFFIX =
  '\n\nReturn ONLY valid JSON (no markdown fences, no commentary before or after).';

/** JSON javob + parse */
export async function claudeJson<T>(opts: {
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  cacheSystem?: boolean;
  parse: (text: string) => T;
}): Promise<T> {
  const text = await messagesRequest({
    model: opts.model ?? CLAUDE_SONNET,
    system: opts.system + JSON_ONLY_SUFFIX,
    userParts: [{ type: 'text', text: opts.user }],
    maxTokens: opts.maxTokens ?? 8192,
    temperature: opts.temperature ?? 0.3,
    cacheSystem: opts.cacheSystem,
  });
  return opts.parse(text);
}

export async function claudeWithPdf(opts: {
  model?: string;
  system: string;
  userText: string;
  pdfBase64: string;
  mimeType?: string;
  maxTokens?: number;
}): Promise<string> {
  return messagesRequest({
    model: opts.model ?? CLAUDE_SONNET,
    system: opts.system,
    userParts: [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: opts.mimeType || 'application/pdf',
          data: opts.pdfBase64,
        },
      },
      { type: 'text', text: opts.userText },
    ],
    maxTokens: opts.maxTokens ?? 8192,
    temperature: 0.3,
    cacheSystem: true,
  });
}

export async function claudeWithImage(opts: {
  model?: string;
  system: string;
  userText: string;
  imageBase64: string;
  mimeType?: string;
  maxTokens?: number;
}): Promise<string> {
  return messagesRequest({
    model: opts.model ?? CLAUDE_SONNET,
    system: opts.system,
    userParts: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: opts.mimeType || 'image/jpeg',
          data: opts.imageBase64,
        },
      },
      { type: 'text', text: opts.userText },
    ],
    maxTokens: opts.maxTokens ?? 4096,
    temperature: 0.2,
    cacheSystem: false,
  });
}
