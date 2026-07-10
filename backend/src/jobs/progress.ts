/**
 * Job progress + bookkeeping (M5). Writes to the app-level `ingest_jobs` (status/result/dedup) and
 * `job_events` (append-only progress stream) tables that back the polling API.
 */

import { pool } from '../db/pool';
import type { IngestJob, JobEvent, JobStatus } from './types';

interface IngestJobRow {
  job_id: string;
  filename: string | null;
  series_title: string | null;
  status: JobStatus;
  story_id: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

const mapJob = (r: IngestJobRow): IngestJob => ({
  jobId: r.job_id,
  filename: r.filename,
  seriesTitle: r.series_title,
  status: r.status,
  storyId: r.story_id,
  error: r.error,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const JOB_COLS = 'job_id, filename, series_title, status, story_id, error, created_at, updated_at';

export const createIngestJob = async (
  jobId: string,
  fields: { sourceSha256?: string; filename: string; seriesTitle?: string },
): Promise<void> => {
  await pool.query(
    `INSERT INTO ingest_jobs (job_id, source_sha256, filename, series_title, status)
     VALUES ($1, $2, $3, $4, 'queued')`,
    [jobId, fields.sourceSha256 ?? null, fields.filename, fields.seriesTitle ?? null],
  );
};

export const setIngestStatus = async (
  jobId: string,
  status: JobStatus,
  fields: { storyId?: string; error?: string } = {},
): Promise<void> => {
  await pool.query(
    `UPDATE ingest_jobs
     SET status = $2,
         story_id = COALESCE($3, story_id),
         error = COALESCE($4, error),
         updated_at = NOW()
     WHERE job_id = $1`,
    [jobId, status, fields.storyId ?? null, fields.error ?? null],
  );
};

export const getIngestJob = async (jobId: string): Promise<IngestJob | null> => {
  const { rows } = await pool.query<IngestJobRow>(`SELECT ${JOB_COLS} FROM ingest_jobs WHERE job_id = $1`, [jobId]);
  return rows[0] ? mapJob(rows[0]) : null;
};

export const listIngestJobs = async (limit = 50): Promise<IngestJob[]> => {
  const { rows } = await pool.query<IngestJobRow>(
    `SELECT ${JOB_COLS} FROM ingest_jobs ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map(mapJob);
};

/** Dedup: the most recent job for identical file bytes that hasn't failed/cancelled. */
export const findReusableJobBySha = async (sha: string): Promise<IngestJob | null> => {
  const { rows } = await pool.query<IngestJobRow>(
    `SELECT ${JOB_COLS} FROM ingest_jobs
     WHERE source_sha256 = $1 AND status IN ('queued', 'active', 'completed')
     ORDER BY created_at DESC LIMIT 1`,
    [sha],
  );
  return rows[0] ? mapJob(rows[0]) : null;
};

export const recordJobEvent = async (
  jobId: string,
  e: { queue?: string; event: string; stage?: string; message?: string; payload?: Record<string, unknown> },
): Promise<void> => {
  await pool.query(
    `INSERT INTO job_events (job_id, queue, event, stage, message, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [jobId, e.queue ?? null, e.event, e.stage ?? null, e.message ?? null, e.payload ?? {}],
  );
};

export const getJobEvents = async (jobId: string): Promise<JobEvent[]> => {
  const { rows } = await pool.query<{
    event: string; stage: string | null; message: string | null;
    payload: Record<string, unknown>; created_at: Date;
  }>(
    `SELECT event, stage, message, payload, created_at FROM job_events
     WHERE job_id = $1 ORDER BY created_at`,
    [jobId],
  );
  return rows.map((r) => ({
    event: r.event,
    stage: r.stage ?? undefined,
    message: r.message ?? undefined,
    payload: r.payload,
    createdAt: r.created_at.toISOString(),
  }));
};
