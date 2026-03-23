/**
 * Stories controller tests.
 * Verifies GET /api/stories and GET /api/stories/:id endpoints.
 */

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app';

vi.mock('../db/pool', () => ({
  pool: { query: vi.fn() },
  checkDatabase: vi.fn(),
  closePool: vi.fn(),
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

import { getAllStories, getStoryById } from '../services/db';

const TEST_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('GET /api/stories', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns array of stories', async () => {
    const mockStories = [
      { story_id: TEST_UUID, title: 'Test Story', authors: ['Author A'] },
      { story_id: '223e4567-e89b-12d3-a456-426614174000', title: 'Another Story', authors: ['Author B'] },
    ];
    vi.mocked(getAllStories).mockResolvedValueOnce(mockStories);

    const response = await request(createApp()).get('/api/stories');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({ story_id: TEST_UUID, title: 'Test Story' });
  });

  it('returns empty array when no stories', async () => {
    vi.mocked(getAllStories).mockResolvedValueOnce([]);

    const response = await request(createApp()).get('/api/stories');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('returns 500 on DB error', async () => {
    vi.mocked(getAllStories).mockRejectedValueOnce(new Error('DB connection failed'));

    const response = await request(createApp()).get('/api/stories');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ error: 'Internal server error' });
  });
});

describe('GET /api/stories/:id', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns story object', async () => {
    const mockStory = { story_id: TEST_UUID, title: 'Test Story', authors: ['Author A'] };
    vi.mocked(getStoryById).mockResolvedValueOnce(mockStory);

    const response = await request(createApp()).get(`/api/stories/${TEST_UUID}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ story_id: TEST_UUID, title: 'Test Story' });
  });

  it('returns 404 for nonexistent story', async () => {
    vi.mocked(getStoryById).mockResolvedValueOnce(undefined);

    const response = await request(createApp()).get(`/api/stories/${TEST_UUID}`);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'Story not found' });
  });
});
