import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';
export const root = fileURLToPath(new URL('../../../', import.meta.url));
config({ path: resolve(root, '.env'), quiet: true });
const env = z.object({ NODE_ENV: z.enum(['development','test','production']).default('development'), HOST:z.string().default('127.0.0.1'), PORT:z.coerce.number().int().min(1).max(65535).default(3001), DATABASE_PATH:z.string().default('data/catalogo.sqlite'), APP_ORIGINS:z.string().default('http://localhost:5173,http://127.0.0.1:5173') }).parse(process.env);
export const settings = { ...env, databasePath:resolve(root, env.DATABASE_PATH), origins:env.APP_ORIGINS.split(',').map(x=>new URL(x.trim()).origin) };
