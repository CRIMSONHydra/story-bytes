import { Request, Response } from 'express';
import { z } from 'zod';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { unlink, copyFile, mkdir, rm } from 'fs/promises';
import { resolve, basename } from 'path';
import { getAdminStories, deleteStory, getSeriesTitleForStory, getStoryIdsBySeriesTitle, getDistinctSeries } from '../services/admin';
import { getRagTrace } from '../services/db';
import { getProjectRoot } from './assets';
import { asyncHandler, badRequest, invalidId, notFound } from '../middleware/errors';
import { logger } from '../services/logger';

const uuidSchema = z.string().uuid();

/** M9: inspect a RAG trace by id (debugging / eval). */
export const handleGetTrace = asyncHandler(async (req: Request, res: Response) => {
  const parsed = uuidSchema.safeParse(req.params.traceId);
  if (!parsed.success) throw invalidId('Invalid trace ID');
  const trace = await getRagTrace(parsed.data);
  if (!trace) throw notFound('Trace not found');
  res.json(trace);
});

const PYTHON_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function runPython(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('uv', ['run', 'python', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PYTHON_TIMEOUT_MS,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Process exited ${code}: ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

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

    await runPython(projectRoot, extractScript);

    // Find the output JSON in the work dir
    const jsonStem = fileName.replace(/\.[^.]+$/, '');
    const outputJson = resolve(workDir, `${jsonStem}.json`);

    // Step 2: Load + tag images
    const seriesTitle = req.body?.seriesTitle as string | undefined;
    const loadArgs = ['ingestion/load_to_db.py', outputJson, '--tag-images'];
    if (seriesTitle) loadArgs.push('--series-title', seriesTitle);
    const loadOutput = await runPython(projectRoot, loadArgs);

    // Extract story_id from load output
    const storyIdMatch = loadOutput.match(/Story\s+([0-9a-f-]{36})/i)
      || loadOutput.match(/story_id.*?([0-9a-f-]{36})/i);

    // Step 3: Enrich images with story context
    if (storyIdMatch) {
      try {
        await runPython(projectRoot, ['ingestion/enrich_images.py', '--story-id', storyIdMatch[1]]);

        // Re-enrich entire series if this is part of one
        const storySeriesTitle = await getSeriesTitleForStory(storyIdMatch[1]);
        if (storySeriesTitle) {
          const seriesIds = await getStoryIdsBySeriesTitle(storySeriesTitle);
          for (const sid of seriesIds) {
            if (sid !== storyIdMatch[1]) {
              await runPython(projectRoot, ['ingestion/enrich_images.py', '--story-id', sid]);
            }
          }
        }
      } catch (enrichError) {
        logger.warn({ err: enrichError }, 'Image enrichment failed (non-fatal)');
      }
    } else {
      logger.warn(`Could not parse story_id from load_to_db.py output; skipping enrichment. Output: ${loadOutput.slice(-200)}`);
    }

    res.json({
      success: true,
      message: 'Ingestion complete',
      storyId: storyIdMatch?.[1] || null,
    });
  } finally {
    // Best-effort cleanup regardless of success/failure; the error (if any) propagates to the
    // centralized error handler for a normalized 500 envelope.
    await unlink(file.path).catch(() => { /* best effort cleanup */ });
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best effort cleanup */ });
  }
});
