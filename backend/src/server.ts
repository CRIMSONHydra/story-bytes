/**
 * Main server entry point for the Story Bytes backend API.
 * Handles server initialization, graceful shutdown, and error handling.
 */

import 'dotenv/config';

import { createApp } from './app';
import { env } from './config/env';
import { closePool } from './db/pool';

// Initialize Express application
const app = createApp();

// Start the HTTP server
const server = app.listen(env.port, () => {
  console.log(`🚀 Server running at http://localhost:${env.port}`);
});

/**
 * Gracefully shuts down the server and closes database connections.
 * @param signal - The termination signal received
 */
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

// Register signal handlers for graceful shutdown
const terminationSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
terminationSignals.forEach((signal) => {
  process.on(signal, () => void shutdown(signal));
});

// Handle uncaught exceptions to prevent server crash
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception', error);
  void shutdown('SIGTERM');
});

