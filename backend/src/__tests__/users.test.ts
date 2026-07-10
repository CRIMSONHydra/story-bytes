/**
 * Users/profiles CRUD tests (M4). DB is mocked; asserts status codes, the error envelope on the edge
 * cases (bad UUID, unknown id, invalid body), and that identity resolution doesn't interfere.
 */

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  pool: { query: vi.fn() },
  checkDatabase: vi.fn(),
  closePool: vi.fn(),
}));

import { pool } from '../db/pool';
import { createApp } from '../app';

const mockQuery = vi.mocked(pool.query);
const TEST_UUID = '123e4567-e89b-12d3-a456-426614174000';
const row = (over: Record<string, unknown> = {}) => ({
  user_id: TEST_UUID, display_name: 'Alice', avatar_color: '#fff',
  created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-01-01T00:00:00Z'), ...over,
});

describe('users CRUD', () => {
  afterEach(() => vi.restoreAllMocks());

  it('GET /api/users lists profiles', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()] } as never);
    const res = await request(createApp()).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0]).toMatchObject({ userId: TEST_UUID, displayName: 'Alice' });
  });

  it('POST /api/users creates a profile (201)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row({ display_name: 'Bob' })] } as never);
    const res = await request(createApp()).post('/api/users').send({ displayName: 'Bob' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ displayName: 'Bob' });
  });

  it('POST /api/users with empty displayName → 400 VALIDATION_ERROR', async () => {
    const res = await request(createApp()).post('/api/users').send({ displayName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/users/:id → 404 when unknown', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const res = await request(createApp()).get(`/api/users/${TEST_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/users/:id → 400 INVALID_ID on a bad UUID', async () => {
    const res = await request(createApp()).get('/api/users/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
  });

  it('PUT /api/users/:id updates and returns the profile', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row({ display_name: 'Renamed' })] } as never);
    const res = await request(createApp()).put(`/api/users/${TEST_UUID}`).send({ displayName: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Renamed');
  });

  it('PUT with an empty body → 400 (nothing to update)', async () => {
    const res = await request(createApp()).put(`/api/users/${TEST_UUID}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('DELETE /api/users/:id → 204, or 404 when missing', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never);
    const ok = await request(createApp()).delete(`/api/users/${TEST_UUID}`);
    expect(ok.status).toBe(204);

    mockQuery.mockResolvedValueOnce({ rowCount: 0 } as never);
    const missing = await request(createApp()).delete(`/api/users/${TEST_UUID}`);
    expect(missing.status).toBe(404);
  });
});
