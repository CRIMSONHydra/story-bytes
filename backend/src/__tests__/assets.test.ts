/**
 * Assets controller tests.
 * Verifies GET /api/assets/:assetId/image and GET /api/stories/:storyId/image endpoints.
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

import { getAssetById, getStoryById } from '../services/db';

const TEST_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('GET /api/assets/:assetId/image', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 404 for nonexistent asset', async () => {
    vi.mocked(getAssetById).mockResolvedValueOnce(undefined);

    const response = await request(createApp()).get(`/api/assets/${TEST_UUID}/image`);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'Asset not found' });
  });
});

describe('GET /api/stories/:storyId/image', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 404 when no story found', async () => {
    vi.mocked(getStoryById).mockResolvedValueOnce(undefined);

    const response = await request(createApp())
      .get(`/api/stories/${TEST_UUID}/image`)
      .query({ path: 'Images/cover.jpg' });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'Story not found' });
  });

  it('returns 400 when no path query parameter', async () => {
    const response = await request(createApp()).get(`/api/stories/${TEST_UUID}/image`);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Image path required (use ?path=...)' });
  });
});
