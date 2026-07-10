/**
 * Chapter management endpoints (M13). Mutations (rename/toggle/delete/reorder/append) are gated by
 * adminAuth at the route layer since append incurs embedding cost. `estimate` is a free read.
 */

import { Request, Response } from 'express';
import { z } from 'zod';

import { asyncHandler, fromZod, invalidId, notFound } from '../middleware/errors';
import {
  listChaptersForAdmin,
  updateChapter,
  deleteChapterWithCount,
  reorderChapters,
  appendChapter,
  estimateAppendCost,
} from '../services/chapters';

const uuidSchema = z.string().uuid();
const parseId = (v: unknown): string => {
  const p = uuidSchema.safeParse(v);
  if (!p.success) throw invalidId('Invalid id');
  return p.data;
};

const updateSchema = z
  .object({ title: z.string().trim().min(1).max(500).optional(), isFrontMatter: z.boolean().optional() })
  .refine((v) => v.title !== undefined || v.isFrontMatter !== undefined, { message: 'Nothing to update' });
const reorderSchema = z.object({ order: z.array(z.string().uuid()).min(1) });
const appendSchema = z.object({
  title: z.string().trim().min(1).max(500),
  text: z.string().trim().min(1),
  isFrontMatter: z.boolean().optional(),
});
const estimateSchema = z.object({ text: z.string().min(1) });

export const handleListChaptersAdmin = asyncHandler(async (req: Request, res: Response) => {
  res.json({ chapters: await listChaptersForAdmin(parseId(req.params.storyId)) });
});

export const handleUpdateChapter = asyncHandler(async (req: Request, res: Response) => {
  const chapterId = parseId(req.params.chapterId);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  const chapter = await updateChapter(chapterId, parsed.data);
  if (!chapter) throw notFound('Chapter not found');
  res.json(chapter);
});

export const handleDeleteChapter = asyncHandler(async (req: Request, res: Response) => {
  const chapterId = parseId(req.params.chapterId);
  const result = await deleteChapterWithCount(chapterId);
  if (!result) throw notFound('Chapter not found');
  res.json({ deleted: true, ...result });
});

export const handleReorderChapters = asyncHandler(async (req: Request, res: Response) => {
  const storyId = parseId(req.params.storyId);
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  await reorderChapters(storyId, parsed.data.order);
  res.json({ reordered: parsed.data.order.length });
});

export const handleAppendChapter = asyncHandler(async (req: Request, res: Response) => {
  const storyId = parseId(req.params.storyId);
  const parsed = appendSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  const result = await appendChapter(storyId, parsed.data.title, parsed.data.text, parsed.data.isFrontMatter ?? false);
  res.status(201).json(result);
});

export const handleEstimateAppend = asyncHandler(async (req: Request, res: Response) => {
  parseId(req.params.storyId);
  const parsed = estimateSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(estimateAppendCost(parsed.data.text));
});
