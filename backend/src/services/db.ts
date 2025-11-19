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
      be.model = 'text-embedding-004'
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
      ke.model = 'text-embedding-004'
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
      VALUES ($1, 'text-embedding-004', 768, $2);
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

export const getChaptersByStoryId = async (storyId: string) => {
  const result = await pool.query(
    'SELECT chapter_id, story_id, chapter_order, title FROM chapters WHERE story_id = $1 ORDER BY chapter_order ASC',
    [storyId]
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
