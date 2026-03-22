import { Request, Response } from 'express';
import { getAssetById, getStoryById } from '../services/db';
import { readFile, access } from 'fs/promises';
import { join, extname, resolve } from 'path';

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
};

/**
 * Serves an asset image by asset ID (from DB or filesystem).
 */
export const handleGetAssetImage = async (req: Request, res: Response) => {
  const assetId = req.params.assetId as string;

  try {
    const asset = await getAssetById(assetId);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    if (asset.binary_data) {
      res.set('Content-Type', asset.media_type || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(asset.binary_data);
      return;
    }

    if (asset.storage_url) {
      res.redirect(asset.storage_url);
      return;
    }

    if (asset.href) {
      const candidates = [
        asset.href,
        join('processed', asset.href),
        join('dataset', asset.href),
      ];

      for (const candidate of candidates) {
        try {
          const data = await readFile(candidate);
          const ext = extname(asset.href).toLowerCase();
          res.set('Content-Type', MIME_MAP[ext] || 'image/jpeg');
          res.set('Cache-Control', 'public, max-age=86400');
          res.send(data);
          return;
        } catch {
          // Try next candidate
        }
      }
    }

    res.status(404).json({ error: 'Asset file not found' });
  } catch (error) {
    console.error('Asset controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Serves an image from inside an EPUB archive by story ID + internal path.
 * Route: GET /api/stories/:storyId/image/*
 *
 * The internal path (e.g. "Images/image44.jpg" or "OEBPS/Images/foo.jpg")
 * is extracted from the EPUB (which is a ZIP file).
 */
export const handleGetStoryImage = async (req: Request, res: Response) => {
  const storyId = req.params.storyId as string;
  const imagePathStr = req.query.path as string;

  if (!imagePathStr) {
    res.status(400).json({ error: 'Image path required (use ?path=...)' });
    return;
  }

  try {
    const story = await getStoryById(storyId);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    // Find the EPUB file — use stored epub_path or fall back to glob search
    const projectRoot = resolve(process.cwd(), '..');
    let epubPath: string | null = null;

    // Prefer stored epub_path from database
    if (story.epub_path) {
      const candidate = resolve(projectRoot, story.epub_path);
      try {
        await access(candidate);
        epubPath = candidate;
      } catch { /* file not found, fall through to glob */ }
    }

    // Fallback: glob search with best-match scoring
    if (!epubPath) {
      const { globSync } = await import('glob');
      const matches = globSync(join(projectRoot, 'dataset', '**', '*.epub'));
      const titleLower = story.title.toLowerCase();
      const titleWords = titleLower.split(/\s+/).filter((w: string) => w.length > 3);
      let bestScore = 0;

      for (const match of matches) {
        const fileName = match.toLowerCase();
        const matchCount = titleWords.filter((w: string) => fileName.includes(w)).length;
        if (matchCount > bestScore) {
          bestScore = matchCount;
          epubPath = match;
        }
      }

      if (bestScore < 2) epubPath = null;
    }

    if (!epubPath) {
      res.status(404).json({ error: 'EPUB file not found for this story' });
      return;
    }

    // Extract image from EPUB (ZIP)
    const { default: JSZip } = await import('jszip');
    const epubData = await readFile(epubPath);
    const zip = await JSZip.loadAsync(epubData);

    // Try the exact path, then with common prefixes
    const candidates = [
      imagePathStr,
      `OEBPS/${imagePathStr}`,
      `OPS/${imagePathStr}`,
    ];

    for (const candidate of candidates) {
      const entry = zip.file(candidate);
      if (entry) {
        const data = await entry.async('nodebuffer');
        const ext = extname(candidate).toLowerCase();
        res.set('Content-Type', MIME_MAP[ext] || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(data);
        return;
      }
    }

    // Last resort: search all files in the ZIP for a matching filename
    const targetName = imagePathStr.split('/').pop()?.toLowerCase();
    if (targetName) {
      for (const [path, file] of Object.entries(zip.files)) {
        if (!file.dir && path.toLowerCase().endsWith(targetName)) {
          const data = await file.async('nodebuffer');
          const ext = extname(path).toLowerCase();
          res.set('Content-Type', MIME_MAP[ext] || 'image/jpeg');
          res.set('Cache-Control', 'public, max-age=86400');
          res.send(data);
          return;
        }
      }
    }

    res.status(404).json({ error: 'Image not found in EPUB' });
  } catch (error) {
    console.error('Story image controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
