import { Request, Response } from 'express';
import { getChaptersByStoryId, getChapterById } from '../services/db';
import { asyncHandler, notFound } from '../middleware/errors';

export const handleGetChapters = asyncHandler(async (req: Request, res: Response) => {
  res.json(await getChaptersByStoryId(req.params.storyId as string));
});

export const handleGetChapter = asyncHandler(async (req: Request, res: Response) => {
  const chapter = await getChapterById(req.params.id as string);
  if (!chapter) throw notFound('Chapter not found');
  res.json(chapter);
});
