/**
 * Ingest pipeline handler test (M5). pythonRunner, progress writes, project root, and fs cleanup are
 * mocked — asserts the happy path (active → completed, story_id returned, events recorded) and that a
 * failure marks the job failed and rethrows (so pg-boss can retry).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/pythonRunner', () => ({ runPythonJson: vi.fn() }));
vi.mock('../jobs/progress', () => ({ recordJobEvent: vi.fn(), setIngestStatus: vi.fn() }));
vi.mock('../controllers/assets', () => ({ getProjectRoot: () => '/proj' }));
vi.mock('fs/promises', () => ({ unlink: vi.fn().mockResolvedValue(undefined), rm: vi.fn().mockResolvedValue(undefined) }));

import { runIngestPipeline } from '../jobs/handlers/ingest';
import { runPythonJson } from '../services/pythonRunner';
import { setIngestStatus, recordJobEvent } from '../jobs/progress';

const data = { filePath: '/proj/processed/j/x.epub', workDir: '/proj/processed/j', filename: 'x.epub', ext: '.epub' };

describe('runIngestPipeline', () => {
  afterEach(() => vi.restoreAllMocks());

  it('extracts, loads, marks completed, and returns the story_id', async () => {
    vi.mocked(runPythonJson)
      .mockResolvedValueOnce({ result: null, events: [], stderrTail: '' })                 // extract
      .mockResolvedValueOnce({ result: { event: 'result', story_id: 's-42' }, events: [], stderrTail: '' }); // load

    const storyId = await runIngestPipeline('j1', data);

    expect(storyId).toBe('s-42');
    expect(setIngestStatus).toHaveBeenCalledWith('j1', 'active');
    expect(setIngestStatus).toHaveBeenCalledWith('j1', 'completed', { storyId: 's-42' });
    const events = vi.mocked(recordJobEvent).mock.calls.map((c) => c[1].event);
    expect(events).toContain('started');
    expect(events).toContain('completed');
  });

  it('rejects unsupported file types and marks the job failed', async () => {
    await expect(runIngestPipeline('j2', { ...data, ext: '.xyz' })).rejects.toThrow(/Unsupported/);
    expect(setIngestStatus).toHaveBeenCalledWith('j2', 'failed', expect.objectContaining({ error: expect.any(String) }));
  });

  it('propagates a loader failure (so the queue can retry) after marking failed', async () => {
    vi.mocked(runPythonJson)
      .mockResolvedValueOnce({ result: null, events: [], stderrTail: '' })  // extract ok
      .mockRejectedValueOnce(new Error('loader boom'));                     // load fails
    await expect(runIngestPipeline('j3', data)).rejects.toThrow('loader boom');
    expect(setIngestStatus).toHaveBeenCalledWith('j3', 'failed', expect.objectContaining({ error: 'loader boom' }));
  });
});
