/**
 * Database service for semantic search operations.
 * Uses pgvector for similarity search on text embeddings.
 */

import { pool } from '../db/pool';

/**
 * Represents a text block with similarity score from vector search.
 */
interface SimilarBlock {
  block_id: string;
  text_content: string;
  similarity: number;
  chapter_order: number;
  title: string;
}

interface ExternalKnowledge {
  knowledge_id: string;
  content: string;
  source_url: string;
  knowledge_type: 'fact' | 'theory' | 'speculation';
  similarity: number;
}

interface RelevantImage {
  asset_id: string;
  href: string;
  visual_description: string;
  enriched_metadata: Record<string, unknown>;
  similarity: number;
  chapter_order: number;
}

/**
 * Finds the most similar text blocks to a given embedding vector.
 * Uses pgvector's cosine distance operator (<=>) for similarity search.
 * 
 * @param embedding - The embedding vector to search for (array of numbers)
 * @param storyId - Optional story ID to filter results to a specific story
 * @param currentChapter - Optional chapter number to prevent spoilers (only returns blocks from this chapter or earlier)
 * @param limit - Maximum number of results to return (default: 5)
 * @returns Array of similar blocks with their similarity scores
 * 
 * @remarks
 * - Uses cosine distance (<=>) operator from pgvector extension
 * - Joins block_embeddings -> chapter_blocks -> chapters for filtering
 * - Filters by model name to ensure consistent embedding model
 * - Returns empty array on error to prevent breaking the calling code
 */
export const findSimilarBlocks = async (
  embedding: number[],
  storyId?: string,
  currentChapter?: number,
  limit = 5
): Promise<SimilarBlock[]> => {
  // SQL query explanation:
  // - Joins block_embeddings -> chapter_blocks -> chapters to access story and chapter metadata
  // - Filters by story_id if provided (for story-specific search)
  // - Filters by chapter_order <= currentChapter if provided (spoiler prevention)
  // - Uses pgvector's <=> operator for cosine distance (smaller = more similar)
  // - Calculates similarity as 1 - distance (converts distance to similarity score)
  const query = `
    SELECT 
      cb.block_id,
      cb.text_content,
      c.chapter_order,
      c.title,
      1 - (be.vector <=> $1) as similarity
    FROM block_embeddings be
    JOIN chapter_blocks cb ON be.block_id = cb.block_id
    JOIN chapters c ON cb.chapter_id = c.chapter_id
    WHERE 
      be.model = 'gemini-embedding-001'
      AND ($2::uuid IS NULL OR c.story_id = $2)
      AND ($3::int IS NULL OR c.chapter_order <= $3)
    ORDER BY be.vector <=> $1 ASC
    LIMIT $4;
  `;

  // Format embedding array as PostgreSQL array literal for pgvector
  // Example: [0.1, 0.2, 0.3] -> '[0.1,0.2,0.3]'
  const embeddingString = `[${embedding.join(',')}]`;

  try {
    const result = await pool.query(query, [
      embeddingString,
      storyId || null,
      currentChapter !== undefined ? currentChapter : null,
      limit
    ]);
    return result.rows;
  } catch (error) {
    console.error('Error finding similar blocks:', error);
    // Return empty array on error to prevent breaking the calling code
    return [];
  }
};

export const findSimilarExternalKnowledge = async (
  embedding: number[],
  storyId?: string,
  limit = 3
): Promise<ExternalKnowledge[]> => {
  const query = `
    SELECT 
      ek.knowledge_id,
      ek.content,
      ek.source_url,
      ek.knowledge_type,
      1 - (ke.vector <=> $1) as similarity
    FROM knowledge_embeddings ke
    JOIN external_knowledge ek ON ke.knowledge_id = ek.knowledge_id
    WHERE 
      ke.model = 'gemini-embedding-001'
      AND ($2::uuid IS NULL OR ek.story_id = $2)
    ORDER BY ke.vector <=> $1 ASC
    LIMIT $3;
  `;

  const embeddingString = `[${embedding.join(',')}]`;

  try {
    const result = await pool.query(query, [
      embeddingString,
      storyId || null,
      limit
    ]);
    return result.rows;
  } catch (error) {
    console.error('Error finding similar external knowledge:', error);
    return [];
  }
};

