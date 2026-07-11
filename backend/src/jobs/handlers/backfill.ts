/**
 * Backfill pipeline (M-Backfill). Brings an EXISTING story up to the current feature set by running,
 * in dependency order, the graph extraction → foreshadow linking → appearance-fact extraction. This
 * is what populates the Graph, Recap threads, and Cast portraits for a story that was ingested before
 * those features existed (e.g. the seed dump). Progress is streamed to job_events; status on
 * ingest_jobs (reused as the generic job record so GET /api/jobs/:jobId works).
 *
 * Note: chapter_micro_summaries + the RETRIEVAL_DOCUMENT re-embed steps are folded in once the
 * micro-summaries tier lands (deferred in M10) — the graph/foreshadow/appearance steps are what
 * unblock the Graph, Recap, and Cast surfaces today.
 */

import { runPythonJson } from '../../services/pythonRunner';
import { getProjectRoot } from '../../controllers/assets';
import { logger } from '../../services/logger';
import { QUEUE_BACKFILL, type BackfillJobData } from '../types';
import { recordJobEvent, setIngestStatus } from '../progress';

const STEPS: { stage: string; script: string }[] = [
  { stage: 'graph', script: 'ingestion/graph/extract_graph.py' },
  { stage: 'foreshadow', script: 'ingestion/graph/link_foreshadow.py' },
  { stage: 'appearance', script: 'ingestion/graph/extract_appearance.py' },
];

export const runBackfillPipeline = async (jobId: string, data: BackfillJobData): Promise<void> => {
  const projectRoot = getProjectRoot();
  const ev = (event: string, stage?: string, message?: string) =>
    recordJobEvent(jobId, { queue: QUEUE_BACKFILL, event, stage, message });

  await setIngestStatus(jobId, 'active');
  await ev('started', 'graph', 'Backfilling graph → foreshadow → appearance');

  try {
    for (const step of STEPS) {
      await ev('progress', step.stage, `Running ${step.stage} extraction`);
      await runPythonJson(projectRoot, [step.script, '--story-id', data.storyId]);
    }
    await setIngestStatus(jobId, 'completed', { storyId: data.storyId });
    await ev('completed', 'appearance', 'Backfill complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, jobId, storyId: data.storyId }, 'Backfill failed');
    await setIngestStatus(jobId, 'failed', { error: message });
    await ev('failed', undefined, message);
    throw error;
  }
};
