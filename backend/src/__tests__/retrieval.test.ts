/**
 * M10 retrieval-ladder unit tests: RRF fusion + similarity floor, budgeted context assembly, and
 * query rewrite (intent classification, explicit-mode override, fail-open).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { reciprocalRankFusion, applyFloor } from '../services/fusion';
import { buildStoryContext, type ContextBlock } from '../services/contextBuilder';
import * as llm from '../services/llm';
import { rewriteQuery } from '../services/rewrite';

describe('reciprocalRankFusion', () => {
  const id = (x: { id: string }) => x.id;

  it('ranks an item appearing high in both lists above single-list items', () => {
    const semantic = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const keyword = [{ id: 'b' }, { id: 'd' }];
    const fused = reciprocalRankFusion([semantic, keyword], id);
    expect(fused[0].item.id).toBe('b'); // rank 2 + rank 1 across the two lists wins
    expect(fused.map((f) => f.item.id).sort()).toEqual(['a', 'b', 'c', 'd']); // deduped union
  });

  it('is deterministic and keeps the first-seen item object', () => {
    const l1 = [{ id: 'x', from: 1 }];
    const l2 = [{ id: 'x', from: 2 }];
    const fused = reciprocalRankFusion([l1, l2], (x) => x.id);
    expect(fused).toHaveLength(1);
    expect(fused[0].item.from).toBe(1);
  });
});

describe('applyFloor', () => {
  it('drops items below the floor', () => {
    const items = [{ s: 0.9 }, { s: 0.2 }, { s: 0.05 }];
    expect(applyFloor(items, (i) => i.s, 0.25)).toEqual([{ s: 0.9 }]);
  });
});

describe('buildStoryContext', () => {
  const block = (id: string, text: string, order = 1): ContextBlock => ({
    block_id: id, chapter_order: order, title: `Ch ${order}`, text_content: text, similarity: 0.5,
  });

  it('labels blocks [S1]..[Sn] in order', () => {
    const { context, used } = buildStoryContext([block('a', 'alpha'), block('b', 'beta')]);
    expect(context).toContain('[S1]');
    expect(context).toContain('[S2]');
    expect(context).toContain('alpha');
    expect(used).toHaveLength(2);
  });

  it('stops adding blocks once the char budget is exceeded', () => {
    const blocks = [block('a', 'x'.repeat(100)), block('b', 'y'.repeat(100)), block('c', 'z'.repeat(100))];
    const { used } = buildStoryContext(blocks, { maxChars: 250 });
    expect(used).toHaveLength(2); // a(100)+b(100)=200 ≤ 250; c would push to 300 → dropped
    expect(used.map((b) => b.block_id)).toEqual(['a', 'b']);
  });

  it('always includes at least the top block even if it alone exceeds the budget', () => {
    const { used } = buildStoryContext([block('a', 'x'.repeat(9000))], { maxChars: 100 });
    expect(used).toHaveLength(1);
  });
});

describe('rewriteQuery', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses a valid plan from the model', async () => {
    vi.spyOn(llm, 'generateJson').mockResolvedValueOnce({
      standaloneQuery: 'Who is Roxy?', subQueries: ['Roxy background'], entityMentions: ['Roxy'], intent: 'recall',
    });
    const plan = await rewriteQuery('who is she?', [{ role: 'user', content: 'Tell me about Roxy' }]);
    expect(plan.standaloneQuery).toBe('Who is Roxy?');
    expect(plan.entityMentions).toEqual(['Roxy']);
    expect(plan.intent).toBe('recall');
  });

  it('fails open to the raw query + recall intent when the model returns null', async () => {
    vi.spyOn(llm, 'generateJson').mockResolvedValueOnce(null);
    const plan = await rewriteQuery('what happens?');
    expect(plan).toEqual({ standaloneQuery: 'what happens?', subQueries: [], entityMentions: [], intent: 'recall' });
  });

  it('an explicit non-recall mode overrides the model intent', async () => {
    vi.spyOn(llm, 'generateJson').mockResolvedValueOnce({
      standaloneQuery: 'q', subQueries: [], entityMentions: [], intent: 'recall',
    });
    const plan = await rewriteQuery('q', [], 'theory');
    expect(plan.intent).toBe('theory');
  });

  it('fails open when generateJson throws', async () => {
    vi.spyOn(llm, 'generateJson').mockRejectedValueOnce(new Error('model down'));
    const plan = await rewriteQuery('q');
    expect(plan.intent).toBe('recall');
    expect(plan.standaloneQuery).toBe('q');
  });
});
