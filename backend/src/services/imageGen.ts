/**
 * Entity image orchestration (M17). Spoiler-gates the entity (existence at the boundary), builds the
 * canon-only prompt, and runs a cache → cap → generate state machine:
 *   - cache: one image per (entity_id, canon_hash); an unchanged canon reuses it (unless `force`)
 *   - cap:   IMAGE_GEN_DAILY_CAP ready images/day (cost guard)
 *   - gate:  IMAGE_GEN_ENABLED must be on
 * Images are written to disk (private; served by id) and the exact prompt is stored for audit.
 */

import { randomUUID } from 'crypto';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { resolve } from 'path';

import { pool } from '../db/pool';
import { getProjectRoot } from '../controllers/assets';
import { getEntityCanon } from './canon';
import { buildImagePrompt } from './promptBuilder';
import { generateImage } from './generator';
import { recordUsage } from './usage';
import { logger } from './logger';
import { IMAGE_GEN_MODEL, IMAGE_GEN_ENABLED, IMAGE_GEN_DAILY_CAP } from '../config/models';

export interface EntityImageResult {
  status: 'ready' | 'blocked' | 'failed';
  imageId?: string;
  cached?: boolean;
  reason?: string;
}

const extFor = (mime: string): string =>
  mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';

/**
 * Return (or generate) the image for an entity at the boundary. Returns null when the entity is
 * unknown or not yet revealed (existence is a spoiler → the controller 404s).
 */
export const getOrGenerateEntityImage = async (
  entityId: string,
  boundary: number,
  opts: { force?: boolean } = {},
): Promise<EntityImageResult | null> => {
  const ent = (await pool.query<{ entity_type: string; first_chapter_order: number }>(
    'SELECT entity_type, first_chapter_order FROM kg_entities WHERE entity_id = $1',
    [entityId],
  )).rows[0];
  if (!ent || ent.first_chapter_order > boundary) return null; // unrevealed = spoiler

  const canon = await getEntityCanon(entityId, boundary);

  const cached = (await pool.query<{ image_id: string; status: string }>(
    'SELECT image_id, status FROM generated_images WHERE entity_id = $1 AND canon_hash = $2',
    [entityId, canon.canonHash],
  )).rows[0];
  if (cached && cached.status === 'ready' && !opts.force) {
    return { status: 'ready', imageId: cached.image_id, cached: true };
  }

  if (!IMAGE_GEN_ENABLED) return { status: 'blocked', reason: 'Image generation is disabled' };

  const today = Number((await pool.query<{ c: string }>(
    "SELECT COUNT(*) AS c FROM generated_images WHERE status = 'ready' AND created_at::date = CURRENT_DATE",
  )).rows[0].c);
  if (today >= IMAGE_GEN_DAILY_CAP) return { status: 'blocked', reason: 'Daily image cap reached' };

  const prompt = buildImagePrompt(ent.entity_type, canon);
  try {
    const image = await generateImage(prompt);
    const imageId = randomUUID();
    const dir = resolve(getProjectRoot(), 'generated');
    await mkdir(dir, { recursive: true });
    const filePath = resolve(dir, `${imageId}.${extFor(image.mimeType)}`);
    await writeFile(filePath, image.data);

    await pool.query(
      `INSERT INTO generated_images (image_id, entity_id, canon_hash, file_path, prompt, model, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'ready')
       ON CONFLICT (entity_id, canon_hash)
       DO UPDATE SET image_id = EXCLUDED.image_id, file_path = EXCLUDED.file_path,
                     prompt = EXCLUDED.prompt, model = EXCLUDED.model, status = 'ready', created_at = NOW()`,
      [imageId, entityId, canon.canonHash, filePath, prompt, IMAGE_GEN_MODEL],
    );
    recordUsage({ context: 'image-gen', model: IMAGE_GEN_MODEL, inputTokens: 0, outputTokens: 0 });
    return { status: 'ready', imageId, cached: false };
  } catch (err) {
    logger.error({ err, entityId }, 'Image generation failed');
    // Don't clobber an existing ready render (e.g. a failed force-regen keeps the old image).
    await pool.query(
      `INSERT INTO generated_images (entity_id, canon_hash, prompt, model, status)
       VALUES ($1, $2, $3, $4, 'failed') ON CONFLICT (entity_id, canon_hash) DO NOTHING`,
      [entityId, canon.canonHash, prompt, IMAGE_GEN_MODEL],
    );
    return { status: 'failed', reason: err instanceof Error ? err.message : 'generation error' };
  }
};

/** Serve a generated image's bytes from disk (ready only). */
export const getGeneratedImageFile = async (
  imageId: string,
): Promise<{ data: Buffer; contentType: string } | null> => {
  const row = (await pool.query<{ file_path: string | null }>(
    "SELECT file_path FROM generated_images WHERE image_id = $1 AND status = 'ready'",
    [imageId],
  )).rows[0];
  if (!row?.file_path) return null;
  try {
    const data = await readFile(row.file_path);
    const ct = row.file_path.endsWith('.png') ? 'image/png'
      : row.file_path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return { data, contentType: ct };
  } catch {
    return null;
  }
};

export interface CastMember {
  entityId: string;
  name: string;
  entityType: string;
  hasImage: boolean;
  imageId: string | null;
}

/** Revealed characters at the boundary, each flagged with whether their CURRENT canon has an image. */
export const listCast = async (storyId: string, boundary: number): Promise<CastMember[]> => {
  const entities = (await pool.query<{ entity_id: string; canonical_name: string; entity_type: string }>(
    `SELECT entity_id, canonical_name, entity_type FROM kg_entities
     WHERE story_id = $1 AND entity_type = 'character' AND first_chapter_order <= $2
     ORDER BY canonical_name`,
    [storyId, boundary],
  )).rows;

  const cast: CastMember[] = [];
  for (const e of entities) {
    const canon = await getEntityCanon(e.entity_id, boundary);
    const img = (await pool.query<{ image_id: string }>(
      "SELECT image_id FROM generated_images WHERE entity_id = $1 AND canon_hash = $2 AND status = 'ready'",
      [e.entity_id, canon.canonHash],
    )).rows[0];
    cast.push({
      entityId: e.entity_id, name: e.canonical_name, entityType: e.entity_type,
      hasImage: Boolean(img), imageId: img?.image_id ?? null,
    });
  }
  return cast;
};
