/**
 * Canon tests (M16) — the spoiler-critical appearance slice used to prompt image generation.
 */

import { describe, expect, it } from 'vitest';
import { buildCanon, type AppearanceFact } from '../services/canon';

const f = (chapterOrder: number, factType: string, value: string): AppearanceFact => ({ chapterOrder, factType, value });

describe('buildCanon', () => {
  it('excludes post-boundary facts (no future appearance leaks)', () => {
    const facts = [f(2, 'hair', 'brown'), f(10, 'scar', 'across the eye')];
    const canon = buildCanon(facts, 5);
    expect(canon.facts).toEqual([{ factType: 'hair', value: 'brown' }]);
    expect(canon.facts.find((x) => x.factType === 'scar')).toBeUndefined();
  });

  it('supersedes an earlier fact of the same type with the latest ≤ boundary', () => {
    const facts = [f(1, 'hair', 'long brown'), f(4, 'hair', 'short black')];
    expect(buildCanon(facts, 5).facts).toEqual([{ factType: 'hair', value: 'short black' }]);
    // At an earlier boundary, the older fact still wins.
    expect(buildCanon(facts, 2).facts).toEqual([{ factType: 'hair', value: 'long brown' }]);
  });

  it('is order-independent and stable in its hash', () => {
    const a = buildCanon([f(1, 'hair', 'brown'), f(2, 'eyes', 'green')], 5);
    const b = buildCanon([f(2, 'eyes', 'green'), f(1, 'hair', 'brown')], 5);
    expect(a.canonHash).toBe(b.canonHash);
  });

  it('changes the hash when a new trait is revealed at a later boundary', () => {
    const facts = [f(1, 'hair', 'brown'), f(8, 'attire', 'red cloak')];
    expect(buildCanon(facts, 5).canonHash).not.toBe(buildCanon(facts, 10).canonHash);
  });

  it('empty canon (no facts yet) still yields a stable hash', () => {
    expect(buildCanon([], 5).facts).toEqual([]);
    expect(buildCanon([], 5).canonHash).toBe(buildCanon([], 99).canonHash);
  });
});
