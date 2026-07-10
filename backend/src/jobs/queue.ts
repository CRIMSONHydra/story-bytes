/**
 * pg-boss queue lifecycle (M5). Owns the single PgBoss instance: starts it, creates the ingest/enrich
 * queues, registers serial workers (localConcurrency 1 — ingest/enrich mutate the same story and must
 * not race), and drains gracefully on shutdown. Controllers enqueue/inspect/cancel through the thin
 * exports here so they can be mocked in tests without a real queue.
 */

import { PgBoss } from 'pg-boss';
import type { Job } from 'pg-boss';

import { env } from '../config/env';
import { logger } from '../services/logger';
import { QUEUE_INGEST, QUEUE_ENRICH, type IngestJobData, type EnrichJobData } from './types';
import { runIngestPipeline } from './handlers/ingest';
import { runEnrichPipeline } from './handlers/enrichStory';

let boss: PgBoss | null = null;

const requireBoss = (): PgBoss => {
  if (!boss) throw new Error('Job queue not started (call startJobs at boot)');
  return boss;
};

const SERIAL = { batchSize: 1, localConcurrency: 1 } as const;

/** Start pg-boss, create queues, and register the serial workers. Idempotent. */
export const startJobs = async (): Promise<void> => {
  if (boss) return;
  if (!env.databaseUrl) throw new Error('DATABASE_URL required to start the job queue');

  boss = new PgBoss(env.databaseUrl);
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.start();
  await boss.createQueue(QUEUE_INGEST);
  await boss.createQueue(QUEUE_ENRICH);

  await boss.work<IngestJobData>(QUEUE_INGEST, SERIAL, async ([job]: Job<IngestJobData>[]) => {
    const storyId = await runIngestPipeline(job.id, job.data);
    if (storyId) {
      await requireBoss().send(QUEUE_ENRICH, { storyId, parentJobId: job.id }, { retryLimit: 1 });
    }
  });

  await boss.work<EnrichJobData & { parentJobId?: string }>(
    QUEUE_ENRICH, SERIAL, async ([job]) => runEnrichPipeline(job.data),
  );

  logger.info('Job queue started (ingest + enrich workers registered)');
};

/** Graceful drain — let the in-flight job finish before the process exits. */
export const stopJobs = async (): Promise<void> => {
  if (!boss) return;
  await boss.stop({ graceful: true });
  boss = null;
};

export const enqueueIngest = async (data: IngestJobData): Promise<string> => {
  const jobId = await requireBoss().send(QUEUE_INGEST, data, { retryLimit: 1 });
  if (!jobId) throw new Error('Failed to enqueue ingest job');
  return jobId;
};

/** pg-boss's view of a job (state/output), or null. Used to reflect live queue state. */
export const getBossIngestJob = (jobId: string) => requireBoss().getJobById(QUEUE_INGEST, jobId);

export const cancelIngestJob = (jobId: string) => requireBoss().cancel(QUEUE_INGEST, jobId);
