import { pool } from '../db/pool';

export interface AdminStory {
  story_id: string;
  title: string;
  authors: string[];
  content_type: string;
  series_title: string | null;
  created_at: string;
  chapter_count: number;
  block_count: number;
  embedding_count: number;
  asset_count: number;
}

export const getAdminStories = async (): Promise<AdminStory[]> => {
  const result = await pool.query(`
    SELECT
      s.story_id, s.title, s.authors, s.content_type, s.series_title, s.created_at,
      (SELECT COUNT(*) FROM chapters WHERE story_id = s.story_id)::int AS chapter_count,
      (SELECT COUNT(*) FROM chapter_blocks cb
       JOIN chapters c ON cb.chapter_id = c.chapter_id
       WHERE c.story_id = s.story_id)::int AS block_count,
      (SELECT COUNT(*) FROM block_embeddings be
       JOIN chapter_blocks cb ON be.block_id = cb.block_id
       JOIN chapters c ON cb.chapter_id = c.chapter_id
       WHERE c.story_id = s.story_id)::int AS embedding_count,
      (SELECT COUNT(*) FROM assets WHERE story_id = s.story_id)::int AS asset_count
    FROM stories s
    ORDER BY s.created_at DESC
  `);
  return result.rows;
};

export const deleteStory = async (storyId: string): Promise<boolean> => {
  const result = await pool.query('DELETE FROM stories WHERE story_id = $1', [storyId]);
  return (result.rowCount ?? 0) > 0;
};

export const getSeriesTitleForStory = async (storyId: string): Promise<string | null> => {
  const result = await pool.query('SELECT series_title FROM stories WHERE story_id = $1', [storyId]);
  return result.rows[0]?.series_title ?? null;
};

export const getStoryIdsBySeriesTitle = async (seriesTitle: string): Promise<string[]> => {
  const result = await pool.query(
    'SELECT story_id FROM stories WHERE series_title = $1',
    [seriesTitle]
  );
  return result.rows.map((r: { story_id: string }) => r.story_id);
};
