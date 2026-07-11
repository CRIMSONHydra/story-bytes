/**
 * Theory submissions (M19) — bookkeeping for pasted fan theories going through the async classify
 * pipeline. The pipeline (Python) advances status → active/completed/failed; this reads it back.
 */

import { pool } from '../db/pool';

export interface TheorySubmission {
  submissionId: string;
  status: 'queued' | 'active' | 'completed' | 'failed';
  chunksKept: number | null;
  error: string | null;
  createdAt: string;
}

interface Row {
  submission_id: string;
  status: TheorySubmission['status'];
  chunks_kept: number | null;
  error: string | null;
  created_at: Date;
}

const map = (r: Row): TheorySubmission => ({
  submissionId: r.submission_id, status: r.status, chunksKept: r.chunks_kept,
  error: r.error, createdAt: r.created_at.toISOString(),
});

const COLS = 'submission_id, status, chunks_kept, error, created_at';

export const createSubmission = async (storyId: string, userId?: string, sourceUrl?: string): Promise<string> => {
  const { rows } = await pool.query<{ submission_id: string }>(
    `INSERT INTO theory_submissions (story_id, user_id, source_url, status)
     VALUES ($1, $2, $3, 'queued') RETURNING submission_id`,
    [storyId, userId ?? null, sourceUrl ?? null],
  );
  return rows[0].submission_id;
};

export const getSubmission = async (submissionId: string): Promise<TheorySubmission | null> => {
  const { rows } = await pool.query<Row>(`SELECT ${COLS} FROM theory_submissions WHERE submission_id = $1`, [submissionId]);
  return rows[0] ? map(rows[0]) : null;
};

export const listSubmissions = async (storyId: string, limit = 20): Promise<TheorySubmission[]> => {
  const { rows } = await pool.query<Row>(
    `SELECT ${COLS} FROM theory_submissions WHERE story_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [storyId, limit],
  );
  return rows.map(map);
};
