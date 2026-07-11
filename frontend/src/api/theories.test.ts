/**
 * Theory submission API tests (M19).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitTheory, getSubmission, isTerminal } from './theories';

const stub = (body: unknown, status = 200) => {
  const fn = vi.fn().mockResolvedValue({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  vi.stubGlobal('fetch', fn);
  return fn;
};

describe('theories API', () => {
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('isTerminal recognizes settled states', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('active')).toBe(false);
  });

  it('submitTheory POSTs the text (and sourceUrl when given)', async () => {
    const fn = stub({ submissionId: 's1', status: 'queued' }, 202);
    await submitTheory('story1', 'a long enough theory text', 'https://x.test/t');
    expect(fn.mock.calls[0][0]).toContain('/api/stories/story1/theories');
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ text: 'a long enough theory text', sourceUrl: 'https://x.test/t' });
  });

  it('submitTheory omits sourceUrl when not provided', async () => {
    const fn = stub({ submissionId: 's1', status: 'queued' }, 202);
    await submitTheory('story1', 'a long enough theory text');
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ text: 'a long enough theory text' });
  });

  it('getSubmission fetches the status', async () => {
    stub({ submissionId: 's1', status: 'completed', chunksKept: 2, error: null, createdAt: '' });
    await expect(getSubmission('s1')).resolves.toMatchObject({ status: 'completed', chunksKept: 2 });
  });

  it('submitTheory rejects (ApiError) on a 4xx', async () => {
    stub({ error: { code: 'VALIDATION_ERROR', message: 'too short' } }, 400);
    await expect(submitTheory('story1', 'x')).rejects.toMatchObject({ name: 'ApiError', code: 'VALIDATION_ERROR' });
  });
});
