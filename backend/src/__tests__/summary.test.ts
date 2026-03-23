/**
 * Summary controller tests.
 * Verifies POST /api/stories/:storyId/summarize endpoint.
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

import { summarizeStory } from '../services/rag';

const TEST_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('POST /api/stories/:storyId/summarize', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('valid request returns summary', async () => {
    vi.mocked(summarizeStory).mockResolvedValueOnce('Alice journeyed through wonderland and met the Queen.');

    const response = await request(createApp())
      .post(`/api/stories/${TEST_UUID}/summarize`)
      .send({ upToChapter: 5 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      summary: 'Alice journeyed through wonderland and met the Queen.',
      storyId: TEST_UUID,
      upToChapter: 5,
    });
    expect(summarizeStory).toHaveBeenCalledWith(TEST_UUID, 5);
  });

  it('missing upToChapter returns 400', async () => {
    const response = await request(createApp())
      .post(`/api/stories/${TEST_UUID}/summarize`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid request' });
  });

  it('negative upToChapter returns 400', async () => {
    const response = await request(createApp())
      .post(`/api/stories/${TEST_UUID}/summarize`)
      .send({ upToChapter: -1 });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid request' });
  });

  it('returns 500 on error', async () => {
    vi.mocked(summarizeStory).mockRejectedValueOnce(new Error('LLM failure'));

    const response = await request(createApp())
      .post(`/api/stories/${TEST_UUID}/summarize`)
      .send({ upToChapter: 3 });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ error: 'Internal server error' });
  });
});
