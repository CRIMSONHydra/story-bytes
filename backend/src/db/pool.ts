import { Pool } from 'pg';

import { env } from '../config/env';

export const pool = new Pool({
  connectionString: env.databaseUrl
});

export const checkDatabase = async (): Promise<void> => {
  await pool.query('SELECT 1');
};

export const closePool = async (): Promise<void> => {
  await pool.end();
};

