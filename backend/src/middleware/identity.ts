/**
 * Identity middleware (M4). Resolves the caller's profile from the `x-user-id` header:
 *   - absent    → the seeded DEFAULT_USER_ID (single-profile default)
 *   - malformed → 400 (not a UUID)
 *   - unknown   → 404 (well-formed UUID with no matching profile)
 * The resolved id is stored on `req.userId` for user-scoped controllers. The DEFAULT_USER_ID short
 * circuits the existence check (it is always seeded), so the common no-header path costs no query.
 */

import { asyncHandler, badRequest, notFound } from './errors';
import { userExists } from '../services/users';
import { DEFAULT_USER_ID } from '../services/spoilerScope';

// Permissive UUID shape (any 8-4-4-4-12 hex), matching Postgres's `uuid` type — NOT Zod's strict
// v4-only `.uuid()`, which rejects the seeded DEFAULT_USER_ID (version/variant nibbles are 0).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const identity = asyncHandler(async (req, _res, next) => {
  const raw = req.headers['x-user-id'];
  const header = Array.isArray(raw) ? raw[0] : raw;

  if (!header) {
    req.userId = DEFAULT_USER_ID;
    next();
    return;
  }

  if (!UUID_RE.test(header)) throw badRequest('Malformed x-user-id header (must be a UUID)');

  // The seeded default always exists — skip the lookup for the common case.
  if (header !== DEFAULT_USER_ID && !(await userExists(header))) {
    throw notFound('Unknown user profile');
  }

  req.userId = header;
  next();
});
