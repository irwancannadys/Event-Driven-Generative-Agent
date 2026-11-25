import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_COMPLAINT_WAIT_SEC,
  SECONDS_PER_MINUTE,
  makeScenario,
  type Scenario,
} from '@cafe/core';
import { DEFAULT_SPEED, MAX_SPEED, MIN_SPEED } from './sim/pacer';

export interface Config {
  repoRoot: string;
  databasePath: string;
  /** Port of the HTTP API. 0 picks a free port (tests). */
  port: number;
  /** Virtual seconds per real second. */
  speed: number;
  /**
   * Scenario settings. `scenario.seed` is only used to create a new world: an existing world keeps
   * the seed that is in its log (decision 020).
   */
  scenario: Scenario;
  /**
   * Who helps the agents decide: `fake` answers from a script, `off` leaves it to the rules (decision 034),
   * `ollama` asks a model that runs on this machine (stage 6).
   */
  llmProvider: 'fake' | 'off' | 'ollama';
  /** Where the model is and how long to wait for it. Only used when `llmProvider` is `ollama`. */
  ollama: { url: string; model: string; timeoutSec: number };
}

/** The model that is asked unless `OLLAMA_MODEL` says otherwise. */
export const DEFAULT_OLLAMA_MODEL = 'qwen3:4b';
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

type Env = Readonly<Record<string, string | undefined>>;

/** Reads a whole number setting. Unset or empty means "use the default". Errors name the variable. */
function intSetting(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const text = raw.trim();
  if (!/^-?\d+$/.test(text)) throw new Error(`${name} must be a whole number, got "${raw}"`);
  const value = Number(text);
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}, got ${value}`);
  }
  return value;
}

/** Reads an http(s) address. Unset or empty means "use the default". Errors name the variable. */
function urlSetting(env: Env, name: string, fallback: string): string {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an http or https address, got "${env[name]}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must be an http or https address, got "${env[name]}"`);
  }
  return raw;
}

/** Turns environment variables into a validated configuration. Pure, so it is easy to test. */
export function parseConfig(env: Env, repoRoot: string): Config {
  const provider = (env.LLM_PROVIDER ?? '').trim().toLowerCase();
  if (provider !== '' && provider !== 'fake' && provider !== 'off' && provider !== 'ollama') {
    throw new Error(`LLM_PROVIDER must be fake, off or ollama, got "${env.LLM_PROVIDER}"`);
  }
  const forecast = (env.STOCK_FORECAST ?? '').trim().toLowerCase();
  if (forecast !== '' && forecast !== 'on' && forecast !== 'off') {
    throw new Error(`STOCK_FORECAST must be on or off, got "${env.STOCK_FORECAST}"`);
  }
  return {
    llmProvider: provider === 'off' || provider === 'ollama' ? provider : 'fake',
    ollama: {
      url: urlSetting(env, 'OLLAMA_URL', DEFAULT_OLLAMA_URL),
      model: env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL,
      timeoutSec: intSetting(env, 'OLLAMA_TIMEOUT_SEC', 60, 1, 600),
    },
    repoRoot,
    databasePath: path.resolve(repoRoot, env.DATABASE_PATH?.trim() || 'data/cafe.db'),
    port: intSetting(env, 'PORT', 3000, 0, 65535),
    speed: intSetting(env, 'SPEED', DEFAULT_SPEED, MIN_SPEED, MAX_SPEED),
    scenario: makeScenario(
      intSetting(env, 'SEED', 42, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      {
        crowdPct: intSetting(env, 'CROWD_PCT', 150, 0, 1000),
        complaintChancePct: intSetting(env, 'COMPLAINT_CHANCE_PCT', 15, 0, 100),
        // In minutes, like people think about it. Complaints about a slow order arise at exactly this wait.
        complaintWaitSec:
          intSetting(
            env,
            'COMPLAINT_WAIT_MIN',
            DEFAULT_COMPLAINT_WAIT_SEC / SECONDS_PER_MINUTE,
            1,
            1440,
          ) * SECONDS_PER_MINUTE,
        stockForecast: forecast !== 'off',
      },
    ),
  };
}

/** Loads `.env` from the repo root when it exists, then reads settings from the environment. */
export function loadConfig(): Config {
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  try {
    process.loadEnvFile(path.join(repoRoot, '.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return parseConfig(process.env, repoRoot);
}
