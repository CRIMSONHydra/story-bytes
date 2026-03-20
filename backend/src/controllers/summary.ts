import { Request, Response } from 'express';
import { z } from 'zod';
import { summarizeStory } from '../services/rag';

const summarizeSchema = z.object({
  upToChapter: z.number().int().min(0),
});

export const handleSummarize = async (req: Request, res: Response) => {
  const storyId = req.params.storyId as string;
  const validation = summarizeSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({ error: 'Invalid request', details: validation.error.format() });
    return;
  }

  try {
    const summary = await summarizeStory(storyId, validation.data.upToChapter);
    res.json({ summary, storyId, upToChapter: validation.data.upToChapter });
  } catch (error) {
    console.error('Summary controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
