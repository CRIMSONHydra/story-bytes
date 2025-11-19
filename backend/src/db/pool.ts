/**
 * PostgreSQL connection pool management.
 * Provides a shared connection pool and health check utilities.
 */

import { Pool } from 'pg';

import { env } from '../config/env';

/**
 * Shared PostgreSQL connection pool.
 * Reuses connections for better performance and resource management.
 */
export const pool = new Pool({
  connectionString: env.databaseUrl
});

/**
 * Checks database connectivity by executing a simple query.
 * Used for health checks and connection validation.
 * 
 * @throws Error if database connection fails
 */
export const checkDatabase = async (): Promise<void> => {
  await pool.query('SELECT 1');
};

/**
 * Closes all connections in the pool gracefully.
 * Should be called during application shutdown.
 */
export const closePool = async (): Promise<void> => {
  await pool.end();
};

