/**
 * DeepSeek API (OpenAI-compatible chat/completions).
 * Asosiy: deepseek-chat; murakkab tahlil: deepseek-reasoner.
 */
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export const DEEPSEEK_CHAT = 'deepseek-chat';
export const DEEPSEEK_FAST = 'deepseek-chat';
export const DEEPSEEK_REASONER = 'deepseek-reasoner';

const API_URL = 'https://api.deepseek.com/chat/completions';

const JSON_ONLY_SUFFIX =
  '\n\nReturn ONLY valid JSON (no markdown fences, no commentary before or after).';

function apiKey(): string {
  const k =
    typeof process.env.DEEPSEEK_API_KEY === 'string' ? process.env.DEEPSEEK_API_KEY.trim() : '';
  return k;
}

export function assertDeepseekApiKey(): void {
  if (!apiKey()) {
    throw new Error(
      'DEEPSEEK_API_KEY sozlanmagan. Mahalliy: frontend/.env.local. Server: deploy/.env.production va docker compose --build.'
    );
  }
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

async function extractTextFromPdfBase64(pdfBase64: string): Promise<string> {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ('str' in it ? String(it.str) : ''))
      .join(' ');
    pageTexts.push(line);
  }
  return pageTexts.join('\n');
}

async function chatCompletion(params: {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
}): Promise<string> {
  assertDeepseekApiKey();
  const msgs: ChatMessage[] = [];
  const sys = params.system.trim();
  if (sys) msgs.push({ role: 'system', content: sys });
  msgs.push(...params.messages);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: msgs,
      max_tokens: params.maxTokens,
      temperature: params.temperature ?? 0.35,
      stream: false,
    }),
  });

  const raw = await res.text();
  let data: {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`DeepSeek API javobi JSON emas: ${raw.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = data?.error?.message || raw.slice(0, 400);
    throw new Error(`DeepSeek HTTP ${res.status}: ${msg}`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) throw new Error('DeepSeek: bo‘sh javob');
  return String(text).trim();
}

export async function deepseekText(opts: {
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  return chatCompletion({
    model: opts.model ?? DEEPSEEK_CHAT,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature,
  });
}

export async function deepseekJson<T>(opts: {
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  parse: (text: string) => T;
}): Promise<T> {
  const text = await chatCompletion({
    model: opts.model ?? DEEPSEEK_CHAT,
    system: opts.system + JSON_ONLY_SUFFIX,
    messages: [{ role: 'user', content: opts.user }],
    maxTokens: opts.maxTokens ?? 8192,
    temperature: opts.temperature ?? 0.3,
  });
  return opts.parse(text);
}

export async function deepseekWithPdf(opts: {
  model?: string;
  system: string;
  userText: string;
  pdfBase64: string;
  maxTokens?: number;
}): Promise<string> {
  let pdfText = '';
  try {
    pdfText = await extractTextFromPdfBase64(opts.pdfBase64);
  } catch {
    pdfText = '';
  }
  const user =
    pdfText.trim().length > 80
      ? `${opts.userText}\n\n--- PDF matn ---\n${pdfText.slice(0, 100_000)}`
      : `${opts.userText}\n\n(PDF matn ajratib bo‘lmadi — mavzu va kontekst bo‘yicha javob bering.)`;
  return chatCompletion({
    model: opts.model ?? DEEPSEEK_CHAT,
    system: opts.system,
    messages: [{ role: 'user', content: user }],
    maxTokens: opts.maxTokens ?? 8192,
    temperature: 0.3,
  });
}

export async function deepseekWithImage(opts: {
  model?: string;
  system: string;
  userText: string;
  imageBase64: string;
  mimeType?: string;
  maxTokens?: number;
}): Promise<string> {
  const mime = opts.mimeType || 'image/jpeg';
  const url = `data:${mime};base64,${opts.imageBase64}`;
  const parts: ContentPart[] = [
    { type: 'image_url', image_url: { url } },
    { type: 'text', text: opts.userText },
  ];
  return chatCompletion({
    model: opts.model ?? DEEPSEEK_CHAT,
    system: opts.system,
    messages: [{ role: 'user', content: parts }],
    maxTokens: opts.maxTokens ?? 4096,
    temperature: 0.2,
  });
}
