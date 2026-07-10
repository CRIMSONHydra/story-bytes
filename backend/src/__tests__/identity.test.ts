/**
 * Identity middleware tests (M4): x-user-id absent → default, malformed → 400, unknown → 404,
 * known → passes through with req.userId set.
 */

import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/users', () => ({ userExists: vi.fn() }));

import { userExists } from '../services/users';
import { identity } from '../middleware/identity';
import { errorHandler } from '../middleware/errors';
import { DEFAULT_USER_ID } from '../services/spoilerScope';

const mockExists = vi.mocked(userExists);
const KNOWN = '123e4567-e89b-12d3-a456-426614174000';

const app = () => {
  const a = express();
  a.get('/echo', identity, (req, res) => res.json({ userId: req.userId }));
  a.use(errorHandler);
  return a;
};

describe('identity middleware', () => {
  afterEach(() => vi.restoreAllMocks());

  it('absent x-user-id resolves to DEFAULT_USER_ID (no DB lookup)', async () => {
    const res = await request(app()).get('/echo');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(DEFAULT_USER_ID);
    expect(mockExists).not.toHaveBeenCalled();
  });

  it('malformed x-user-id → 400', async () => {
    const res = await request(app()).get('/echo').set('x-user-id', 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('unknown (well-formed) x-user-id → 404', async () => {
    mockExists.mockResolvedValueOnce(false);
    const res = await request(app()).get('/echo').set('x-user-id', KNOWN);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('known x-user-id passes through with req.userId set', async () => {
    mockExists.mockResolvedValueOnce(true);
    const res = await request(app()).get('/echo').set('x-user-id', KNOWN);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(KNOWN);
  });

  it('the default UUID short-circuits the existence check', async () => {
    const res = await request(app()).get('/echo').set('x-user-id', DEFAULT_USER_ID);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(DEFAULT_USER_ID);
    expect(mockExists).not.toHaveBeenCalled();
  });
});
