/**
 * Chat controller for handling user questions about stories.
 * Validates requests and delegates to RAG service for answer generation.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { answerQuery } from '../services/rag';

/**
 * Request body schema for chat endpoint.
 * Supports optional mode parameter for foreshadowing/theory queries.
 */
const chatRequestSchema = z.object({
  query: z.string().min(1),
  storyId: z.string().uuid().optional(),
  currentChapter: z.number().int().min(0).optional(),
  mode: z.enum(['recall', 'foreshadowing', 'theory']).optional(),
});

/**
 * Handles POST /api/chat requests.
 * Returns { answer, sources, images } for rich frontend display.
 */
export const handleChat = async (req: Request, res: Response) => {
  const validation = chatRequestSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({
      error: 'Invalid request',
      details: validation.error.format()
    });
    return;
  }

  const { query, storyId, currentChapter, mode } = validation.data;

  try {
    const result = await answerQuery(query, storyId, currentChapter, mode);
    res.json(result);
  } catch (error) {
    console.error('Chat controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
