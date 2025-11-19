import { pool } from '../db/pool';

interface SimilarBlock {
  block_id: string;
  text_content: string;
  similarity: number;
  chapter_order: number;
  title: string;
}

export const findSimilarBlocks = async (
  embedding: number[],
  storyId?: string,
  currentChapter?: number,
  limit: number = 5
): Promise<SimilarBlock[]> => {
  // We need to join block_embeddings -> chapter_blocks -> chapters
  // to filter by story_id and chapter_order (for spoiler prevention)

  // Note: pgvector uses <=> for cosine distance, <-> for Euclidean distance, <#> for inner product.
  // Usually for embeddings we want cosine similarity. 
  // 1 - (vector <=> query) is cosine similarity if vectors are normalized.
  // If we just want to sort by similarity, ordering by vector <=> query ASC is sufficient (smaller distance = higher similarity).

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

  // Format embedding array as a string for pgvector input: '[0.1, 0.2, ...]'
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
    return [];
  }
};
