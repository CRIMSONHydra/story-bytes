/**
 * Express application factory.
 * Configures middleware, routes, and health check endpoints.
 */

import cors from 'cors';
import express from 'express';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { checkDatabase } from './db/pool';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { apiLimiter } from './middleware/rateLimits';
import { identity } from './middleware/identity';
import { httpLogger, logger } from './services/logger';
import routes from './routes';

const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));

/**
 * Creates and configures the Express application.
 * @returns Configured Express app instance
 */
export const createApp = () => {
  const app = express();
  app.set('trust proxy', true);
  app.use(httpLogger);
  // Advertise the API contract version on every response (M1, Platform F1).
  app.use((_req, res, next) => {
    res.setHeader('X-API-Version', pkg.version);
    next();
  });
  app.use(cors());
  app.use(express.json());

  app.use('/api', apiLimiter, identity, routes);

  // Root endpoint - service information
  app.get('/', (_req, res) => {
    res.json({
      service: 'story-bytes-api',
      version: pkg.version,
      docs: null
    });
  });

  // Health check endpoint - verifies database connectivity
  app.get('/health', async (_req, res) => {
    try {
      await checkDatabase();
      res.json({
        status: 'ok',
        db: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ err: error }, 'Database health check failed');
      res.status(503).json({
        status: 'error',
        db: 'unreachable',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    }
  });

  // 404 for unmatched routes, then the centralized error envelope. Both MUST be last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
