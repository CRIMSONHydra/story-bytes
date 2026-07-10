/**
 * Chat controller for handling user questions about stories.
 * Validates requests and delegates to RAG service for answer generation.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { answerQuery } from '../services/rag';
import { DEFAULT_USER_ID } from '../services/spoilerScope';
import { ApiError, asyncHandler, fromZod } from '../middleware/errors';
import { logger } from '../services/logger';

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
export const handleChat = asyncHandler(async (req: Request, res: Response) => {
  const validation = chatRequestSchema.safeParse(req.body);
  if (!validation.success) throw fromZod(validation.error);

  const { query, storyId, currentChapter, mode } = validation.data;
  const userId = (req.headers['x-user-id'] as string) || DEFAULT_USER_ID;

  try {
    const result = await answerQuery(query, storyId, currentChapter, mode, userId);
    res.json(result);
  } catch (error) {
    // Hard pipeline failure (embedding/model/DB) surfaces as 502 with a correlation id — not a
    // 200 apology that hides the outage from monitoring (Improvement Plan M9 / §3.4). The request
    // id (echoed in the envelope) is the correlation handle.
    const requestId = (req as Request & { id?: string }).id;
    logger.error({ err: error, requestId }, 'Chat pipeline failed');
    throw new ApiError(502, 'chat_pipeline_failed', 'The assistant is temporarily unavailable.');
  }
});
