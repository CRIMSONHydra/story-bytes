/**
 * Chat controller for handling user questions about stories.
 * Validates requests and delegates to RAG service for answer generation.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { answerQuery } from '../services/rag';
import { DEFAULT_USER_ID } from '../services/spoilerScope';

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
  const userId = (req.headers['x-user-id'] as string) || DEFAULT_USER_ID;

  try {
    const result = await answerQuery(query, storyId, currentChapter, mode, userId);
    res.json(result);
  } catch (error) {
    // Hard pipeline failure (embedding/model/DB) surfaces as 502 with a correlation id — not a
    // 200 apology that hides the outage from monitoring (Improvement Plan M9 / §3.4).
    const traceId = randomUUID();
    console.error(`Chat pipeline failed (trace ${traceId}):`, error);
    res.status(502).json({ error: { code: 'chat_pipeline_failed', message: 'The assistant is temporarily unavailable.', traceId } });
  }
};
