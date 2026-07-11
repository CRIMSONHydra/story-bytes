/**
 * Cast/image API tests (M17).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { listCast, generateEntityImage, generatedImageUrl } from './cast';

const stub = (body: unknown) => {
  const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  vi.stubGlobal('fetch', fn);
  return fn;
};

describe('cast API', () => {
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('listCast passes the boundary as upToChapter', async () => {
    const fn = stub({ cast: [] });
    await listCast('s1', 12);
    expect(fn.mock.calls[0][0]).toContain('/api/stories/s1/cast?upToChapter=12');
  });

  it('generateEntityImage POSTs with the boundary (and force when set)', async () => {
    const fn = stub({ status: 'ready', imageId: 'i1', cached: false });
    const res = await generateEntityImage('s1', 'e1', 12, true);
    expect(res).toMatchObject({ status: 'ready', imageId: 'i1' });
    expect(fn.mock.calls[0][0]).toContain('/entities/e1/image?upToChapter=12&force=1');
    expect(fn.mock.calls[0][1].method).toBe('POST');
  });

  it('generatedImageUrl builds the serve URL', () => {
    expect(generatedImageUrl('abc')).toContain('/api/generated-images/abc');
  });
});
