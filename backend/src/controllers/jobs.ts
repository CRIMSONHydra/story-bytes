/**
 * Job status/polling API (M5). The admin UI submits an ingest (202 + jobId), then polls
 * GET /api/jobs/:jobId for the status + event stream until it settles.
 */

import { Request, Response } from 'express';

import { asyncHandler, conflict, notFound } from '../middleware/errors';
import { getIngestJob, listIngestJobs, getJobEvents, setIngestStatus } from '../jobs/progress';
import { cancelIngestJob } from '../jobs/queue';
import { logger } from '../services/logger';

export const handleGetJob = asyncHandler(async (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;
  const job = await getIngestJob(jobId);
  if (!job) throw notFound('Job not found');
  const events = await getJobEvents(jobId);
  res.json({ job, events });
});

export const handleListJobs = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ jobs: await listIngestJobs() });
});

export const handleCancelJob = asyncHandler(async (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;
  const job = await getIngestJob(jobId);
  if (!job) throw notFound('Job not found');

  // A settled job must not be re-opened: overwriting a 'completed' status to 'cancelled' would also
  // drop it from sha-dedup (findReusableJobBySha excludes 'cancelled'), forcing a needless re-ingest.
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    throw conflict(`Job is already ${job.status}`);
  }

  // Best-effort cancel in pg-boss (no-op if already active/completed); reflect it in our record.
  try {
    await cancelIngestJob(jobId);
  } catch (error) {
    logger.warn({ err: error, jobId }, 'pg-boss cancel failed (job may already be running)');
  }
  await setIngestStatus(jobId, 'cancelled');
  res.json({ jobId, status: 'cancelled' });
});
