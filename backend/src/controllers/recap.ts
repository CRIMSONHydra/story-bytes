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
import { asyncHandler, fromZod, invalidId } from '../middleware/errors';

const querySchema = z.object({
  upToChapter: z.coerce.number().int().min(0).optional(),
  foreshadow: z.enum(['0', '1', 'true', 'false']).optional(),
});

const uuidSchema = z.string().uuid();

export const handleGetRecap = asyncHandler(async (req: Request, res: Response) => {
  const storyIdParse = uuidSchema.safeParse(req.params.storyId);
  if (!storyIdParse.success) throw invalidId('Invalid story ID');

  const queryParse = querySchema.safeParse(req.query);
  if (!queryParse.success) throw fromZod(queryParse.error, 'Invalid query');

  const { upToChapter, foreshadow } = queryParse.data;
  const includeForeshadow = foreshadow === '1' || foreshadow === 'true';
  const userId = req.userId ?? DEFAULT_USER_ID;

  const scope = await resolveSpoilerScope(storyIdParse.data, upToChapter, userId);
  const recap = await buildRecap(scope, includeForeshadow);
  res.json(recap);
});
