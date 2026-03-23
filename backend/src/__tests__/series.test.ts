/**
 * Series endpoint tests.
 * Verifies GET /api/series and GET /api/stories/:storyId/series-chapters endpoints.
 */

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app';

vi.mock('../db/pool', () => ({
  pool: { query: vi.fn() },
  checkDatabase: vi.fn(),
  closePool: vi.fn(),
}));

vi.mock('../services/admin', () => ({
  getDistinctSeries: vi.fn(),
  getAdminStories: vi.fn(),
  deleteStory: vi.fn(),
  getSeriesTitleForStory: vi.fn(),
  getStoryIdsBySeriesTitle: vi.fn(),
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

import { getDistinctSeries } from '../services/admin';
import { getSeriesChapters } from '../services/db';

const TEST_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('GET /api/series', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns series list', async () => {
    const mockSeries = [
      { series_title: 'Wonderland Chronicles', story_count: 3, first_story_id: TEST_UUID },
      { series_title: 'Dark Tower', story_count: 7, first_story_id: '223e4567-e89b-12d3-a456-426614174000' },
    ];
    vi.mocked(getDistinctSeries).mockResolvedValueOnce(mockSeries);

    const response = await request(createApp()).get('/api/series');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({ series_title: 'Wonderland Chronicles' });
  });

  it('returns empty array', async () => {
    vi.mocked(getDistinctSeries).mockResolvedValueOnce([]);

    const response = await request(createApp()).get('/api/series');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe('GET /api/stories/:storyId/series-chapters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns volumes with chapters', async () => {
    const mockData = [
      {
        story_id: TEST_UUID,
        story_title: 'Volume 1',
        chapters: [
          { chapter_order: 1, title: 'Chapter 1' },
          { chapter_order: 2, title: 'Chapter 2' },
        ],
      },
    ];
    vi.mocked(getSeriesChapters).mockResolvedValueOnce(mockData);

    const response = await request(createApp()).get(`/api/stories/${TEST_UUID}/series-chapters`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ story_id: TEST_UUID, story_title: 'Volume 1' });
    expect(response.body[0].chapters).toHaveLength(2);
  });

  it('returns 500 on error', async () => {
    vi.mocked(getSeriesChapters).mockRejectedValueOnce(new Error('DB failure'));

    const response = await request(createApp()).get(`/api/stories/${TEST_UUID}/series-chapters`);

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ error: 'Internal server error' });
  });
});