export const insertExternalKnowledge = async (
  storyId: string,
  content: string,
  sourceUrl: string,
  type: 'fact' | 'theory' | 'speculation',
  embedding: number[]
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertKnowledgeQuery = `
      INSERT INTO external_knowledge (story_id, content, source_url, knowledge_type)
      VALUES ($1, $2, $3, $4)
      RETURNING knowledge_id;
    `;
    const knowledgeRes = await client.query(insertKnowledgeQuery, [storyId, content, sourceUrl, type]);
    const knowledgeId = knowledgeRes.rows[0].knowledge_id;

    const embeddingString = `[${embedding.join(',')}]`;
    const insertEmbeddingQuery = `
      INSERT INTO knowledge_embeddings (knowledge_id, model, dimensions, vector)
      VALUES ($1, 'gemini-embedding-001', 768, $2);
    `;
    await client.query(insertEmbeddingQuery, [knowledgeId, embeddingString]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error inserting external knowledge:', error);
    throw error;
  } finally {
    client.release();
  }
};

export const getAllStories = async () => {
  const result = await pool.query('SELECT * FROM stories ORDER BY created_at DESC');
  return result.rows;
};

export const getStoryById = async (storyId: string) => {
  const result = await pool.query('SELECT * FROM stories WHERE story_id = $1', [storyId]);
  return result.rows[0];
};

const FRONT_MATTER_PATTERNS = [
  'Table of Contents', 'Color Inserts', 'Copyrights', 'Credits',
  'Title Page', 'Newsletter', 'Character Design', 'Copyright',
];
const FRONT_MATTER_FILTER = FRONT_MATTER_PATTERNS.map((_, i) => `title NOT ILIKE $${i + 2}`).join(' AND ');

export const getChaptersByStoryId = async (storyId: string) => {
  const result = await pool.query(
    `SELECT chapter_id, story_id, chapter_order, title
     FROM chapters
     WHERE story_id = $1 AND ${FRONT_MATTER_FILTER}
     ORDER BY chapter_order ASC`,
    [storyId, ...FRONT_MATTER_PATTERNS.map(p => `%${p}%`)]
  );
  return result.rows;
};

export const getChapterById = async (chapterId: string) => {
  const chapterResult = await pool.query('SELECT * FROM chapters WHERE chapter_id = $1', [chapterId]);
  if (chapterResult.rows.length === 0) return null;

  const chapter = chapterResult.rows[0];

  const blocksResult = await pool.query(
    'SELECT * FROM chapter_blocks WHERE chapter_id = $1 ORDER BY block_index ASC',
    [chapterId]
  );

  return { ...chapter, blocks: blocksResult.rows };
};

/**
 * Phase 3 Pass 3: Find relevant images by vector search on asset_embeddings.
 * Respects spoiler boundary via chapter_order filtering on the associated chapter_blocks.
 */
export const findRelevantImages = async (
  embedding: number[],
  storyId?: string,
  currentChapter?: number,
  limit = 3
): Promise<RelevantImage[]> => {
  const query = `
    SELECT DISTINCT ON (a.asset_id)
      a.asset_id,
      a.href,
      a.visual_description,
      a.enriched_metadata,
      1 - (ae.vector <=> $1) as similarity,
      c.chapter_order
    FROM asset_embeddings ae
    JOIN assets a ON ae.asset_id = a.asset_id
    LEFT JOIN chapter_blocks cb ON cb.image_src = a.href
    LEFT JOIN chapters c ON cb.chapter_id = c.chapter_id
    WHERE
      ae.model = 'gemini-embedding-001'
      AND ($2::uuid IS NULL OR a.story_id = $2)
      AND ($3::int IS NULL OR c.chapter_order IS NULL OR c.chapter_order <= $3)
    ORDER BY a.asset_id, ae.vector <=> $1 ASC
    LIMIT $4;
  `;

  const embeddingString = `[${embedding.join(',')}]`;

  try {
    const result = await pool.query(query, [
      embeddingString,
      storyId || null,
      currentChapter !== undefined ? currentChapter : null,
      limit,
    ]);
    return result.rows;
  } catch (error) {
    console.error('Error finding relevant images:', error);
    return [];
  }
};

