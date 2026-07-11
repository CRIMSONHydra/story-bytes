/**
 * Backfill handler test (M-Backfill): runs graph → foreshadow → appearance in order and marks the
 * job completed; a step failure marks it failed and rethrows. pythonRunner + progress are mocked.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/pythonRunner', () => ({ runPythonJson: vi.fn().mockResolvedValue({ result: null, events: [], stderrTail: '' }) }));
vi.mock('../jobs/progress', () => ({ recordJobEvent: vi.fn(), setIngestStatus: vi.fn() }));
vi.mock('../controllers/assets', () => ({ getProjectRoot: () => '/proj' }));

import { runBackfillPipeline } from '../jobs/handlers/backfill';
import { runPythonJson } from '../services/pythonRunner';
import { setIngestStatus, recordJobEvent } from '../jobs/progress';

describe('runBackfillPipeline', () => {
  afterEach(() => vi.restoreAllMocks());

  it('runs the three steps in dependency order and completes', async () => {
    await runBackfillPipeline('job-1', { storyId: 's1' });
    const scripts = vi.mocked(runPythonJson).mock.calls.map((c) => String(c[1][0]));
    expect(scripts).toEqual([
      'ingestion/graph/extract_graph.py',
      'ingestion/graph/link_foreshadow.py',
      'ingestion/graph/extract_appearance.py',
    ]);
    expect(setIngestStatus).toHaveBeenCalledWith('job-1', 'active');
    expect(setIngestStatus).toHaveBeenCalledWith('job-1', 'completed', { storyId: 's1' });
    const events = vi.mocked(recordJobEvent).mock.calls.map((c) => c[1].event);
    expect(events).toContain('started');
    expect(events).toContain('completed');
  });

  it('marks the job failed and rethrows when a step fails', async () => {
    vi.mocked(runPythonJson).mockRejectedValueOnce(new Error('extract boom'));
    await expect(runBackfillPipeline('job-2', { storyId: 's1' })).rejects.toThrow('extract boom');
    expect(setIngestStatus).toHaveBeenCalledWith('job-2', 'failed', expect.objectContaining({ error: 'extract boom' }));
  });
});
