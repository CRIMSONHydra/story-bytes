import { Request, Response } from 'express';
import { z } from 'zod';
import { getReadingProgress, upsertReadingProgress } from '../services/db';

const progressSchema = z.object({
  chapterOrder: z.number().int().min(0),
});

// Default user ID for single-user prototype
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

export const handleGetProgress = async (req: Request, res: Response) => {
  const storyId = req.params.storyId as string;
  const userId = (req.headers['x-user-id'] as string) || DEFAULT_USER_ID;

  try {
    const lastChapter = await getReadingProgress(userId, storyId);
    res.json({ storyId, lastChapterOrder: lastChapter ?? 0 });
  } catch (error) {
    console.error('Progress controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const handleUpdateProgress = async (req: Request, res: Response) => {
  const storyId = req.params.storyId as string;
  const userId = (req.headers['x-user-id'] as string) || DEFAULT_USER_ID;
  const validation = progressSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({ error: 'Invalid request', details: validation.error.format() });
    return;
  }

  try {
    await upsertReadingProgress(userId, storyId, validation.data.chapterOrder);
    res.json({ storyId, lastChapterOrder: validation.data.chapterOrder });
  } catch (error) {
    console.error('Progress controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