/**
 * Phase 4: Keyword-based full-text search using PostgreSQL ts_vector.
 */
export const findBlocksByKeyword = async (
  query: string,
  storyId?: string,
  currentChapter?: number,
  limit = 5
): Promise<SimilarBlock[]> => {
  const sql = `
    SELECT
      cb.block_id,
      cb.text_content,
      c.chapter_order,
      c.title,
      ts_rank(to_tsvector('english', COALESCE(cb.text_content, '')), plainto_tsquery('english', $1)) as similarity
    FROM chapter_blocks cb
    JOIN chapters c ON cb.chapter_id = c.chapter_id
    WHERE
      to_tsvector('english', COALESCE(cb.text_content, '')) @@ plainto_tsquery('english', $1)
      AND ($2::uuid IS NULL OR c.story_id = $2)
      AND ($3::int IS NULL OR c.chapter_order <= $3)
    ORDER BY similarity DESC
    LIMIT $4;
  `;

  try {
    const result = await pool.query(sql, [
      query,
      storyId || null,
      currentChapter !== undefined ? currentChapter : null,
      limit,
    ]);
    return result.rows;
  } catch (error) {
    console.error('Error in keyword search:', error);
    return [];
  }
};

/**
 * Phase 4: Get or create a cached chapter summary.
 */
export const getCachedSummary = async (
  storyId: string,
  upToChapter: number,
  model: string
): Promise<string | null> => {
  const result = await pool.query(
    'SELECT summary_text FROM chapter_summaries WHERE story_id = $1 AND up_to_chapter = $2 AND model = $3',
    [storyId, upToChapter, model]
  );
  return result.rows[0]?.summary_text ?? null;
};

export const saveSummary = async (
  storyId: string,
  upToChapter: number,
  summaryText: string,
  model: string
): Promise<void> => {
  await pool.query(
    `INSERT INTO chapter_summaries (story_id, up_to_chapter, summary_text, model)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (story_id, up_to_chapter, model) DO UPDATE SET summary_text = EXCLUDED.summary_text, created_at = NOW()`,
    [storyId, upToChapter, summaryText, model]
  );
};

export const getChapterTexts = async (
  storyId: string,
  upToChapter: number
): Promise<{ chapter_order: number; title: string; aggregated_text: string }[]> => {
  const result = await pool.query(
    `SELECT chapter_order, title, aggregated_text
     FROM chapters
     WHERE story_id = $1 AND chapter_order <= $2
     ORDER BY chapter_order`,
    [storyId, upToChapter]
  );
  return result.rows;
};

/**
 * Phase 5: Reading progress
 */
export const getReadingProgress = async (userId: string, storyId: string): Promise<number | null> => {
  const result = await pool.query(
    'SELECT last_chapter_order FROM reading_progress WHERE user_id = $1 AND story_id = $2',
    [userId, storyId]
  );
  return result.rows[0]?.last_chapter_order ?? null;
};

export const upsertReadingProgress = async (userId: string, storyId: string, chapterOrder: number): Promise<void> => {
  await pool.query(
    `INSERT INTO reading_progress (user_id, story_id, last_chapter_order, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, story_id) DO UPDATE
       SET last_chapter_order = GREATEST(reading_progress.last_chapter_order, EXCLUDED.last_chapter_order),
           updated_at = NOW()`,
    [userId, storyId, chapterOrder]
  );
};

/**
 * Get asset binary data or storage info for serving images.
 */
export const getAssetById = async (assetId: string) => {
  const result = await pool.query(
    'SELECT asset_id, href, media_type, binary_data, storage_url FROM assets WHERE asset_id = $1',
    [assetId]
  );
  return result.rows[0] ?? null;
};
