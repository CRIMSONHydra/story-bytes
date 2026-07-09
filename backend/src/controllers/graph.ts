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

const uuidSchema = z.string().uuid();
const boundarySchema = z.coerce.number().int().min(0);

const badId = (res: Response) =>
  res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid id' } });
const needBoundary = (res: Response) =>
  res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'upToChapter (int >= 0) is required' } });

export const handleGetStoryGraph = async (req: Request, res: Response) => {
  const storyId = uuidSchema.safeParse(req.params.storyId);
  if (!storyId.success) return badId(res);
  const upTo = boundarySchema.safeParse(req.query.upToChapter);
  if (!upTo.success) return needBoundary(res);
  const typesParam = typeof req.query.types === 'string' ? req.query.types : undefined;
  const types = typesParam ? typesParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
  try {
    res.json(await getStoryGraph(storyId.data, upTo.data, types));
  } catch (error) {
    console.error('Graph controller error:', error);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to load graph' } });
  }
};

export const handleSearchEntities = async (req: Request, res: Response) => {
  const storyId = uuidSchema.safeParse(req.params.storyId);
  if (!storyId.success) return badId(res);
  const upTo = boundarySchema.safeParse(req.query.upToChapter);
  if (!upTo.success) return needBoundary(res);
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  try {
    res.json({ entities: await searchEntities(storyId.data, upTo.data, q, type) });
  } catch (error) {
    console.error('Entities controller error:', error);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to search entities' } });
  }
};

export const handleGetEntity = async (req: Request, res: Response) => {
  const entityId = uuidSchema.safeParse(req.params.entityId);
  if (!entityId.success) return badId(res);
  const upTo = boundarySchema.safeParse(req.query.upToChapter);
  if (!upTo.success) return needBoundary(res);
  try {
    const detail = await getEntityDetail(entityId.data, upTo.data);
    if (!detail) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Entity not found or not yet revealed' } });
      return;
    }
    res.json(detail);
  } catch (error) {
    console.error('Entity detail controller error:', error);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to load entity' } });
  }
};

export const handleGetThreads = async (req: Request, res: Response) => {
  const storyId = uuidSchema.safeParse(req.params.storyId);
  if (!storyId.success) return badId(res);
  const upTo = boundarySchema.safeParse(req.query.upToChapter);
  if (!upTo.success) return needBoundary(res);
  try {
    res.json({ threads: await getThreadsWithStatus(storyId.data, upTo.data) });
  } catch (error) {
    console.error('Threads controller error:', error);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to load threads' } });
  }
};
