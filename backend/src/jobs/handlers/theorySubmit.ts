/**
 * Theory-submission pipeline (M19). Runs the Python classify pipeline (paste → per-paragraph chunk →
 * spoiler-classify → embed → insert) in a pg-boss worker. The pipeline itself updates the
 * theory_submissions row's status/result; this handler just drives it and cleans up the staged file.
 */

import { unlink } from 'fs/promises';

import { runPythonJson } from '../../services/pythonRunner';
import { getProjectRoot } from '../../controllers/assets';
import { logger } from '../../services/logger';
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
    // The pipeline marks the submission 'failed' itself; log for diagnostics.
    logger.error({ err, submissionId: data.submissionId }, 'Theory pipeline failed');
  } finally {
    await unlink(data.filePath).catch(() => { /* best effort */ });
  }
};
