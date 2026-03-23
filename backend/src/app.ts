/**
 * Express application factory.
 * Configures middleware, routes, and health check endpoints.
 */

import cors from 'cors';
import express from 'express';
import { resolve } from 'path';
import { existsSync } from 'fs';

import { env } from './config/env';
import { checkDatabase } from './db/pool';
import routes from './routes';

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
      version: '1.1.0',
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

  // In production, serve frontend static files
  if (process.env.NODE_ENV === 'production') {
    const frontendDist = resolve(__dirname, '..', '..', 'frontend', 'dist');
    if (existsSync(frontendDist)) {
      app.use(express.static(frontendDist));
      // SPA catch-all: non-API routes serve index.html
      app.get('*', (_req, res) => {
        res.sendFile(resolve(frontendDist, 'index.html'));
      });
    }
  }

  return app;
};

