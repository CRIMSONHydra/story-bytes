/**
 * Theory submission API tests (M19): paste → 202 + submissionId; status poll; validation.
 */

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({ pool: { query: vi.fn() }, checkDatabase: vi.fn(), closePool: vi.fn() }));
vi.mock('../jobs/queue', () => ({ enqueueTheory: vi.fn().mockResolvedValue('job-1'), enqueueIngest: vi.fn(), cancelIngestJob: vi.fn() }));
vi.mock('../services/theories', () => ({
  createSubmission: vi.fn().mockResolvedValue('sub-1'),
  getSubmission: vi.fn(),
  listSubmissions: vi.fn(),
}));
vi.mock('fs/promises', async (orig) => ({ ...(await orig<typeof import('fs/promises')>()), mkdir: vi.fn().mockResolvedValue(undefined), writeFile: vi.fn().mockResolvedValue(undefined) }));

import { createApp } from '../app';
import { enqueueTheory } from '../jobs/queue';
import { getSubmission, listSubmissions } from '../services/theories';

const SID = '123e4567-e89b-12d3-a456-426614174000';

describe('theory submissions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POST /theories → 202 + submissionId, stages + enqueues', async () => {
    const res = await request(createApp())
      .post(`/api/stories/${SID}/theories`)
      .send({ text: 'A reasonably long fan theory about the prologue events and the narrator.' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ submissionId: 'sub-1', status: 'queued' });
    expect(enqueueTheory).toHaveBeenCalled();
  });

  it('POST /theories with too-short text → 400', async () => {
    const res = await request(createApp()).post(`/api/stories/${SID}/theories`).send({ text: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /theories/:id returns the submission status', async () => {
    vi.mocked(getSubmission).mockResolvedValueOnce({ submissionId: 'sub-1', status: 'completed', chunksKept: 3, error: null, createdAt: '' });
    const res = await request(createApp()).get(`/api/theories/${SID}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'completed', chunksKept: 3 });
  });

  it('GET /theories/:id → 404 when unknown', async () => {
    vi.mocked(getSubmission).mockResolvedValueOnce(null);
    const res = await request(createApp()).get(`/api/theories/${SID}`);
    expect(res.status).toBe(404);
  });

  it('POST /theories with a malformed sourceUrl → 400', async () => {
    const res = await request(createApp())
      .post(`/api/stories/${SID}/theories`)
      .send({ text: 'A reasonably long fan theory that easily clears the minimum length.', sourceUrl: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /stories/:id/theories lists recent submissions', async () => {
    vi.mocked(listSubmissions).mockResolvedValueOnce([
      { submissionId: 's1', status: 'completed', chunksKept: 2, error: null, createdAt: '' },
    ]);
    const res = await request(createApp()).get(`/api/stories/${SID}/theories`);
    expect(res.status).toBe(200);
    expect(res.body.submissions).toHaveLength(1);
  });
});
