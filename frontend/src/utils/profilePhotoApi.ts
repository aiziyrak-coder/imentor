import { HttpError } from '../api/httpClient';
import { ensureBackendAccessToken } from './backendAuth';
import { resolveHandoutFileUrl } from './handoutApi';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

export function resolveProfilePhotoUrl(photoURL: string | null | undefined): string {
  if (!photoURL) return '';
  if (photoURL.startsWith('data:')) return photoURL;
  return resolveHandoutFileUrl(photoURL);
}

export async function uploadStaffAvatar(blob: Blob): Promise<string> {
  const token = await ensureBackendAccessToken();
  const form = new FormData();
  form.append('file', blob, 'avatar.jpg');
  const res = await fetch(`${apiBaseUrl()}/v1/auth/me/avatar/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { detail?: string; file?: string[] };
      detail = body.detail || body.file?.[0] || '';
    } catch {
      /* ignore */
    }
    throw new HttpError(detail || 'avatar-upload-failed', res.status, null);
  }
  const data = (await res.json()) as { photo_url?: string };
  return data.photo_url?.trim() || '';
}

export async function deleteStaffAvatarOnServer(): Promise<void> {
  const token = await ensureBackendAccessToken();
  const res = await fetch(`${apiBaseUrl()}/v1/auth/me/avatar/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new HttpError('avatar-delete-failed', res.status, null);
  }
}
