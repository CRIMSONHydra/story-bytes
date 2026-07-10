import { Request, Response } from 'express';
import { z } from 'zod';
import { summarizeStory } from '../services/rag';
import { asyncHandler, fromZod } from '../middleware/errors';

const summarizeSchema = z.object({
  upToChapter: z.number().int().min(0),
});

export const handleSummarize = asyncHandler(async (req: Request, res: Response) => {
  const storyId = req.params.storyId as string;
  const validation = summarizeSchema.safeParse(req.body);
  if (!validation.success) throw fromZod(validation.error);

  const summary = await summarizeStory(storyId, validation.data.upToChapter);
  res.json({ summary, storyId, upToChapter: validation.data.upToChapter });
});
