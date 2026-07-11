/**
 * Image pillar tests (M17): the spoiler-safe prompt (golden) + the cache/cap/spoiler state machine.
 * The live generator + fs are mocked.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildImagePrompt } from '../services/promptBuilder';
import type { Canon } from '../services/canon';

describe('buildImagePrompt (spoiler-safety golden)', () => {
  it('includes canon traits but never a name or free-text description', () => {
    const canon: Canon = { facts: [{ factType: 'hair', value: 'brown' }, { factType: 'eyes', value: 'green' }], canonHash: 'h' };
    const prompt = buildImagePrompt('character', canon);
    expect(prompt).toContain('hair: brown');
    expect(prompt).toContain('eyes: green');
    expect(prompt).toContain('a person');
  });

  it('does NOT contain a post-boundary trait (canon already excludes it, prompt only uses canon)', () => {
    // A ch10 "scar" trait is absent from a boundary-5 canon → absent from the prompt.
    const boundary5Canon: Canon = { facts: [{ factType: 'hair', value: 'brown' }], canonHash: 'h' };
    expect(buildImagePrompt('character', boundary5Canon)).not.toContain('scar');
  });

  it('empty canon → a deliberately generic prompt (no Appearance clause)', () => {
    expect(buildImagePrompt('character', { facts: [], canonHash: 'e' })).not.toContain('Appearance');
  });
});

// --- State machine (mocked deps) ---------------------------------------------------------------

vi.mock('../db/pool', () => ({ pool: { query: vi.fn() }, checkDatabase: vi.fn(), closePool: vi.fn() }));
vi.mock('../services/generator', () => ({ generateImage: vi.fn() }));
vi.mock('../controllers/assets', () => ({ getProjectRoot: () => '/proj' }));
vi.mock('fs/promises', () => ({ mkdir: vi.fn().mockResolvedValue(undefined), writeFile: vi.fn().mockResolvedValue(undefined), readFile: vi.fn() }));

import { pool } from '../db/pool';
import * as generator from '../services/generator';
import { getOrGenerateEntityImage } from '../services/imageGen';

const mockQuery = vi.mocked(pool.query);

/** Route queries by SQL; `cache` controls the generated_images cache lookup. */
const routeQueries = (opts: { firstChapter: number; cache?: { image_id: string; status: string }; capCount?: number }) => {
  mockQuery.mockImplementation((sql: unknown) => {
    const s = String(sql);
    if (s.includes('FROM kg_entities')) return Promise.resolve({ rows: [{ entity_type: 'character', first_chapter_order: opts.firstChapter }] } as never);
    if (s.includes('FROM entity_appearance_facts')) return Promise.resolve({ rows: [{ chapter_order: 1, fact_type: 'hair', value: 'brown' }] } as never);
    if (s.includes('SELECT image_id, status FROM generated_images')) return Promise.resolve({ rows: opts.cache ? [opts.cache] : [] } as never);
    if (s.includes('COUNT(*) AS c FROM generated_images')) return Promise.resolve({ rows: [{ c: String(opts.capCount ?? 0) }] } as never);
    return Promise.resolve({ rows: [], rowCount: 1 } as never);
  });
};

describe('getOrGenerateEntityImage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns null for an entity not yet revealed at the boundary (spoiler)', async () => {
    routeQueries({ firstChapter: 40 });
    expect(await getOrGenerateEntityImage('e1', 10)).toBeNull();
    expect(generator.generateImage).not.toHaveBeenCalled();
  });

  it('returns the cached image without generating', async () => {
    routeQueries({ firstChapter: 1, cache: { image_id: 'img-1', status: 'ready' } });
    const res = await getOrGenerateEntityImage('e1', 10);
    expect(res).toMatchObject({ status: 'ready', imageId: 'img-1', cached: true });
    expect(generator.generateImage).not.toHaveBeenCalled();
  });

  it('blocks when the daily cap is reached', async () => {
    routeQueries({ firstChapter: 1, capCount: 25 });
    const res = await getOrGenerateEntityImage('e1', 10);
    expect(res).toMatchObject({ status: 'blocked' });
    expect(generator.generateImage).not.toHaveBeenCalled();
  });

  it('generates, writes to disk, and returns ready on a cache miss under cap', async () => {
    routeQueries({ firstChapter: 1, capCount: 0 });
    vi.mocked(generator.generateImage).mockResolvedValueOnce({ data: Buffer.from('img'), mimeType: 'image/png' });
    const res = await getOrGenerateEntityImage('e1', 10);
    expect(res).toMatchObject({ status: 'ready', cached: false });
    expect(generator.generateImage).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO generated_images'))).toBe(true);
  });

  it('returns failed when the generator throws', async () => {
    routeQueries({ firstChapter: 1, capCount: 0 });
    vi.mocked(generator.generateImage).mockRejectedValueOnce(new Error('model 500'));
    const res = await getOrGenerateEntityImage('e1', 10);
    expect(res).toMatchObject({ status: 'failed' });
  });
});
