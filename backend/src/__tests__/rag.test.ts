/**
 * RAG service tests.
 * Verifies the retrieval-augmented generation pipeline works correctly,
 * including spoiler filtering, external knowledge integration, and response shape.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as llm from '../services/llm';
import * as db from '../services/db';
import * as search from '../services/search';
import { answerQuery } from '../services/rag';

// Shared mock setup: findBlocksByKeyword and findRelevantImages (Phase 3/4 additions)
const mockHybridSearch = () => {
  vi.spyOn(db, 'findBlocksByKeyword').mockResolvedValueOnce([]);
  vi.spyOn(db, 'findRelevantImages').mockResolvedValueOnce([]);
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
    mockHybridSearch();
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({
      generateContent: async () => ({
        response: { text: () => 'Rudeus is the main character.' },
      }),
    });

    const result = await answerQuery('Who is Rudeus?', 'story-1', 3);

    expect(llm.generateEmbedding).toHaveBeenCalledWith('Who is Rudeus?');
    expect(db.findSimilarBlocks).toHaveBeenCalledWith(fakeEmbedding, 'story-1', 3);
    expect(result.answer).toBe('Rudeus is the main character.');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].blockId).toBe('b1');
    expect(result.images).toHaveLength(0);
  });

  it('respects spoiler boundary by passing currentChapter to search', async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    vi.spyOn(llm, 'generateEmbedding').mockResolvedValueOnce(fakeEmbedding);
    vi.spyOn(db, 'findSimilarBlocks').mockResolvedValueOnce([]);
    mockHybridSearch();
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({
      generateContent: async () => ({
        response: { text: () => "I don't have enough information." },
      }),
    });

    await answerQuery('What happens in chapter 10?', 'story-1', 5);

    expect(db.findSimilarBlocks).toHaveBeenCalledWith(fakeEmbedding, 'story-1', 5);
  });

  it('triggers web search for theory questions', async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    vi.spyOn(llm, 'generateEmbedding').mockResolvedValueOnce(fakeEmbedding);
    vi.spyOn(db, 'findSimilarBlocks').mockResolvedValueOnce([]);
    mockHybridSearch();
    vi.spyOn(db, 'findSimilarExternalKnowledge').mockResolvedValueOnce([]);
    vi.spyOn(search, 'searchWeb').mockResolvedValueOnce([
      { title: 'Fan Theory', link: 'https://example.com', snippet: 'A popular theory...' },
    ]);
    vi.spyOn(db, 'insertExternalKnowledge').mockResolvedValueOnce();
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({
      generateContent: async () => ({
        response: { text: () => 'According to online theories...' },
      }),
    });

    const result = await answerQuery('What are the theories about the mana disaster?', 'story-1', 5);

    expect(search.searchWeb).toHaveBeenCalled();
    expect(result.answer).toContain('theories');
  });

  it('returns error message when pipeline fails', async () => {
    vi.spyOn(llm, 'generateEmbedding').mockRejectedValueOnce(new Error('API down'));

    const result = await answerQuery('test query');

    expect(result.answer).toContain('error');
    expect(result.sources).toHaveLength(0);
    expect(result.images).toHaveLength(0);
  });

  it('returns images when available from Phase 3', async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    vi.spyOn(llm, 'generateEmbedding').mockResolvedValueOnce(fakeEmbedding);
    vi.spyOn(db, 'findSimilarBlocks').mockResolvedValueOnce([]);
    vi.spyOn(db, 'findBlocksByKeyword').mockResolvedValueOnce([]);
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
    mockHybridSearch();

    const generateContent = vi.fn().mockResolvedValueOnce({
      response: { text: () => 'This could be setting up a major revelation...' },
    });
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({ generateContent });

    const result = await answerQuery('What does the letter hint at?', 'story-1', 5);

    // The prompt should contain foreshadowing instructions
    const promptArg = generateContent.mock.calls[0][0] as string;
    expect(promptArg).toContain('foreshadowing');
    expect(result.answer).toContain('setting up');
  });
});
