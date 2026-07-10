/**
 * Async job types + queue names (M5).
 */

export const QUEUE_INGEST = 'ingest';
export const QUEUE_ENRICH = 'enrich-story';

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
