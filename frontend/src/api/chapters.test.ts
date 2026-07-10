/**
 * Chapter-management API tests (M13): correct paths/verbs incl. PATCH via the shared client.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { listChapters, appendChapter, estimateAppend, updateChapter, deleteChapter, reorderChapters } from './chapters';

const stub = (body: unknown, status = 200) => {
  const fn = vi.fn().mockResolvedValue({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  vi.stubGlobal('fetch', fn);
  return fn;
};

describe('chapters API', () => {
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('listChapters GETs the manage endpoint', async () => {
    const fn = stub({ chapters: [] });
    await listChapters('s1');
    expect(fn.mock.calls[0][0]).toContain('/api/stories/s1/chapters/manage');
    expect(fn.mock.calls[0][1].method).toBe('GET');
  });

  it('appendChapter POSTs title + text', async () => {
    const fn = stub({ chapterId: 'c', order: 3, blocks: 2 }, 201);
    const res = await appendChapter('s1', { title: 'T', text: 'body' });
    expect(res).toMatchObject({ order: 3, blocks: 2 });
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ title: 'T', text: 'body' });
  });

  it('estimateAppend POSTs to the estimate endpoint', async () => {
    const fn = stub({ chunks: 1, estimatedTokens: 20, estimatedCostUsd: 0.0001 });
    const est = await estimateAppend('s1', 'text');
    expect(est.chunks).toBe(1);
    expect(fn.mock.calls[0][0]).toContain('/chapters/estimate');
  });

  it('updateChapter uses PATCH', async () => {
    const fn = stub({ chapterId: 'c', order: 1, title: 'New', isFrontMatter: false, blockCount: 2 });
    await updateChapter('c', { title: 'New' });
    expect(fn.mock.calls[0][1].method).toBe('PATCH');
  });

  it('deleteChapter uses DELETE and returns the annotation count', async () => {
    const fn = stub({ deleted: true, annotationCount: 2 });
    const res = await deleteChapter('c');
    expect(res.annotationCount).toBe(2);
    expect(fn.mock.calls[0][1].method).toBe('DELETE');
  });

  it('reorderChapters POSTs the id order', async () => {
    const fn = stub({ reordered: 3 });
    await reorderChapters('s1', ['a', 'b', 'c']);
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ order: ['a', 'b', 'c'] });
  });
});
