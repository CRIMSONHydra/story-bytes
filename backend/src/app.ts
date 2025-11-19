import cors from 'cors';
import express from 'express';

import { env } from './config/env';
import { checkDatabase } from './db/pool';
import routes from './routes';

export const createApp = () => {
  const app = express();

  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json());

  app.use('/api', routes);

  app.get('/', (_req, res) => {
    res.json({
      service: 'story-bytes-api',
      version: '1.0.0',
      docs: null
    });
  });

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

  app.get('/config', (_req, res) => {
    res.json({
      port: env.port,
      databaseUrlSet: Boolean(env.databaseUrl)
    });
  });

  return app;
};

