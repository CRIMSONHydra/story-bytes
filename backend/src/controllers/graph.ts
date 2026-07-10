/**
 * Knowledge-graph reader endpoints (plan §3.5 KG, M15).
 *
 * `upToChapter` is a REQUIRED query param on every graph endpoint (400 if missing) — deliberately
 * breaking with the "omitted-means-everything" footgun. Entity existence is itself a spoiler, so
 * an entity not yet revealed at the boundary returns 404, not an empty body.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import {
  getStoryGraph,
  searchEntities,
  getEntityDetail,
  getThreadsWithStatus,
} from '../services/graph';
import { asyncHandler, badRequest, invalidId, notFound } from '../middleware/errors';

const uuidSchema = z.string().uuid();
const boundarySchema = z.coerce.number().int().min(0);

const parseBoundary = (value: unknown): number => {
  const parsed = boundarySchema.safeParse(value);
  if (!parsed.success) throw badRequest('upToChapter (int >= 0) is required');
  return parsed.data;
};

const parseId = (value: unknown): string => {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw invalidId('Invalid id');
  return parsed.data;
};

export const handleGetStoryGraph = asyncHandler(async (req: Request, res: Response) => {
  const storyId = parseId(req.params.storyId);
  const upTo = parseBoundary(req.query.upToChapter);
  const typesParam = typeof req.query.types === 'string' ? req.query.types : undefined;
  const types = typesParam ? typesParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
  res.json(await getStoryGraph(storyId, upTo, types));
});

export const handleSearchEntities = asyncHandler(async (req: Request, res: Response) => {
  const storyId = parseId(req.params.storyId);
  const upTo = parseBoundary(req.query.upToChapter);
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  res.json({ entities: await searchEntities(storyId, upTo, q, type) });
});

export const handleGetEntity = asyncHandler(async (req: Request, res: Response) => {
  const entityId = parseId(req.params.entityId);
  const upTo = parseBoundary(req.query.upToChapter);
  const detail = await getEntityDetail(entityId, upTo);
  if (!detail) throw notFound('Entity not found or not yet revealed');
  res.json(detail);
});

export const handleGetThreads = asyncHandler(async (req: Request, res: Response) => {
  const storyId = parseId(req.params.storyId);
  const upTo = parseBoundary(req.query.upToChapter);
  res.json({ threads: await getThreadsWithStatus(storyId, upTo) });
});
