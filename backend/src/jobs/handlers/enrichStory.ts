/**
 * Enrichment pipeline (M5). Runs the image-enrichment script for a story and its series siblings.
 * Events are recorded under the ORIGINATING ingest job id (`parentJobId`) so the admin UI shows
 * enrichment progress on the same job timeline. Enrichment is post-completion polish: failures are
 * logged and surfaced as an event, but do not fail the ingest (which is already 'completed').
 */

import { runPythonJson } from '../../services/pythonRunner';
import { getProjectRoot } from '../../controllers/assets';
import { getSeriesTitleForStory, getStoryIdsBySeriesTitle } from '../../services/admin';
import { logger } from '../../services/logger';
import { QUEUE_ENRICH, type EnrichJobData } from '../types';
import { recordJobEvent } from '../progress';

export const runEnrichPipeline = async (data: EnrichJobData & { parentJobId?: string }): Promise<void> => {
  const projectRoot = getProjectRoot();
  const trackId = data.parentJobId ?? data.storyId;
  const ev = (event: string, message?: string, payload?: Record<string, unknown>) =>
    recordJobEvent(trackId, { queue: QUEUE_ENRICH, event, stage: 'enrich', message, payload });

  try {
    await ev('progress', 'Enriching images with story context');
    await runPythonJson(projectRoot, ['ingestion/enrich_images.py', '--story-id', data.storyId]);

    // Re-enrich the whole series so cross-volume character references resolve.
    const seriesTitle = await getSeriesTitleForStory(data.storyId);
    if (seriesTitle) {
      const seriesIds = await getStoryIdsBySeriesTitle(seriesTitle);
      for (const sid of seriesIds) {
        if (sid === data.storyId) continue;
        // Isolate each sibling: one failure shouldn't skip the rest (enrichment is non-fatal).
        try {
          await runPythonJson(projectRoot, ['ingestion/enrich_images.py', '--story-id', sid]);
        } catch (siblingErr) {
          logger.warn({ err: siblingErr, storyId: sid }, 'Sibling enrichment failed (non-fatal)');
        }
      }
    }
    await ev('progress', 'Enrichment complete');
  } catch (error) {
    // Non-fatal: the story is already ingested and readable.
    logger.warn({ err: error, storyId: data.storyId }, 'Enrichment failed (non-fatal)');
    await ev('warning', 'Image enrichment failed (non-fatal)');
  }
};
