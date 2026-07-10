/**
 * Main server entry point for the Story Bytes backend API.
 * Handles server initialization, graceful shutdown, and error handling.
 */

import 'dotenv/config';

import { createApp } from './app';
import { env, validateAtBoot } from './config/env';
import { closePool } from './db/pool';
import { logger } from './services/logger';

// Fail fast on a broken config; warn loudly on a degraded/insecure one.
validateAtBoot();

// Initialize Express application
const app = createApp();

// Start the HTTP server
const server = app.listen(env.port, () => {
  logger.info(`Server running at http://localhost:${env.port}`);
});

/**
 * Gracefully shuts down the server and closes database connections.
 * @param signal - The termination signal received
 */
const shutdown = async (signal: NodeJS.Signals | 'SIGUSR2') => {
  logger.info(`Received ${signal}. Gracefully shutting down...`);
  server.close(async () => {
    try {
      await closePool();
    } catch (error) {
      logger.error({ err: error }, 'Error closing database pool');
    } finally {
      process.exit(0);
    }
  });
};

// Register signal handlers for graceful shutdown
const terminationSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
terminationSignals.forEach((signal) => {
  process.on(signal, () => void shutdown(signal));
});

// Handle uncaught exceptions to prevent server crash
process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Uncaught exception');
  void shutdown('SIGTERM');
});
