/**
 * Filesystem path helpers (M16 review). Lives in services/ so both controllers and services can
 * import it without a service→controller dependency (the direction should be controllers → services).
 */

import { resolve } from 'path';

/**
 * Resolve the project root directory.
 * In Docker (NODE_ENV=production) the cwd is /app (the project root); in dev the cwd is backend/, so
 * go up one level.
 */
export const getProjectRoot = (): string =>
  process.env.NODE_ENV === 'production' ? process.cwd() : resolve(process.cwd(), '..');
