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

vi.mock('../services/admin', () => ({
  getAdminStories: vi.fn(),
  deleteStory: vi.fn(),
  getSeriesTitleForStory: vi.fn(),
  getStoryIdsBySeriesTitle: vi.fn(),
  getDistinctSeries: vi.fn(),
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

  it('serves binary_data from DB with correct content-type', async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    vi.mocked(getAssetById).mockResolvedValueOnce({
      asset_id: TEST_UUID,
      href: 'test.png',
      media_type: 'image/png',
      binary_data: pngHeader,
      storage_url: null,
    });

    const response = await request(createApp()).get(`/api/assets/${TEST_UUID}/image`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['cache-control']).toContain('public');
  });

  it('redirects when storage_url is set', async () => {
    vi.mocked(getAssetById).mockResolvedValueOnce({
      asset_id: TEST_UUID,
      href: 'test.jpg',
      media_type: 'image/jpeg',
      binary_data: null,
      storage_url: 'https://s3.example.com/test.jpg',
    });

    const response = await request(createApp()).get(`/api/assets/${TEST_UUID}/image`);

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('https://s3.example.com/test.jpg');
  });

  it('returns 404 when asset has no binary_data, storage_url, or accessible href', async () => {
    vi.mocked(getAssetById).mockResolvedValueOnce({
      asset_id: TEST_UUID,
      href: 'nonexistent/image.jpg',
      media_type: null,
      binary_data: null,
      storage_url: null,
    });

    const response = await request(createApp()).get(`/api/assets/${TEST_UUID}/image`);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'Asset file not found' });
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

  it('returns 404 when EPUB file not found', async () => {
    vi.mocked(getStoryById).mockResolvedValueOnce({
      story_id: TEST_UUID,
      title: 'Nonexistent Book',
      epub_path: '/nonexistent/path.epub',
    });

    const response = await request(createApp())
      .get(`/api/stories/${TEST_UUID}/image`)
      .query({ path: 'Images/cover.jpg' });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'EPUB file not found for this story' });
  });

  it('returns 404 when epub_path is null and glob finds nothing', async () => {
    vi.mocked(getStoryById).mockResolvedValueOnce({
      story_id: TEST_UUID,
      title: 'xyzzy',
      epub_path: null,
    });

    const response = await request(createApp())
      .get(`/api/stories/${TEST_UUID}/image`)
      .query({ path: 'Images/cover.jpg' });

    expect(response.status).toBe(404);
  });
});

describe('getProjectRoot resolution', () => {
  it('uses process.cwd() in production', async () => {
    // Import the module fresh to test the helper
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    // The getProjectRoot helper should return cwd() in production
    // We verify this indirectly: a story with no epub_path and no matching glob returns 404
    // (not a crash from wrong path)
    vi.mocked(getStoryById).mockResolvedValueOnce({
      story_id: TEST_UUID,
      title: 'Test',
      epub_path: null,
    });

    const response = await request(createApp())
      .get(`/api/stories/${TEST_UUID}/image`)
      .query({ path: 'Images/test.jpg' });

    expect(response.status).toBe(404);
    // Should NOT be 500 (which would indicate a path resolution crash)

    process.env.NODE_ENV = originalEnv;
  });
});
