/**
 * Shared archive image helper (M16). Extracts an image out of an EPUB or CBZ (both ZIP containers)
 * by internal path, tolerating the common EPUB prefixes and falling back to a basename match.
 * `controllers/assets.ts` (on-demand serving) and the image pillar (reference images) both use it.
 */

import { readFile } from 'fs/promises';
import { extname } from 'path';

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
};

export const mimeForPath = (path: string): string => MIME_MAP[extname(path).toLowerCase()] || 'image/jpeg';

export interface ArchiveImage {
  data: Buffer;
  contentType: string;
}

/**
 * Read `internalPath` out of the ZIP archive at `archivePath`. Tries the exact path, then the common
 * `OEBPS/`/`OPS/` prefixes, then any entry whose basename matches. Returns null if not found.
 */
export const extractImageFromArchive = async (
  archivePath: string,
  internalPath: string,
): Promise<ArchiveImage | null> => {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await readFile(archivePath));

  for (const candidate of [internalPath, `OEBPS/${internalPath}`, `OPS/${internalPath}`]) {
    const entry = zip.file(candidate);
    if (entry) return { data: await entry.async('nodebuffer'), contentType: mimeForPath(candidate) };
  }

  const targetName = internalPath.split('/').pop()?.toLowerCase();
  if (targetName) {
    for (const [path, file] of Object.entries(zip.files)) {
      if (!file.dir && path.toLowerCase().endsWith(targetName)) {
        return { data: await file.async('nodebuffer'), contentType: mimeForPath(path) };
      }
    }
  }
  return null;
};
