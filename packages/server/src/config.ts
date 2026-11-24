import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  repoRoot: string;
  databasePath: string;
}

/** Loads `.env` from the repo root when it exists, then reads settings from the environment. */
export function loadConfig(): Config {
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  try {
    process.loadEnvFile(path.join(repoRoot, '.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    repoRoot,
    databasePath: path.resolve(repoRoot, process.env.DATABASE_PATH ?? 'data/cafe.db'),
  };
}
