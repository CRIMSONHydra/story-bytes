/**
 * Shared API client (M4). One place that: prepends API_BASE, attaches the `x-user-id` header from the
 * local profile store, JSON-encodes bodies, forwards an AbortSignal, and — critically — parses the
 * backend error envelope so callers get a typed `ApiError` (code + message) instead of a bare
 * `Response`. Replaces scattered raw `fetch` + ad-hoc error handling across the app.
 */

import { API_BASE } from '../config';
import { getCurrentUserId } from './user';
import type { ApiErrorBody } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const isErrorBody = (v: unknown): v is ApiErrorBody =>
  typeof v === 'object' && v !== null && 'error' in v &&
  typeof (v as ApiErrorBody).error === 'object' && (v as ApiErrorBody).error !== null &&
  typeof (v as ApiErrorBody).error.code === 'string';

export const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { method = 'GET', body, signal, headers = {} } = options;

  const finalHeaders: Record<string, string> = { ...headers };
  const userId = getCurrentUserId();
  if (userId) finalHeaders['x-user-id'] = userId;
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  // Guard against non-JSON bodies (proxy 502 HTML, plain-text errors): surface them as ApiError
  // instead of letting a SyntaxError escape the ApiError contract callers rely on.
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(
        res.status,
        res.ok ? 'PARSE_ERROR' : 'HTTP_ERROR',
        res.ok ? 'Invalid JSON in response body' : `Request failed with status ${res.status}`,
      );
    }
  }

  if (!res.ok) {
    if (isErrorBody(parsed)) {
      throw new ApiError(res.status, parsed.error.code, parsed.error.message, parsed.error.details);
    }
    throw new ApiError(res.status, 'HTTP_ERROR', `Request failed with status ${res.status}`);
  }

  return parsed as T;
};

export const apiGet = <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { signal });
export const apiPost = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  apiRequest<T>(path, { method: 'POST', body, signal });
export const apiPut = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  apiRequest<T>(path, { method: 'PUT', body, signal });
export const apiDelete = <T>(path: string, signal?: AbortSignal) =>
  apiRequest<T>(path, { method: 'DELETE', signal });
