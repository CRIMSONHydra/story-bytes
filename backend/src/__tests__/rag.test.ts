/**
 * RAG service tests.
 * Verifies the retrieval-augmented generation pipeline works correctly,
 * including spoiler filtering, external knowledge integration, and response shape.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// Hermetic: mock the DB pool so any db/graph function NOT explicitly spied below (e.g.
// getImagesFromChapters, getForeshadowLinks) returns empty instead of attempting a real
// connection. Without this the suite silently passes on swallowed ECONNREFUSED errors in CI.
vi.mock('../db/pool', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }),
  },
  checkDatabase: vi.fn(),
  closePool: vi.fn(),
}));

import * as llm from '../services/llm';
import * as db from '../services/db';
import * as search from '../services/search';
import * as spoilerScope from '../services/spoilerScope';
import { answerQuery } from '../services/rag';

// Shared mock setup for hybrid search + series lookup
const mockDefaults = () => {
  vi.spyOn(db, 'findBlocksByKeyword').mockResolvedValueOnce([]);
  vi.spyOn(db, 'findRelevantImages').mockResolvedValueOnce([]);
  vi.spyOn(db, 'getStoriesInSeries').mockResolvedValueOnce([
    { story_id: 'story-1', title: 'Test Story Vol. 1' },
  ]);
};

describe('RAG answerQuery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates embedding and searches for similar blocks', async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    vi.spyOn(llm, 'generateEmbedding').mockResolvedValueOnce(fakeEmbedding);
    vi.spyOn(db, 'findSimilarBlocks').mockResolvedValueOnce([
      {
        block_id: 'b1',
        text_content: 'Rudeus began his new life.',
        similarity: 0.85,
        chapter_order: 1,
        title: 'Prologue',
      },
    ]);
    mockDefaults();
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({
      generateContent: async () => ({
        response: { text: () => 'Rudeus is the main character.' },
      }),
    });

    const result = await answerQuery('Who is Rudeus?', 'story-1', 3);

    expect(llm.generateEmbedding).toHaveBeenCalledWith('Who is Rudeus?', 'query');
    expect(db.findSimilarBlocks).toHaveBeenCalled();
    expect(result.answer).toBe('Rudeus is the main character.');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].blockId).toBe('b1');
    expect(result.images).toHaveLength(0);
  });

  it('respects spoiler boundary by passing currentChapter to search', async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    vi.spyOn(llm, 'generateEmbedding').mockResolvedValueOnce(fakeEmbedding);
    vi.spyOn(db, 'findSimilarBlocks').mockResolvedValueOnce([]);
    mockDefaults();
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({
      generateContent: async () => ({
        response: { text: () => "I don't have enough information." },
      }),
    });

    await answerQuery('What happens in chapter 10?', 'story-1', 5);

    // Verify findSimilarBlocks was called with storyId and currentChapter
    expect(db.findSimilarBlocks).toHaveBeenCalledWith(
      fakeEmbedding, 'story-1', 5, 5, undefined
    );
  });

  it('theory mode uses classified external knowledge and does NOT live-web-search (spoiler-safe interim)', async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    vi.spyOn(llm, 'generateEmbedding').mockResolvedValueOnce(fakeEmbedding);
    vi.spyOn(db, 'findSimilarBlocks').mockResolvedValueOnce([]);
    mockDefaults();
    const knownFacts = vi.spyOn(db, 'findSimilarExternalKnowledge').mockResolvedValueOnce([
      { knowledge_id: 'k1', content: 'A fan-submitted theory (classified safe).',
        source_url: 'https://reddit.com/r/test', knowledge_type: 'theory', similarity: 0.8 },
    ]);
    const webSearch = vi.spyOn(search, 'searchWeb');
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({
      generateContent: async () => ({
        response: { text: () => 'According to the available theories...' },
      }),
    });

    const result = await answerQuery('What are the theories about the mana disaster?', 'story-1', 5, 'theory');

    // Classified external knowledge IS consulted; raw live web search is NOT invoked (leak vector removed).
    expect(knownFacts).toHaveBeenCalled();
    expect(webSearch).not.toHaveBeenCalled();
    expect(result.answer).toContain('theories');
  });

  it('rethrows on hard pipeline failure so the controller can return 502', async () => {
    vi.spyOn(llm, 'generateEmbedding').mockRejectedValueOnce(new Error('API down'));
    // No longer masks the outage as a 200 apology — the failure propagates (M9 / §3.4).
    await expect(answerQuery('test query')).rejects.toThrow('API down');
  });

  it('returns images when available from Phase 3', async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    vi.spyOn(llm, 'generateEmbedding').mockResolvedValueOnce(fakeEmbedding);
    vi.spyOn(db, 'findSimilarBlocks').mockResolvedValueOnce([]);
    vi.spyOn(db, 'findBlocksByKeyword').mockResolvedValueOnce([]);
    vi.spyOn(db, 'getStoriesInSeries').mockResolvedValueOnce([
      { story_id: 'story-1', title: 'Test Story Vol. 1' },
    ]);
    vi.spyOn(db, 'findRelevantImages').mockResolvedValueOnce([
      {
        asset_id: 'a1',
        href: 'images/scene.jpg',
        visual_description: 'A sword training scene',
        enriched_metadata: { characters: ['Eris'] },
        similarity: 0.9,
        chapter_order: 2,
      },
    ]);
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({
      generateContent: async () => ({
        response: { text: () => 'Here is the training scene.' },
      }),
    });

    const result = await answerQuery('Show me training scenes', 'story-1', 5);

    expect(result.images).toHaveLength(1);
    expect(result.images[0].assetId).toBe('a1');
    expect(result.images[0].description).toBe('A sword training scene');
  });

  it('uses foreshadowing mode when hints are detected', async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    vi.spyOn(llm, 'generateEmbedding').mockResolvedValueOnce(fakeEmbedding);
    vi.spyOn(db, 'findSimilarBlocks').mockResolvedValueOnce([
      {
        block_id: 'b2',
        text_content: 'The strange letter hinted at something.',
        similarity: 0.8,
        chapter_order: 3,
        title: 'Chapter 3',
      },
    ]);
    mockDefaults();

    const generateContent = vi.fn().mockResolvedValueOnce({
      response: { text: () => 'This could be setting up a major revelation...' },
    });
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({ generateContent });

    const result = await answerQuery('What does the letter hint at?', 'story-1', 5);

    const promptArg = generateContent.mock.calls[0][0] as string;
    expect(promptArg).toContain('foreshadowing');
    expect(result.answer).toContain('setting up');
  });

  it('passes resolved prior volume IDs (volume_number order) for cross-volume search', async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    vi.spyOn(llm, 'generateEmbedding').mockResolvedValueOnce(fakeEmbedding);
    // The boundary + prior volumes now come from resolveSpoilerScope (volume_number ordered),
    // not the old title-sorted getStoriesInSeries.
    vi.spyOn(spoilerScope, 'resolveSpoilerScope').mockResolvedValueOnce({
      storyId: 'story-2', priorVolumeIds: ['story-1'], maxChapterOrder: 3,
      boundaryKey: 'story:story-2:ch:3',
    });
    vi.spyOn(db, 'findSimilarBlocks').mockResolvedValueOnce([]);
    vi.spyOn(db, 'findBlocksByKeyword').mockResolvedValueOnce([]);
    vi.spyOn(db, 'findRelevantImages').mockResolvedValueOnce([]);
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({
      generateContent: async () => ({
        response: { text: () => 'Answer with cross-volume context.' },
      }),
    });

    await answerQuery('Who is Rudeus?', 'story-2', 3);

    expect(db.findSimilarBlocks).toHaveBeenCalledWith(
      fakeEmbedding, 'story-2', 3, 5, ['story-1']
    );
  });

  it('defaults to a spoiler-safe boundary (0) when currentChapter is omitted and no progress', async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    vi.spyOn(llm, 'generateEmbedding').mockResolvedValueOnce(fakeEmbedding);
    // No requestedChapter and mocked reading_progress is empty -> resolveSpoilerScope yields 0.
    vi.spyOn(db, 'findSimilarBlocks').mockResolvedValueOnce([]);
    mockDefaults();
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({
      generateContent: async () => ({ response: { text: () => 'Not enough information.' } }),
    });

    await answerQuery('What happens next?', 'story-1');  // currentChapter omitted

    // Boundary resolves to 0 (default-deny), not undefined/"everything".
    expect(db.findSimilarBlocks).toHaveBeenCalledWith(fakeEmbedding, 'story-1', 0, 5, undefined);
  });
});
