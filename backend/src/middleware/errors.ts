/**
 * Error spine (M1, Platform F1). Every error leaves the API as one envelope:
 *   { error: { code, message, details?, requestId } }
 *
 * Controllers either throw an `ApiError` (for expected 4xx) or let any other rejection bubble to
 * `errorHandler`, which maps known shapes (Zod, Multer, bad-UUID from Postgres) to 4xx and treats
 * everything else as a logged 500 — so multer HTML pages and raw stderr never reach the client.
 */

import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';

import { logger } from '../services/logger';

/** An error with an HTTP status and a stable machine code, safe to surface to the client. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'VALIDATION_ERROR', message, details);
export const invalidId = (message = 'Invalid id') => new ApiError(400, 'INVALID_ID', message);
export const unauthorized = (message = 'Unauthorized') => new ApiError(401, 'UNAUTHORIZED', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'NOT_FOUND', message);

/** Turn a ZodError into a 400 ApiError carrying flattened field errors. */
export const fromZod = (err: ZodError, message = 'Invalid request') =>
  new ApiError(400, 'VALIDATION_ERROR', message, err.flatten());

/**
 * Wrap an async controller so a rejected promise is forwarded to `errorHandler` instead of becoming
 * an unhandled rejection. Lets controllers `throw` and drop their boilerplate try/catch.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** 404 for any route that didn't match — normalized into the same envelope. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, 'NOT_FOUND', `Route not found: ${req.method} ${req.path}`));
};

const requestIdOf = (req: Request): string | undefined =>
  (req as Request & { id?: string }).id?.toString();

const isPgError = (err: unknown, code: string): boolean =>
  typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === code;

/** Map a thrown value to a normalized envelope. Must be registered LAST, after all routes. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = requestIdOf(req);

  let apiError: ApiError;
  if (err instanceof ApiError) {
    apiError = err;
  } else if (err instanceof ZodError) {
    apiError = fromZod(err);
  } else if (err instanceof MulterError) {
    // LIMIT_FILE_SIZE etc. — surface as a 4xx instead of multer's default HTML/500.
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    apiError = new ApiError(status, `UPLOAD_${err.code}`, err.message);
  } else if (isPgError(err, '22P02')) {
    // invalid_text_representation — almost always a malformed UUID reaching a query.
    apiError = invalidId('Malformed identifier');
  } else {
    // Unexpected: log the full error (with the correlation id) and return a generic 500.
    logger.error({ err, requestId }, 'Unhandled error');
    apiError = new ApiError(500, 'INTERNAL', 'Internal server error');
  }

  if (res.headersSent) return;
  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details !== undefined ? { details: apiError.details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  });
};
