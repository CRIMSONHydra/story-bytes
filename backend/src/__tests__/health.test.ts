/**
 * Health check endpoint tests.
 * Verifies that the /health endpoint correctly reports database connectivity status.
 */

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app';
import * as db from '../db/pool';

describe('GET /health', () => {
  // Restore all mocks after each test to prevent test interference
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok when database is reachable', async () => {
    // Mock successful database check
    vi.spyOn(db, 'checkDatabase').mockResolvedValueOnce();

    const response = await request(createApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      db: 'ok'
    });
  });

  it('returns 503 when database is unreachable', async () => {
    // Mock failed database check
    vi.spyOn(db, 'checkDatabase').mockRejectedValueOnce(new Error('boom'));

    const response = await request(createApp()).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 'error',
      db: 'unreachable'
    });
  });
});

