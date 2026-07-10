/**
 * M1 spine tests: the error envelope (one shape per error class), admin-token auth, and rate limits.
 * These exercise the middleware directly on throwaway apps so they don't depend on DB/model mocks.
 */

import express from 'express';
import request from 'supertest';
import { MulterError } from 'multer';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError, asyncHandler, errorHandler, notFoundHandler } from '../middleware/errors';
import { adminAuth } from '../middleware/adminAuth';
import { createRateLimiter } from '../middleware/rateLimits';
import { env } from '../config/env';

/** Build a tiny app that runs `mount` (which registers routes) then the shared error spine. */
const appWith = (mount: (app: express.Express) => void) => {
  const app = express();
  app.use(express.json());
  mount(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

describe('error envelope (errorHandler)', () => {
  it('maps ApiError to its status + code, with a requestId echoed when present', async () => {
    const app = appWith((a) => {
      a.use((req, _res, next) => { (req as express.Request & { id?: string }).id = 'req-123'; next(); });
      a.get('/x', asyncHandler(async () => { throw new ApiError(403, 'FORBIDDEN', 'nope'); }));
    });
    const res = await request(app).get('/x');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'nope', requestId: 'req-123' } });
  });

  it('maps a ZodError to 400 VALIDATION_ERROR with flattened details', async () => {
    const { z } = await import('zod');
    const schema = z.object({ n: z.number() });
    const app = appWith((a) => a.get('/x', asyncHandler(async () => { schema.parse({ n: 'bad' }); })));
    const res = await request(app).get('/x');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
  });

  it('maps a Multer LIMIT_FILE_SIZE error to 413', async () => {
    const app = appWith((a) => a.get('/x', asyncHandler(async () => { throw new MulterError('LIMIT_FILE_SIZE'); })));
    const res = await request(app).get('/x');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('UPLOAD_LIMIT_FILE_SIZE');
  });

  it('maps a Postgres 22P02 (bad UUID) to 400 INVALID_ID', async () => {
    const app = appWith((a) => a.get('/x', asyncHandler(async () => {
      throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
    })));
    const res = await request(app).get('/x');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
  });

  it('maps an unexpected error to a generic 500 (no internal detail leaked)', async () => {
    const app = appWith((a) => a.get('/x', asyncHandler(async () => { throw new Error('db password is hunter2'); })));
    const res = await request(app).get('/x');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL', message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('returns a 404 envelope for an unmatched route', async () => {
    const app = appWith(() => { /* no routes */ });
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('adminAuth', () => {
  const original = env.adminToken;
  afterEach(() => { (env as { adminToken?: string }).adminToken = original; });

  const guarded = () => appWith((a) => a.get('/admin', adminAuth, (_req, res) => res.json({ ok: true })));

  it('is a no-op when ADMIN_TOKEN is unset (dev)', async () => {
    (env as { adminToken?: string }).adminToken = undefined;
    const res = await request(guarded()).get('/admin');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('401s without a token when ADMIN_TOKEN is set', async () => {
    (env as { adminToken?: string }).adminToken = 'secret-token';
    const res = await request(guarded()).get('/admin');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('401s on a wrong token', async () => {
    (env as { adminToken?: string }).adminToken = 'secret-token';
    const res = await request(guarded()).get('/admin').set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('passes with the correct Bearer token', async () => {
    (env as { adminToken?: string }).adminToken = 'secret-token';
    const res = await request(guarded()).get('/admin').set('Authorization', 'Bearer secret-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('rate limiting (createRateLimiter)', () => {
  it('returns a 429 envelope once the limit is exceeded', async () => {
    const app = appWith((a) => {
      a.use(createRateLimiter({ windowMs: 60_000, max: 1, code: 'TEST_LIMITED' }));
      a.get('/x', (_req, res) => res.json({ ok: true }));
    });
    const agent = request(app);
    const first = await agent.get('/x');
    const second = await agent.get('/x');
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('TEST_LIMITED');
  });
});
