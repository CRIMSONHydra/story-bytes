import { Request, Response } from 'express';
import { z } from 'zod';
import { answerQuery } from '../services/rag';

const chatRequestSchema = z.object({
  query: z.string().min(1),
  storyId: z.string().uuid().optional(),
  currentChapter: z.number().int().min(0).optional(),
});

export const handleChat = async (req: Request, res: Response) => {
  const validation = chatRequestSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({
      error: 'Invalid request',
      details: validation.error.format()
    });
    return;
  }

  const { query, storyId, currentChapter } = validation.data;

  try {
    const answer = await answerQuery(query, storyId, currentChapter);
    res.json({ answer });
  } catch (error) {
    console.error('Chat controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
