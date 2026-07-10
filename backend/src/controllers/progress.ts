import { Request, Response } from 'express';
import { z } from 'zod';
import { getReadingProgress, upsertReadingProgress } from '../services/db';
import { asyncHandler, fromZod } from '../middleware/errors';
import { DEFAULT_USER_ID } from '../services/spoilerScope';

const progressSchema = z.object({
  chapterOrder: z.number().int().min(0),
});

export const handleGetProgress = asyncHandler(async (req: Request, res: Response) => {
  const storyId = req.params.storyId as string;
  const userId = (req.headers['x-user-id'] as string) || DEFAULT_USER_ID;

  const progress = await getReadingProgress(userId, storyId);
  res.json({
    storyId,
    lastChapterOrder: progress?.lastChapterOrder ?? 0,
    lastChapterTitle: progress?.lastChapterTitle ?? '',
  });
});

export const handleUpdateProgress = asyncHandler(async (req: Request, res: Response) => {
  const storyId = req.params.storyId as string;
  const userId = (req.headers['x-user-id'] as string) || DEFAULT_USER_ID;
  const validation = progressSchema.safeParse(req.body);
  if (!validation.success) throw fromZod(validation.error);

  await upsertReadingProgress(userId, storyId, validation.data.chapterOrder);
  res.json({ storyId, lastChapterOrder: validation.data.chapterOrder });
});
