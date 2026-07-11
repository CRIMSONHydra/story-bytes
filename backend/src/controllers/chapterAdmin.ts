/**
 * Chapter management endpoints (M13). Mutations (rename/toggle/delete/reorder/append) are gated by
 * adminAuth at the route layer since append incurs embedding cost. `estimate` is a free read.
 */

import { Request, Response } from 'express';
import { z } from 'zod';

import { asyncHandler, badRequest, fromZod, invalidId, notFound } from '../middleware/errors';
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
// Cap `text` (~100 pages) so an accidental huge paste can't fan out into thousands of embedding calls.
const MAX_PASTE_CHARS = 500_000;
const appendSchema = z.object({
  title: z.string().trim().min(1).max(500),
  text: z.string().trim().min(1).max(MAX_PASTE_CHARS),
  isFrontMatter: z.boolean().optional(),
});
const estimateSchema = z.object({ text: z.string().min(1).max(MAX_PASTE_CHARS) });

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

  // `order` must be exactly this story's chapter set — a subset/foreign id would leave untouched
  // chapters at their old positions and collide on the unique (story_id, chapter_order) index.
  const existing = await listChaptersForAdmin(storyId);
  const existingIds = new Set(existing.map((c) => c.chapterId));
  const provided = new Set(parsed.data.order);
  if (existingIds.size !== provided.size || [...existingIds].some((id) => !provided.has(id))) {
    throw badRequest('order must contain exactly the chapters for this story');
  }

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
