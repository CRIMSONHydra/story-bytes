import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

const { data } = parsed;

// Construct DATABASE_URL if not present but components are
const databaseUrl = data.DATABASE_URL ||
  (data.DB_USER && data.DB_HOST && data.DB_NAME
    ? `postgresql://${data.DB_USER}:${data.DB_PASSWORD || ''}@${data.DB_HOST}:${data.DB_PORT || 5432}/${data.DB_NAME}`
    : undefined);

export const env = {
  ...data,
  port: data.PORT,
  databaseUrl: databaseUrl,
  googleSearchApiKey: data.GOOGLE_SEARCH_API_KEY,
  googleCx: data.GOOGLE_CX,
  geminiApiKey: data.GEMINI_API_KEY,
};

export type Env = typeof env;

