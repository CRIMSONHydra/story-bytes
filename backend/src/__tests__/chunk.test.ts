/**
 * Chunker tests (M13) — mirrors the Python split_into_chunks semantics: short text unchanged,
 * paragraph-boundary splitting with 1-paragraph overlap, single long paragraph kept whole.
 */

import { describe, expect, it } from 'vitest';
import { splitIntoChunks } from '../services/chunk';

describe('splitIntoChunks', () => {
  it('returns short text unchanged', () => {
    expect(splitIntoChunks('a short paragraph')).toEqual(['a short paragraph']);
  });

  it('keeps a single over-long paragraph whole (never splits mid-paragraph)', () => {
    const long = 'x'.repeat(5000);
    expect(splitIntoChunks(long)).toEqual([long]);
  });

  it('splits on paragraph boundaries with a one-paragraph overlap', () => {
    const paras = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} ` + 'y'.repeat(500));
    const text = paras.join('\n\n');
    const chunks = splitIntoChunks(text, 1600, 1200);
    expect(chunks.length).toBeGreaterThan(1);
    // every chunk is composed of whole paragraphs
    for (const chunk of chunks) {
      for (const piece of chunk.split('\n\n')) expect(paras).toContain(piece);
    }
    // 1-paragraph overlap: the last paragraph of a chunk begins the next
    for (let i = 0; i < chunks.length - 1; i++) {
      const lastOfThis = chunks[i].split('\n\n').at(-1);
      const firstOfNext = chunks[i + 1].split('\n\n')[0];
      expect(lastOfThis).toBe(firstOfNext);
    }
  });
});
