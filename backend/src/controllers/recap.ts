/**
 * Recap controller (plan §2.12, §2.14).
 * GET /api/stories/:storyId/recap?upToChapter=N&foreshadow=1
 *
 * The spoiler boundary is resolved server-side (never trusts a raw client value beyond honoring an
 * explicit chapter). Foreshadowing emphasis is opt-in via ?foreshadow=1 (off by default), so a
 * reader who wants a spoiler-clean recap gets zero hints.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { resolveSpoilerScope, DEFAULT_USER_ID } from '../services/spoilerScope';
import { buildRecap } from '../services/recap';

const querySchema = z.object({
  upToChapter: z.coerce.number().int().min(0).optional(),
  foreshadow: z.enum(['0', '1', 'true', 'false']).optional(),
});

const uuidSchema = z.string().uuid();

export const handleGetRecap = async (req: Request, res: Response) => {
  const storyIdParse = uuidSchema.safeParse(req.params.storyId);
  if (!storyIdParse.success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid story ID' } });
    return;
  }

  const queryParse = querySchema.safeParse(req.query);
  if (!queryParse.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: queryParse.error.format() } });
    return;
  }

  const { upToChapter, foreshadow } = queryParse.data;
  const includeForeshadow = foreshadow === '1' || foreshadow === 'true';
  const userId = (req.headers['x-user-id'] as string) || DEFAULT_USER_ID;

  try {
    const scope = await resolveSpoilerScope(storyIdParse.data, upToChapter, userId);
    const recap = await buildRecap(scope, includeForeshadow);
    res.json(recap);
  } catch (error) {
    console.error('Recap controller error:', error);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to build recap' } });
  }
};
