/**
 * Async job types + queue names (M5).
 */

export const QUEUE_INGEST = 'ingest';
export const QUEUE_ENRICH = 'enrich-story';
export const QUEUE_THEORY = 'theory-submission';
export const QUEUE_BACKFILL = 'backfill';

/** Payload for a backfill job (M-Backfill) — bring a story up to the current feature set. */
export interface BackfillJobData {
  storyId: string;
}

/** Payload for a theory-submission job (M19). The pasted text is staged to `filePath`. */
export interface TheoryJobData {
  submissionId: string;
  storyId: string;
  filePath: string;
  sourceUrl?: string;
  userId?: string;
}

export type JobStatus = 'queued' | 'active' | 'completed' | 'failed' | 'cancelled';

/** Payload for an ingest job. The pg-boss job id doubles as our ingest_jobs.job_id. */
export interface IngestJobData {
  /** Absolute path to the staged upload in the durable work dir. */
  filePath: string;
  /** Directory to extract into (removed on completion). */
  workDir: string;
  filename: string;
  ext: string;
  seriesTitle?: string;
}

export interface EnrichJobData {
  storyId: string;
}

export interface JobEvent {
  event: string;
  stage?: string;
  message?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface IngestJob {
  jobId: string;
  filename: string | null;
  seriesTitle: string | null;
  status: JobStatus;
  storyId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
