/**
 * RAG service tests.
 * Verifies the retrieval-augmented generation pipeline works correctly,
 * including spoiler filtering and external knowledge integration.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as llm from '../services/llm';
import * as db from '../services/db';
import * as search from '../services/search';
import { answerQuery } from '../services/rag';

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
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({
      generateContent: async () => ({
        response: { text: () => 'Rudeus is the main character.' },
      }),
    });

    const answer = await answerQuery('Who is Rudeus?', 'story-1', 3);

    expect(llm.generateEmbedding).toHaveBeenCalledWith('Who is Rudeus?');
    expect(db.findSimilarBlocks).toHaveBeenCalledWith(fakeEmbedding, 'story-1', 3);
    expect(answer).toBe('Rudeus is the main character.');
  });

  it('respects spoiler boundary by passing currentChapter to search', async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    vi.spyOn(llm, 'generateEmbedding').mockResolvedValueOnce(fakeEmbedding);
    vi.spyOn(db, 'findSimilarBlocks').mockResolvedValueOnce([]);
    vi.spyOn(llm, 'getModel').mockReturnValueOnce({
      generateContent: async () => ({
        response: { text: () => "I don't have enough information." },
      }),
    });

    await answerQuery('What happens in chapter 10?', 'story-1', 5);

    // Verify the currentChapter=5 is passed to findSimilarBlocks, which filters out chapters > 5
    expect(db.findSimilarBlocks).toHaveBeenCalledWith(fakeEmbedding, 'story-1', 5);
  });

  it('triggers web search for theory questions', async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    vi.spyOn(llm, 'generateEmbedding').mockResolvedValueOnce(fakeEmbedding);
    vi.spyOn(db, 'findSimilarBlocks').mockResolvedValueOnce([]);
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

    const answer = await answerQuery('What are the theories about the mana disaster?', 'story-1', 5);

    expect(search.searchWeb).toHaveBeenCalled();
    expect(answer).toContain('theories');
  });

  it('returns error message when pipeline fails', async () => {
    vi.spyOn(llm, 'generateEmbedding').mockRejectedValueOnce(new Error('API down'));

    const answer = await answerQuery('test query');

    expect(answer).toContain('error');
  });
});
