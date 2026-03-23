import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

vi.mock('../db/pool', () => ({
  pool: {
    query: vi.fn(),
  },
  checkDatabase: vi.fn(),
  closePool: vi.fn(),
}));

vi.mock('../services/admin', () => ({
  getAdminStories: vi.fn(),
  deleteStory: vi.fn(),
  getSeriesTitleForStory: vi.fn(),
  getStoryIdsBySeriesTitle: vi.fn(),
}));

import { getAdminStories, deleteStory } from '../services/admin';

const app = createApp();

describe('Admin API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/admin/stories', () => {
    it('returns stories with counts', async () => {
      const mockStories = [
        {
          story_id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Test Story',
          authors: ['Author'],
          content_type: 'novel',
          series_title: null,
          created_at: '2024-01-01',
          chapter_count: 5,
          block_count: 20,
          embedding_count: 18,
          asset_count: 3,
        },
      ];
      vi.mocked(getAdminStories).mockResolvedValue(mockStories);

      const res = await request(app).get('/api/admin/stories');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].chapter_count).toBe(5);
    });
  });

  describe('DELETE /api/admin/stories/:storyId', () => {
    it('returns 204 on success', async () => {
      vi.mocked(deleteStory).mockResolvedValue(true);

      const res = await request(app).delete('/api/admin/stories/123e4567-e89b-12d3-a456-426614174000');
      expect(res.status).toBe(204);
    });

    it('returns 404 for nonexistent story', async () => {
      vi.mocked(deleteStory).mockResolvedValue(false);

      const res = await request(app).delete('/api/admin/stories/123e4567-e89b-12d3-a456-426614174000');
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await request(app).delete('/api/admin/stories/not-a-uuid');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/admin/ingest', () => {
    it('returns 400 without file', async () => {
      const res = await request(app).post('/api/admin/ingest');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No file');
    });
  });
});
