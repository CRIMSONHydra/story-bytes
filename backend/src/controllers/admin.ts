import { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID, createHash } from 'crypto';
import { unlink, copyFile, mkdir, rm, readFile } from 'fs/promises';
import { resolve, basename } from 'path';
import { getAdminStories, deleteStory, getDistinctSeries } from '../services/admin';
import { getRagTrace } from '../services/db';
import { getProjectRoot } from './assets';
import { asyncHandler, badRequest, invalidId, notFound } from '../middleware/errors';
import { enqueueIngest } from '../jobs/queue';
import { createIngestJob, findReusableJobBySha } from '../jobs/progress';

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

const ALLOWED_EXT = ['.epub', '.cbz', '.cbr', '.txt', '.md', '.pdf'];

/**
 * M5: accept an upload, stage it durably, and ENQUEUE the ingest — returns 202 + jobId immediately
 * (no more multi-minute inline pipeline). The client polls GET /api/jobs/:jobId. Identical uploads
 * (same sha256) reuse the existing in-flight/completed job instead of re-ingesting.
 */
export const handleAdminIngest = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw badRequest('No file uploaded. Accepted: .epub, .cbz, .cbr, .txt, .md, .pdf');

  const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
  if (!ALLOWED_EXT.includes(ext)) throw badRequest(`Unsupported file type: ${ext}. Accepted: .epub, .cbz, .cbr, .txt, .md, .pdf`);

  const projectRoot = getProjectRoot();
  const fileName = basename(file.originalname);
  const seriesTitle = typeof req.body?.seriesTitle === 'string' ? req.body.seriesTitle : undefined;

  // Durable per-request work dir (survives the response; the worker cleans it up).
  const workDir = resolve(projectRoot, 'processed', `ingest-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const workFilePath = resolve(workDir, fileName);
  await copyFile(file.path, workFilePath);

  // Persistent copy in dataset/ for on-demand image serving (and the loader's epub_path glob).
  const datasetDir = resolve(projectRoot, 'dataset');
  await mkdir(datasetDir, { recursive: true });
  await copyFile(file.path, resolve(datasetDir, fileName));

  // Dedup by content hash so a double-submit doesn't ingest twice.
  const sha = createHash('sha256').update(await readFile(workFilePath)).digest('hex');
  await unlink(file.path).catch(() => { /* multer temp no longer needed */ });

  const existing = await findReusableJobBySha(sha);
  if (existing) {
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best effort */ });
    res.status(202).json({ jobId: existing.jobId, deduplicated: true, status: existing.status });
    return;
  }

  // If enqueue or the job-record write fails, don't orphan the staged work dir on disk.
  try {
    const jobId = await enqueueIngest({ filePath: workFilePath, workDir, filename: fileName, ext, seriesTitle });
    await createIngestJob(jobId, { sourceSha256: sha, filename: fileName, seriesTitle });
    res.status(202).json({ jobId, status: 'queued' });
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best effort */ });
    throw error;
  }
});
