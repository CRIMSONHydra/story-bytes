/**
 * Theory-submission pipeline (M19). Runs the Python classify pipeline (paste → per-paragraph chunk →
 * spoiler-classify → embed → insert) in a pg-boss worker. The pipeline itself updates the
 * theory_submissions row's status/result; this handler just drives it and cleans up the staged file.
 */

import { unlink } from 'fs/promises';

import { runPythonJson } from '../../services/pythonRunner';
import { getProjectRoot } from '../../services/paths';
import { logger } from '../../services/logger';
import { failSubmission } from '../../services/theories';
import type { TheoryJobData } from '../types';

export const runTheoryPipeline = async (data: TheoryJobData): Promise<void> => {
  const projectRoot = getProjectRoot();
  const args = [
    'ingestion/external/pipeline.py',
    '--story-id', data.storyId,
    '--file', data.filePath,
    '--submission-id', data.submissionId,
  ];
  if (data.sourceUrl) args.push('--source-url', data.sourceUrl);
  if (data.userId) args.push('--user-id', data.userId);

  try {
    await runPythonJson(projectRoot, args);
  } catch (err) {
    // The pipeline normally marks the submission 'failed' itself, but if it never started (uv/script
    // missing) or crashed before writing status, force a terminal state so the client stops polling.
    logger.error({ err, submissionId: data.submissionId }, 'Theory pipeline failed');
    await failSubmission(data.submissionId, err instanceof Error ? err.message : 'pipeline failed')
      .catch((e) => logger.error({ err: e }, 'failSubmission fallback failed'));
  } finally {
    await unlink(data.filePath).catch(() => { /* best effort */ });
  }
};
