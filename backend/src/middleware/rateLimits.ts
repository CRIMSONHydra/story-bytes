/**
 * Rate limiting (M1, Platform F3). Protects the expensive/abusable surfaces:
 *   - chat  — 20 / min  (each call fans out to embedding + model inference)
 *   - ingest — 6 / hr   (each kicks off a multi-minute Python pipeline)
 *   - api   — 300 / min (coarse catch-all for everything else)
 *
 * A tripped limit returns the standard error envelope (429 RATE_LIMITED), never express-rate-limit's
 * default plaintext. Limiters are inert under test so unrelated suites can't trip a shared IP bucket;
 * the 429 behavior is covered directly against the factory.
 */

import rateLimit from 'express-rate-limit';
import type { Request, RequestHandler, Response } from 'express';

const isTest = process.env.NODE_ENV === 'test';

interface LimiterOptions {
  windowMs: number;
  max: number;
  code?: string;
}

/** Build a limiter whose 429 response is our error envelope. */
export const createRateLimiter = ({ windowMs, max, code = 'RATE_LIMITED' }: LimiterOptions): RequestHandler =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code,
          message: 'Too many requests — please slow down.',
          ...((req as Request & { id?: string }).id ? { requestId: (req as Request & { id?: string }).id } : {}),
        },
      });
    },
  });

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Inert under test (passthrough) so the shared in-memory IP bucket can't leak 429s across suites.
const passthrough: RequestHandler = (_req, _res, next) => next();
const withTestSkip = (limiter: RequestHandler): RequestHandler => (isTest ? passthrough : limiter);

export const chatLimiter = withTestSkip(createRateLimiter({ windowMs: MINUTE, max: 20, code: 'CHAT_RATE_LIMITED' }));
export const ingestLimiter = withTestSkip(createRateLimiter({ windowMs: HOUR, max: 6, code: 'INGEST_RATE_LIMITED' }));
export const apiLimiter = withTestSkip(createRateLimiter({ windowMs: MINUTE, max: 300 }));
