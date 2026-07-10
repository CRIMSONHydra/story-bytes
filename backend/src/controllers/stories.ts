import { Request, Response } from 'express';
import { getAllStories, getStoryById } from '../services/db';
import { asyncHandler, notFound } from '../middleware/errors';

export const handleGetStories = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getAllStories());
});

export const handleGetStory = asyncHandler(async (req: Request, res: Response) => {
  const story = await getStoryById(req.params.id as string);
  if (!story) throw notFound('Story not found');
  res.json(story);
});
