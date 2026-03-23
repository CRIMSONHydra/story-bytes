/**
 * Express application factory.
 * Configures middleware, routes, and health check endpoints.
 */

import cors from 'cors';
import express from 'express';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { env } from './config/env';
import { checkDatabase } from './db/pool';
import routes from './routes';

const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));

/**
 * Creates and configures the Express application.
 * @returns Configured Express app instance
 */
export const createApp = () => {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json());

  app.use('/api', routes);

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
      console.error('Database health check failed', error);
      res.status(503).json({
        status: 'error',
        db: 'unreachable',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    }
  });

  // Configuration endpoint - returns non-sensitive config info
  app.get('/config', (_req, res) => {
    res.json({
      port: env.port,
      databaseUrlSet: Boolean(env.databaseUrl)
    });
  });

  return app;
};

