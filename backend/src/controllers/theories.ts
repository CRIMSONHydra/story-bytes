/**
 * Theory submission endpoints (M19). Paste a fan theory → staged, classified async, spoiler-scoped.
 * POST returns 202 + submissionId; the client polls GET /api/theories/:submissionId.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';

import { asyncHandler, fromZod, invalidId, notFound } from '../middleware/errors';
import { getProjectRoot } from './assets';
import { enqueueTheory } from '../jobs/queue';
import { createSubmission, getSubmission, listSubmissions } from '../services/theories';
import { DEFAULT_USER_ID } from '../services/spoilerScope';

const uuidSchema = z.string().uuid();
const parseId = (v: unknown): string => {
  const p = uuidSchema.safeParse(v);
  if (!p.success) throw invalidId('Invalid id');
  return p.data;
};

const submitSchema = z.object({
  text: z.string().trim().min(20).max(500_000),
  sourceUrl: z.string().url().max(2000).optional(),
});

export const handleSubmitTheory = asyncHandler(async (req: Request, res: Response) => {
  const storyId = parseId(req.params.storyId);
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  const userId = req.userId ?? DEFAULT_USER_ID;

  const submissionId = await createSubmission(storyId, userId, parsed.data.sourceUrl);

  // Stage the pasted text to a durable file for the Python pipeline (worker cleans it up).
  const dir = resolve(getProjectRoot(), 'processed');
  await mkdir(dir, { recursive: true });
  const filePath = resolve(dir, `theory-${randomUUID()}.txt`);
  await writeFile(filePath, parsed.data.text, 'utf-8');

  await enqueueTheory({ submissionId, storyId, filePath, sourceUrl: parsed.data.sourceUrl, userId });
  res.status(202).json({ submissionId, status: 'queued' });
});

export const handleGetSubmission = asyncHandler(async (req: Request, res: Response) => {
  const submission = await getSubmission(parseId(req.params.submissionId));
  if (!submission) throw notFound('Submission not found');
  res.json(submission);
});

export const handleListSubmissions = asyncHandler(async (req: Request, res: Response) => {
  res.json({ submissions: await listSubmissions(parseId(req.params.storyId)) });
});
