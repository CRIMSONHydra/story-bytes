import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5001),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .default('postgres://postgres:postgres@localhost:5432/story_bytes')
});

const parsed = envSchema.parse({
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL
});

export const env = {
  port: parsed.PORT,
  databaseUrl: parsed.DATABASE_URL
};

export type Env = typeof env;

