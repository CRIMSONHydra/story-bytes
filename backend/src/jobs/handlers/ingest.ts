/**
 * Ingest pipeline (M5) — the extract → load steps, moved out of the HTTP controller so they run in a
 * pg-boss worker. Records per-stage `job_events` and the terminal status on `ingest_jobs`. Returns
 * the new story_id (from the loader's JSONL `result` event) so the queue can enqueue enrichment.
 */

import { resolve } from 'path';
import { rm, unlink } from 'fs/promises';

import { runPythonJson } from '../../services/pythonRunner';
import { getProjectRoot } from '../../controllers/assets';
import { logger } from '../../services/logger';
import { QUEUE_INGEST, type IngestJobData } from '../types';
import { recordJobEvent, setIngestStatus } from '../progress';

const extractScriptFor = (ext: string, filePath: string, workDir: string): string[] | null => {
  if (ext === '.epub') return ['ingestion/epub/extract_epub.py', filePath, '-o', workDir, '-v'];
  if (ext === '.cbz' || ext === '.cbr') {
    return ['ingestion/comic/extract_comic.py', filePath, '-o', workDir, '-v', '--ocr'];
  }
  if (ext === '.txt' || ext === '.md') return ['ingestion/extract_text.py', filePath, '-o', workDir, '-v'];
  if (ext === '.pdf') return ['ingestion/extract_pdf.py', filePath, '-o', workDir, '-v'];
  return null;
};

/** Run the ingest pipeline for one job. Returns the story_id, or null if none was produced. */
export const runIngestPipeline = async (jobId: string, data: IngestJobData): Promise<string | null> => {
  const projectRoot = getProjectRoot();
  const ev = (event: string, stage?: string, message?: string, payload?: Record<string, unknown>) =>
    recordJobEvent(jobId, { queue: QUEUE_INGEST, event, stage, message, payload });

  await setIngestStatus(jobId, 'active');
  await ev('started', 'extract', `Ingesting ${data.filename}`);

  try {
    const extractScript = extractScriptFor(data.ext, data.filePath, data.workDir);
    if (!extractScript) throw new Error(`Unsupported file type: ${data.ext}`);
    await runPythonJson(projectRoot, extractScript);
    await ev('progress', 'load', 'Extraction complete; loading into the database');

    const jsonStem = data.filename.replace(/\.[^.]+$/, '');
    const outputJson = resolve(data.workDir, `${jsonStem}.json`);
    const loadArgs = ['ingestion/load_to_db.py', outputJson, '--tag-images'];
    if (data.seriesTitle) loadArgs.push('--series-title', data.seriesTitle);

    const load = await runPythonJson(projectRoot, loadArgs, {
      onProgress: (e) => void ev('progress', 'load', typeof e.title === 'string' ? e.title : undefined, e),
    });
    const storyId = typeof load.result?.story_id === 'string' ? load.result.story_id : null;

    await setIngestStatus(jobId, 'completed', { storyId: storyId ?? undefined });
    await ev('completed', 'load', storyId ? 'Loaded; enrichment queued' : 'Loaded (no story_id returned)',
      storyId ? { storyId } : undefined);
    return storyId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, jobId }, 'Ingest pipeline failed');
    await setIngestStatus(jobId, 'failed', { error: message });
    await ev('failed', undefined, message);
    throw error;
  } finally {
    await unlink(data.filePath).catch(() => { /* best effort */ });
    await rm(data.workDir, { recursive: true, force: true }).catch(() => { /* best effort */ });
  }
};
