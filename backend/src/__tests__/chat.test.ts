/**
 * Chat controller tests.
 * Verifies POST /api/chat endpoint with various modes and validation.
 */

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app';

vi.mock('../db/pool', () => ({
  pool: { query: vi.fn() },
  checkDatabase: vi.fn(),
  closePool: vi.fn(),
}));

vi.mock('../services/rag', () => ({
  answerQuery: vi.fn(),
  summarizeStory: vi.fn(),
}));

vi.mock('../services/db', () => ({
  getAllStories: vi.fn(),
  getStoryById: vi.fn(),
  getChaptersByStoryId: vi.fn(),
  getChapterById: vi.fn(),
  getAssetById: vi.fn(),
  getReadingProgress: vi.fn(),
  upsertReadingProgress: vi.fn(),
  getSeriesChapters: vi.fn(),
}));

import { answerQuery } from '../services/rag';

const TEST_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('POST /api/chat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('valid recall query returns answer, sources, and images', async () => {
    const mockResult = {
      answer: 'The protagonist is named Alice.',
      sources: [{ chapterOrder: 1, blockId: 'b1', title: 'Chapter 1' }],
      images: [{ assetId: TEST_UUID, href: 'images/alice.jpg', description: 'Alice portrait' }],
    };
    vi.mocked(answerQuery).mockResolvedValueOnce(mockResult);

    const response = await request(createApp())
      .post('/api/chat')
      .send({ query: 'Who is the protagonist?', storyId: TEST_UUID, currentChapter: 3 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      answer: 'The protagonist is named Alice.',
    });
    expect(response.body.sources).toBeDefined();
    expect(response.body.images).toBeDefined();
    expect(answerQuery).toHaveBeenCalledWith('Who is the protagonist?', TEST_UUID, 3, undefined);
  });

  it('missing query returns 400', async () => {
    const response = await request(createApp())
      .post('/api/chat')
      .send({ storyId: TEST_UUID });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid request' });
  });

  it('invalid storyId returns 400', async () => {
    const response = await request(createApp())
      .post('/api/chat')
      .send({ query: 'Who is the protagonist?', storyId: 'not-a-uuid' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid request' });
  });

  it('theory mode passes mode to service', async () => {
    const mockResult = {
      answer: 'Based on the evidence, this theory is plausible.',
      sources: [],
      images: [],
    };
    vi.mocked(answerQuery).mockResolvedValueOnce(mockResult);

    const response = await request(createApp())
      .post('/api/chat')
      .send({ query: 'Could the villain be the hero?', storyId: TEST_UUID, mode: 'theory' });

    expect(response.status).toBe(200);
    expect(answerQuery).toHaveBeenCalledWith(
      'Could the villain be the hero?',
      TEST_UUID,
      undefined,
      'theory'
    );
  });

  it('returns 500 on service error', async () => {
    vi.mocked(answerQuery).mockRejectedValueOnce(new Error('LLM API timeout'));

    const response = await request(createApp())
      .post('/api/chat')
      .send({ query: 'What happened?', storyId: TEST_UUID });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ error: 'Internal server error' });
  });
});
