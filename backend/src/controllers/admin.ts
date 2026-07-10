import { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { unlink, copyFile, mkdir, rm } from 'fs/promises';
import { resolve, basename } from 'path';
import { getAdminStories, deleteStory, getSeriesTitleForStory, getStoryIdsBySeriesTitle, getDistinctSeries } from '../services/admin';
import { getRagTrace } from '../services/db';
import { getProjectRoot } from './assets';
import { asyncHandler, badRequest, invalidId, notFound } from '../middleware/errors';
import { logger } from '../services/logger';
import { runPythonJson } from '../services/pythonRunner';

const uuidSchema = z.string().uuid();

/** M9: inspect a RAG trace by id (debugging / eval). */
export const handleGetTrace = asyncHandler(async (req: Request, res: Response) => {
  const parsed = uuidSchema.safeParse(req.params.traceId);
  if (!parsed.success) throw invalidId('Invalid trace ID');
  const trace = await getRagTrace(parsed.data);
  if (!trace) throw notFound('Trace not found');
  res.json(trace);
});

export const handleGetSeries = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getDistinctSeries());
});

export const handleAdminGetStories = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getAdminStories());
});

export const handleAdminDeleteStory = asyncHandler(async (req: Request, res: Response) => {
  const parsed = uuidSchema.safeParse(req.params.storyId);
  if (!parsed.success) throw invalidId('Invalid story ID');

  const deleted = await deleteStory(parsed.data);
  if (!deleted) throw notFound('Story not found');
  res.status(204).send();
});

export const handleAdminIngest = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw badRequest('No file uploaded. Accepted: .epub, .cbz, .cbr');

  const projectRoot = getProjectRoot();
  const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
  const fileName = basename(file.originalname);

  // Per-request work directory to prevent races between concurrent ingests
  const requestId = randomUUID();
  const workDir = resolve(projectRoot, 'processed', `ingest-${requestId}`);

  try {
    await mkdir(workDir, { recursive: true });

    // Copy file to work dir and to dataset/ for persistent image serving
    const workFilePath = resolve(workDir, fileName);
    await copyFile(file.path, workFilePath);

    const datasetDir = resolve(projectRoot, 'dataset');
    await mkdir(datasetDir, { recursive: true });
    await copyFile(file.path, resolve(datasetDir, fileName));

    // Step 1: Extract into per-request output dir
    let extractScript: string[];
    if (ext === '.epub') {
      extractScript = ['ingestion/epub/extract_epub.py', workFilePath, '-o', workDir, '-v'];
    } else if (ext === '.cbz' || ext === '.cbr') {
      extractScript = ['ingestion/comic/extract_comic.py', workFilePath, '-o', workDir, '-v', '--ocr'];
    } else {
      throw badRequest(`Unsupported file type: ${ext}`);
    }

    await runPythonJson(projectRoot, extractScript);

    // Find the output JSON in the work dir
    const jsonStem = fileName.replace(/\.[^.]+$/, '');
    const outputJson = resolve(workDir, `${jsonStem}.json`);

    // Step 2: Load + tag images. story_id comes from the loader's terminal `result` JSONL event
    // (M3 stdout contract) — no more regex-scraping the log text.
    const seriesTitle = req.body?.seriesTitle as string | undefined;
    const loadArgs = ['ingestion/load_to_db.py', outputJson, '--tag-images'];
    if (seriesTitle) loadArgs.push('--series-title', seriesTitle);
    const load = await runPythonJson(projectRoot, loadArgs);
    const storyId = typeof load.result?.story_id === 'string' ? load.result.story_id : null;

    // Step 3: Enrich images with story context
    if (storyId) {
      try {
        await runPythonJson(projectRoot, ['ingestion/enrich_images.py', '--story-id', storyId]);

        // Re-enrich entire series if this is part of one
        const storySeriesTitle = await getSeriesTitleForStory(storyId);
        if (storySeriesTitle) {
          const seriesIds = await getStoryIdsBySeriesTitle(storySeriesTitle);
          for (const sid of seriesIds) {
            if (sid !== storyId) {
              await runPythonJson(projectRoot, ['ingestion/enrich_images.py', '--story-id', sid]);
            }
          }
        }
      } catch (enrichError) {
        logger.warn({ err: enrichError }, 'Image enrichment failed (non-fatal)');
      }
    } else {
      logger.warn('load_to_db.py emitted no result event with a story_id; skipping enrichment');
    }

    res.json({
      success: true,
      message: 'Ingestion complete',
      storyId,
    });
  } finally {
    // Best-effort cleanup regardless of success/failure; the error (if any) propagates to the
    // centralized error handler for a normalized 500 envelope.
    await unlink(file.path).catch(() => { /* best effort cleanup */ });
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best effort cleanup */ });
  }
});
