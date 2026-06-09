import { HttpError } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import { normTopicKey } from './preparedContentStore';

export type HandoutKind = 'pdf' | 'image';

export type TopicHandoutItem = {
  id: number;
  owner_key: string;
  author_name: string;
  topic: string;
  topic_norm: string;
  title: string;
  kind: HandoutKind;
  file_name: string;
  file_size: number;
  file_url: string;
  can_delete: boolean;
  sort_order: number;
  created_at: string;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

/** Brauzerda ko‘rish: /media/ har doim frontend domeni orqali (nginx proxy). */
const handoutBlobCache = new Map<number, string>();

export async function getHandoutFileBlobUrl(id: number): Promise<string> {
  const cached = handoutBlobCache.get(id);
  if (cached) return cached;
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const res = await fetch(`${apiBaseUrl()}/v1/handouts/${id}/file/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, null);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  handoutBlobCache.set(id, url);
  return url;
}

export function revokeHandoutBlobUrl(id: number): void {
  const url = handoutBlobCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    handoutBlobCache.delete(id);
  }
}

export function resolveHandoutFileUrl(fileUrl: string): string {
  if (!fileUrl) return '';
  try {
    const u = new URL(fileUrl, window.location.origin);
    if (u.pathname.startsWith('/media/')) {
      return `${window.location.origin}${u.pathname}${u.search}`;
    }
    return u.href;
  } catch {
    if (fileUrl.startsWith('/')) return `${window.location.origin}${fileUrl}`;
    return fileUrl;
  }
}

export function normHandoutTopic(topic: string): string {
  return normTopicKey(topic);
}

export async function fetchHandoutsForTopic(topic: string): Promise<TopicHandoutItem[]> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const topicNorm = normHandoutTopic(topic);
  const res = await fetch(
    `${apiBaseUrl()}/v1/handouts/?topic_norm=${encodeURIComponent(topicNorm)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const text = await res.text();
  let data: unknown = [];
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status}`, res.status, data);
  }
  return Array.isArray(data) ? (data as TopicHandoutItem[]) : [];
}

export async function uploadHandout(params: {
  topic: string;
  file: File;
  title?: string;
}): Promise<TopicHandoutItem> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const form = new FormData();
  form.append('topic', params.topic.trim());
  form.append('topic_norm', normHandoutTopic(params.topic));
  form.append('file', params.file);
  if (params.title?.trim()) form.append('title', params.title.trim());

  const res = await fetch(`${apiBaseUrl()}/v1/handouts/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status}`, res.status, data);
  }
  return data as TopicHandoutItem;
}

export async function deleteHandout(id: number): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const res = await fetch(`${apiBaseUrl()}/v1/handouts/${id}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* ignore */
    }
    throw new HttpError(`HTTP ${res.status}`, res.status, data);
  }
}

export function isAllowedHandoutFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const okExt = ['.pdf', '.jpg', '.jpeg', '.png'].some((e) => name.endsWith(e));
  const okType =
    file.type === 'application/pdf' ||
    file.type === 'image/jpeg' ||
    file.type === 'image/png' ||
    file.type === '';
  return okExt && okType;
}
