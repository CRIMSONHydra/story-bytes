/**
 * API client tests (M4): x-user-id header injection, JSON encode/decode, error-envelope → ApiError,
 * 204 handling, and AbortSignal passthrough.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, apiGet, ApiError } from './client';
import { setCurrentUserId } from './user';

const mockFetch = (status: number, body: unknown, ok = status < 400) => {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
};

describe('apiRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('does not send x-user-id when no profile is stored', async () => {
    const fn = mockFetch(200, { ok: true });
    await apiGet('/api/stories');
    const headers = fn.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['x-user-id']).toBeUndefined();
  });

  it('injects the stored profile id as x-user-id', async () => {
    setCurrentUserId('123e4567-e89b-12d3-a456-426614174000');
    const fn = mockFetch(200, { ok: true });
    await apiGet('/api/stories');
    const headers = fn.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['x-user-id']).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('JSON-encodes the body and sets Content-Type on writes', async () => {
    const fn = mockFetch(201, { userId: 'x' });
    await apiRequest('/api/users', { method: 'POST', body: { displayName: 'Bob' } });
    const init = fn.mock.calls[0][1];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ displayName: 'Bob' }));
  });

  it('parses the error envelope into a typed ApiError', async () => {
    mockFetch(404, { error: { code: 'NOT_FOUND', message: 'User not found' } }, false);
    await expect(apiGet('/api/users/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'NOT_FOUND',
      message: 'User not found',
    });
  });

  it('falls back to HTTP_ERROR when the body is not an envelope', async () => {
    mockFetch(500, 'plain text boom', false);
    const err = await apiGet('/api/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('HTTP_ERROR');
  });

  it('returns undefined for 204 No Content', async () => {
    mockFetch(204, undefined);
    await expect(apiRequest('/api/users/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('passes the AbortSignal through to fetch', async () => {
    const fn = mockFetch(200, {});
    const controller = new AbortController();
    await apiGet('/api/stories', controller.signal);
    expect(fn.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
