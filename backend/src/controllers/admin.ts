import { Request, Response } from 'express';
import { z } from 'zod';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { unlink, copyFile, mkdir, rm } from 'fs/promises';
import { resolve, basename } from 'path';
import { getAdminStories, deleteStory, getSeriesTitleForStory, getStoryIdsBySeriesTitle, getDistinctSeries } from '../services/admin';
import { getProjectRoot } from './assets';

const uuidSchema = z.string().uuid();

const PYTHON_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function runPython(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('uv', ['run', 'python', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PYTHON_TIMEOUT_MS,
    });
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

export const handleGetSeries = async (_req: Request, res: Response) => {
  try {
    const series = await getDistinctSeries();
    res.json(series);
  } catch (error) {
    console.error('Series list error:', error);
    res.status(500).json({ error: 'Failed to fetch series' });
  }
};

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

  const projectRoot = getProjectRoot();
  const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
  const fileName = basename(file.originalname);

  // Per-request work directory to prevent races between concurrent ingests
  const requestId = randomUUID();
  const workDir = resolve(projectRoot, 'processed', `ingest-${requestId}`);

  try {
    await mkdir(workDir, { recursive: true });

    // Copy file to work dir and to dataset/ for persistent image serving
    const workFilePath = resolve(workDir, fileName);
    await copyFile(file.path, workFilePath);

    const datasetDir = resolve(projectRoot, 'dataset');
    await mkdir(datasetDir, { recursive: true });
    await copyFile(file.path, resolve(datasetDir, fileName));

    // Step 1: Extract into per-request output dir
    let extractScript: string[];
    if (ext === '.epub') {
      extractScript = ['ingestion/epub/extract_epub.py', workFilePath, '-o', workDir, '-v'];
    } else if (ext === '.cbz' || ext === '.cbr') {
      extractScript = ['ingestion/comic/extract_comic.py', workFilePath, '-o', workDir, '-v', '--ocr'];
    } else {
      res.status(400).json({ error: `Unsupported file type: ${ext}` });
      return;
    }

    await runPython(projectRoot, extractScript);

    // Find the output JSON in the work dir
    const jsonStem = fileName.replace(/\.[^.]+$/, '');
    const outputJson = resolve(workDir, `${jsonStem}.json`);

    // Step 2: Load + tag images
    const seriesTitle = req.body?.seriesTitle as string | undefined;
    const loadArgs = ['ingestion/load_to_db.py', outputJson, '--tag-images'];
    if (seriesTitle) loadArgs.push('--series-title', seriesTitle);
    const loadOutput = await runPython(projectRoot, loadArgs);

    // Extract story_id from load output
    const storyIdMatch = loadOutput.match(/Story\s+([0-9a-f-]{36})/i)
      || loadOutput.match(/story_id.*?([0-9a-f-]{36})/i);

    // Step 3: Enrich images with story context
    if (storyIdMatch) {
      try {
        await runPython(projectRoot, ['ingestion/enrich_images.py', '--story-id', storyIdMatch[1]]);

        // Re-enrich entire series if this is part of one
        const storySeriesTitle = await getSeriesTitleForStory(storyIdMatch[1]);
        if (storySeriesTitle) {
          const seriesIds = await getStoryIdsBySeriesTitle(storySeriesTitle);
          for (const sid of seriesIds) {
            if (sid !== storyIdMatch[1]) {
              await runPython(projectRoot, ['ingestion/enrich_images.py', '--story-id', sid]);
            }
          }
        }
      } catch (enrichError) {
        console.warn('Image enrichment failed (non-fatal):', enrichError);
      }
    } else {
      console.warn(`Could not parse story_id from load_to_db.py output. Skipping enrichment. Output: ${loadOutput.slice(-200)}`);
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
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best effort cleanup */ });
  }
};
