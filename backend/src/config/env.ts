/**
 * Environment variable configuration and validation.
 * Uses Zod for schema validation and type safety.
 */

import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file (check both CWD and parent for monorepo)
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '..', '.env') });

/**
 * Environment variable schema definition.
 * Validates and coerces environment variables to their expected types.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5001),
  DATABASE_URL: z.string().optional(),
  GOOGLE_SEARCH_API_KEY: z.string().optional(),
  GOOGLE_CX: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().optional(),
  DB_NAME: z.string().optional(),
  AWS_BUCKET: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
});

// Validate environment variables
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

const { data } = parsed;

/**
 * Constructs DATABASE_URL from individual components if not provided directly.
 * Falls back to individual DB_* variables if DATABASE_URL is not set.
 */
const databaseUrl = data.DATABASE_URL ||
  (data.DB_USER && data.DB_HOST && data.DB_NAME
    ? `postgresql://${data.DB_USER}:${data.DB_PASSWORD || ''}@${data.DB_HOST}:${data.DB_PORT || 5433}/${data.DB_NAME}`
    : undefined);

/**
 * Validated and processed environment configuration.
 * Exported for use throughout the application.
 */
export const env = {
  ...data,
  port: data.PORT,
  databaseUrl: databaseUrl,
  googleSearchApiKey: data.GOOGLE_SEARCH_API_KEY,
  googleCx: data.GOOGLE_CX,
  geminiApiKey: data.GEMINI_API_KEY,
  awsBucket: data.AWS_BUCKET,
  awsRegion: data.AWS_REGION,
  s3Enabled: Boolean(data.AWS_BUCKET && data.AWS_REGION),
};

export type Env = typeof env;

