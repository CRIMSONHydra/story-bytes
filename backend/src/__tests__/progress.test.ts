/**
 * Progress controller tests.
 * Verifies GET and PUT /api/stories/:storyId/progress endpoints.
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

import { getReadingProgress, upsertReadingProgress } from '../services/db';

const TEST_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('GET /api/stories/:storyId/progress', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns progress data', async () => {
    vi.mocked(getReadingProgress).mockResolvedValueOnce({
      lastChapterOrder: 7,
      lastChapterTitle: 'Chapter 7: The Trial',
    });

    const response = await request(createApp()).get(`/api/stories/${TEST_UUID}/progress`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      storyId: TEST_UUID,
      lastChapterOrder: 7,
      lastChapterTitle: 'Chapter 7: The Trial',
    });
  });

  it('returns defaults when no progress', async () => {
    vi.mocked(getReadingProgress).mockResolvedValueOnce(null);

    const response = await request(createApp()).get(`/api/stories/${TEST_UUID}/progress`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      storyId: TEST_UUID,
      lastChapterOrder: 0,
      lastChapterTitle: '',
    });
  });
});

describe('PUT /api/stories/:storyId/progress', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates progress', async () => {
    vi.mocked(upsertReadingProgress).mockResolvedValueOnce(undefined);

    const response = await request(createApp())
      .put(`/api/stories/${TEST_UUID}/progress`)
      .send({ chapterOrder: 5 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      storyId: TEST_UUID,
      lastChapterOrder: 5,
    });
    expect(upsertReadingProgress).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      TEST_UUID,
      5
    );
  });

  it('missing chapterOrder returns 400', async () => {
    const response = await request(createApp())
      .put(`/api/stories/${TEST_UUID}/progress`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid request' });
  });
});
