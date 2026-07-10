/**
 * Admin authentication (M1, Platform F3).
 *
 * If `ADMIN_TOKEN` is set, every `/api/admin/*` route requires `Authorization: Bearer <token>`,
 * compared in constant time. If it is NOT set (local dev), the guard is a no-op — a boot-time
 * warning (see `env.validateAtBoot`) makes the open state explicit rather than silent.
 */

import { timingSafeEqual } from 'crypto';
import type { RequestHandler } from 'express';

import { env } from '../config/env';
import { unauthorized } from './errors';

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; a differing length is already a non-match.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

export const adminAuth: RequestHandler = (req, _res, next) => {
  const expected = env.adminToken;
  if (!expected) {
    next(); // No token configured → open (dev). Boot warning covers the security note.
    return;
  }

  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

  if (!provided || !safeEqual(provided, expected)) {
    next(unauthorized('Admin token required'));
    return;
  }
  next();
};
