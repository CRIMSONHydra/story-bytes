import 'dotenv/config';

import { createApp } from './app';
import { env } from './config/env';
import { closePool } from './db/pool';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`🚀 Server running at http://localhost:${env.port}`);
});

const shutdown = async (signal: NodeJS.Signals | 'SIGUSR2') => {
  console.log(`\nReceived ${signal}. Gracefully shutting down...`);
  server.close(async () => {
    try {
      await closePool();
    } catch (error) {
      console.error('Error closing database pool', error);
    } finally {
      process.exit(0);
    }
  });
};

const terminationSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

terminationSignals.forEach((signal) => {
  process.on(signal, () => void shutdown(signal));
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception', error);
  void shutdown('SIGTERM');
});

