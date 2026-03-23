/**
 * Chapters controller tests.
 * Verifies GET /api/stories/:storyId/chapters and GET /api/chapters/:id endpoints.
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

import { getChaptersByStoryId, getChapterById } from '../services/db';

const TEST_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('GET /api/stories/:storyId/chapters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns filtered chapters array', async () => {
    const mockChapters = [
      { chapter_id: TEST_UUID, story_id: TEST_UUID, chapter_order: 1, title: 'Chapter 1' },
      { chapter_id: '223e4567-e89b-12d3-a456-426614174000', story_id: TEST_UUID, chapter_order: 2, title: 'Chapter 2' },
    ];
    vi.mocked(getChaptersByStoryId).mockResolvedValueOnce(mockChapters);

    const response = await request(createApp()).get(`/api/stories/${TEST_UUID}/chapters`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({ chapter_order: 1, title: 'Chapter 1' });
  });

  it('returns empty array', async () => {
    vi.mocked(getChaptersByStoryId).mockResolvedValueOnce([]);

    const response = await request(createApp()).get(`/api/stories/${TEST_UUID}/chapters`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe('GET /api/chapters/:id', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns chapter with blocks', async () => {
    const mockChapter = {
      chapter_id: TEST_UUID,
      story_id: TEST_UUID,
      chapter_order: 1,
      title: 'Chapter 1',
      blocks: [
        { block_id: 'b1', block_type: 'paragraph', content: 'Once upon a time...' },
      ],
    };
    vi.mocked(getChapterById).mockResolvedValueOnce(mockChapter);

    const response = await request(createApp()).get(`/api/chapters/${TEST_UUID}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      chapter_id: TEST_UUID,
      title: 'Chapter 1',
    });
    expect(response.body.blocks).toBeDefined();
  });

  it('returns 404 for nonexistent chapter', async () => {
    vi.mocked(getChapterById).mockResolvedValueOnce(null);

    const response = await request(createApp()).get(`/api/chapters/${TEST_UUID}`);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'Chapter not found' });
  });
});
