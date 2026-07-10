/**
 * LLM usage/cost report (M6). Admin-only. Aggregates token usage and prices it at read time.
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errors';
import { getUsageSummary } from '../services/usage';

export const handleGetUsage = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getUsageSummary());
});
