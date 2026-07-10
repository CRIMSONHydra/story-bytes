/**
 * Job API tests (M5). Queue + progress layers mocked — asserts the polling/list/cancel controllers.
 */

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({ pool: { query: vi.fn() }, checkDatabase: vi.fn(), closePool: vi.fn() }));
vi.mock('../jobs/progress', () => ({
  getIngestJob: vi.fn(),
  listIngestJobs: vi.fn(),
  getJobEvents: vi.fn(),
  setIngestStatus: vi.fn(),
  // referenced by the admin controller at import time:
  createIngestJob: vi.fn(),
  findReusableJobBySha: vi.fn(),
}));
vi.mock('../jobs/queue', () => ({ cancelIngestJob: vi.fn(), enqueueIngest: vi.fn() }));

import { createApp } from '../app';
import { getIngestJob, listIngestJobs, getJobEvents, setIngestStatus } from '../jobs/progress';
import { cancelIngestJob } from '../jobs/queue';

const job = { jobId: 'j1', filename: 'x.epub', seriesTitle: null, status: 'completed', storyId: 's1', error: null, createdAt: '', updatedAt: '' };

describe('job API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('GET /api/jobs/:jobId returns the job + event stream', async () => {
    vi.mocked(getIngestJob).mockResolvedValueOnce(job as never);
    vi.mocked(getJobEvents).mockResolvedValueOnce([{ event: 'completed', createdAt: '' }] as never);
    const res = await request(createApp()).get('/api/jobs/j1');
    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({ jobId: 'j1', status: 'completed', storyId: 's1' });
    expect(res.body.events).toHaveLength(1);
  });

  it('GET /api/jobs/:jobId → 404 for an unknown job', async () => {
    vi.mocked(getIngestJob).mockResolvedValueOnce(null as never);
    const res = await request(createApp()).get('/api/jobs/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/admin/jobs lists recent jobs', async () => {
    vi.mocked(listIngestJobs).mockResolvedValueOnce([job] as never);
    const res = await request(createApp()).get('/api/admin/jobs');
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
  });

  it('POST /api/admin/jobs/:jobId/cancel cancels + marks the job', async () => {
    vi.mocked(getIngestJob).mockResolvedValueOnce(job as never);
    vi.mocked(cancelIngestJob).mockResolvedValueOnce({} as never);
    vi.mocked(setIngestStatus).mockResolvedValueOnce(undefined as never);
    const res = await request(createApp()).post('/api/admin/jobs/j1/cancel');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ jobId: 'j1', status: 'cancelled' });
    expect(setIngestStatus).toHaveBeenCalledWith('j1', 'cancelled');
  });
});
