import { Request, Response } from 'express';
import { z } from 'zod';
import { spawn } from 'child_process';
import { unlink, copyFile, mkdir } from 'fs/promises';
import { resolve, basename } from 'path';
import { getAdminStories, deleteStory, getSeriesTitleForStory, getStoryIdsBySeriesTitle } from '../services/admin';

const uuidSchema = z.string().uuid();

function runPython(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('uv', ['run', 'python', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Process exited ${code}: ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

export const handleAdminGetStories = async (_req: Request, res: Response) => {
  try {
    const stories = await getAdminStories();
    res.json(stories);
  } catch (error) {
    console.error('Admin stories error:', error);
    res.status(500).json({ error: 'Failed to fetch stories' });
  }
};

export const handleAdminDeleteStory = async (req: Request, res: Response) => {
  const parsed = uuidSchema.safeParse(req.params.storyId);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid story ID' });
    return;
  }

  try {
    const deleted = await deleteStory(parsed.data);
    if (deleted) {
      res.status(204).send();
    } else {
      res.status(404).json({ error: 'Story not found' });
    }
  } catch (error) {
    console.error('Admin delete error:', error);
    res.status(500).json({ error: 'Failed to delete story' });
  }
};

export const handleAdminIngest = async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded. Accepted: .epub, .cbz, .cbr' });
    return;
  }

  const projectRoot = resolve(process.cwd(), '..');
  const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
  const fileName = basename(file.originalname);

  try {
    // Copy file to dataset/ for persistent image serving
    const datasetDir = resolve(projectRoot, 'dataset');
    await mkdir(datasetDir, { recursive: true });
    const datasetPath = resolve(datasetDir, fileName);
    await copyFile(file.path, datasetPath);

    // Step 1: Extract
    const extractScript = ext === '.epub'
      ? ['ingestion/epub/extract_epub.py', datasetPath, '-o', 'processed', '-v']
      : ['ingestion/comic/extract_comic.py', datasetPath, '-o', 'processed', '-v', '--ocr'];

    await runPython(projectRoot, extractScript);

    // Find the output JSON
    const jsonStem = fileName.replace(/\.[^.]+$/, '');
    const outputJson = resolve(projectRoot, 'processed', `${jsonStem}.json`);

    // Step 2: Load + tag images
    const loadOutput = await runPython(projectRoot, [
      'ingestion/load_to_db.py', outputJson, '--tag-images'
    ]);

    // Extract story_id from load output
    const storyIdMatch = loadOutput.match(/Story\s+([0-9a-f-]{36})/i)
      || loadOutput.match(/story_id.*?([0-9a-f-]{36})/i);

    // Step 3: Enrich images with story context
    try {
      if (storyIdMatch) {
        await runPython(projectRoot, ['ingestion/enrich_images.py', '--story-id', storyIdMatch[1]]);

        // Re-enrich entire series if this is part of one
        const seriesTitle = await getSeriesTitleForStory(storyIdMatch[1]);
        if (seriesTitle) {
          const seriesIds = await getStoryIdsBySeriesTitle(seriesTitle);
          for (const sid of seriesIds) {
            if (sid !== storyIdMatch[1]) {
              await runPython(projectRoot, ['ingestion/enrich_images.py', '--story-id', sid]);
            }
          }
        }
      } else {
        // Fallback: enrich all
        await runPython(projectRoot, ['ingestion/enrich_images.py', '--all']);
      }
    } catch (enrichError) {
      console.warn('Image enrichment failed (non-fatal):', enrichError);
    }

    res.json({
      success: true,
      message: 'Ingestion complete',
      storyId: storyIdMatch?.[1] || null,
    });
  } catch (error) {
    console.error('Admin ingest error:', error);
    res.status(500).json({ error: 'Ingestion failed', details: String(error) });
  } finally {
    await unlink(file.path).catch(() => { /* best effort cleanup */ });
  }
};
