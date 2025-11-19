/**
 * Chat controller for handling user questions about stories.
 * Validates requests and delegates to RAG service for answer generation.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { answerQuery } from '../services/rag';

/**
 * Request body schema for chat endpoint.
 * Validates that query is a non-empty string, and optionally validates storyId and currentChapter.
 */
const chatRequestSchema = z.object({
  query: z.string().min(1),
  storyId: z.string().uuid().optional(),
  currentChapter: z.number().int().min(0).optional(),
});

/**
 * Handles POST /api/chat requests.
 * Validates the request body and uses RAG to generate an answer based on story context.
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const handleChat = async (req: Request, res: Response) => {
  // Validate request body against schema
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
    // Generate answer using RAG (Retrieval-Augmented Generation)
    const answer = await answerQuery(query, storyId, currentChapter);
    res.json({ answer });
  } catch (error) {
    console.error('Chat controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
