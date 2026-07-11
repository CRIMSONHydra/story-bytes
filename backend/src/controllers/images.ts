/**
 * Character image endpoints (M17). `upToChapter` is required (spoiler boundary); an unrevealed entity
 * 404s (existence is a spoiler). Generation is admin-gated at the route layer (it incurs cost).
 */

import { Request, Response } from 'express';
import { z } from 'zod';

import { asyncHandler, badRequest, invalidId, notFound } from '../middleware/errors';
import { getOrGenerateEntityImage, getGeneratedImageFile, listCast } from '../services/imageGen';

const uuidSchema = z.string().uuid();
const boundarySchema = z.coerce.number().int().min(0);

const parseId = (v: unknown): string => {
  const p = uuidSchema.safeParse(v);
  if (!p.success) throw invalidId('Invalid id');
  return p.data;
};
const parseBoundary = (v: unknown): number => {
  const p = boundarySchema.safeParse(v);
  if (!p.success) throw badRequest('upToChapter (int >= 0) is required');
  return p.data;
};

export const handleGetCast = asyncHandler(async (req: Request, res: Response) => {
  const storyId = parseId(req.params.storyId);
  const boundary = parseBoundary(req.query.upToChapter);
  res.json({ cast: await listCast(storyId, boundary) });
});

export const handleGenerateEntityImage = asyncHandler(async (req: Request, res: Response) => {
  parseId(req.params.storyId);
  const entityId = parseId(req.params.entityId);
  const boundary = parseBoundary(req.query.upToChapter);
  const force = req.query.force === '1' || req.query.force === 'true';

  const result = await getOrGenerateEntityImage(entityId, boundary, { force });
  if (!result) throw notFound('Entity not found or not yet revealed');
  res.json(result);
});

export const handleServeGeneratedImage = asyncHandler(async (req: Request, res: Response) => {
  const imageId = parseId(req.params.imageId);
  const image = await getGeneratedImageFile(imageId);
  if (!image) throw notFound('Generated image not found');
  res.set('Content-Type', image.contentType);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(image.data);
});
