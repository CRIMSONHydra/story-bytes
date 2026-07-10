/**
 * Centralized structured logger (M1, Platform F2).
 *
 * pino for app logs + pino-http for per-request logging with a correlation id (`req.id`). Sensitive
 * fields are redacted so tokens/keys never reach the log sink. Pretty-printed in development, plain
 * JSON in production; silent under test so the Vitest output stays readable.
 */

import { randomUUID } from 'crypto';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage } from 'http';

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-admin-token"]',
  'password',
  '*.password',
  'GEMINI_API_KEY',
  'GOOGLE_SEARCH_API_KEY',
];

export const logger = pino({
  level: isTest ? 'silent' : process.env.LOG_LEVEL || 'info',
  redact: { paths: redactPaths, censor: '[redacted]' },
  ...(isProd || isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});

/**
 * Express request-logging middleware. Assigns/echoes a request id (correlation id) and logs one
 * line per completed request. The id is surfaced on `req.id` for controllers and the error handler.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req: IncomingMessage) => {
    const header = req.headers['x-request-id'];
    return (Array.isArray(header) ? header[0] : header) || randomUUID();
  },
  // Health checks are noisy and uninteresting; keep them out of the request log.
  autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' },
});
