/**
 * Ingest job API tests (M5): terminal-state helper, poll GET, and multipart submit error mapping.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitIngest, getJob, isTerminal } from './jobs';
import { ApiError } from './client';

describe('jobs API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('isTerminal recognizes settled states only', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('active')).toBe(false);
  });

  it('getJob fetches the job detail', async () => {
    const detail = { job: { jobId: 'j1', status: 'active', storyId: null, error: null, filename: 'x' }, events: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(detail) }));
    await expect(getJob('j1')).resolves.toMatchObject({ job: { jobId: 'j1', status: 'active' } });
  });

  it('submitIngest posts multipart FormData and returns the accepted job', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ jobId: 'j2', status: 'queued' }) });
    vi.stubGlobal('fetch', fn);
    const res = await submitIngest(new File(['x'], 'book.epub'), 'My Series');
    expect(res).toMatchObject({ jobId: 'j2', status: 'queued' });
    expect(fn.mock.calls[0][1].method).toBe('POST');
    expect(fn.mock.calls[0][1].body).toBeInstanceOf(FormData);
  });

  it('submitIngest throws ApiError on a rejected upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: { code: 'VALIDATION_ERROR', message: 'bad file' } }),
    }));
    await expect(submitIngest(new File(['x'], 'bad.txt'))).rejects.toBeInstanceOf(ApiError);
  });
});
