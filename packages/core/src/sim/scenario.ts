import { MENU_ITEMS } from '../seed-data';
import type { Weighted } from './rng';

/** The knobs of a world. `seed` decides every "coincidence"; the rest shape the day. */
export interface Scenario {
  seed: number;
  /** How busy the cafe is, in percent of normal (100 = normal, 200 = twice as many orders). */
  crowdPct: number;
  /** Chance in percent that an order which waited too long becomes a complaint. */
  complaintChancePct: number;
  /** How long an order may wait, in virtual seconds, before its customer may complain. */
  complaintWaitSec: number;
}

export const DEFAULT_CROWD_PCT = 100;
export const DEFAULT_COMPLAINT_CHANCE_PCT = 15;
export const DEFAULT_COMPLAINT_WAIT_SEC = 20 * 60;

/** How long before the usual arrival time a regular is "expected" (the waiter's cue to prepare). */
export const REGULAR_LEAD_SEC = 25 * 60;

/** Orders are drawn once per slot of this many seconds, complaints are checked on the same beat. */
export const SLOT_SEC = 60;

export function makeScenario(
  seed: number,
  overrides: Partial<Omit<Scenario, 'seed'>> = {},
): Scenario {
  const scenario: Scenario = {
    seed,
    crowdPct: overrides.crowdPct ?? DEFAULT_CROWD_PCT,
    complaintChancePct: overrides.complaintChancePct ?? DEFAULT_COMPLAINT_CHANCE_PCT,
    complaintWaitSec: overrides.complaintWaitSec ?? DEFAULT_COMPLAINT_WAIT_SEC,
  };
  assertInteger('seed', scenario.seed, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  assertInteger('crowdPct', scenario.crowdPct, 0, 1000);
  assertInteger('complaintChancePct', scenario.complaintChancePct, 0, 100);
  assertInteger('complaintWaitSec', scenario.complaintWaitSec, 1, 86400);
  return scenario;
}

function assertInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max}, got ${value}`);
  }
}

/** Orders per hour at normal crowd, by opening hour. About 83 orders in a normal day, busiest at lunch. */
const ARRIVALS_PER_HOUR: readonly { fromHour: number; toHour: number; perHour: number }[] = [
  { fromHour: 8, toHour: 10, perHour: 8 },
  { fromHour: 10, toHour: 12, perHour: 5 },
  { fromHour: 12, toHour: 14, perHour: 14 },
  { fromHour: 14, toHour: 17, perHour: 4 },
  { fromHour: 17, toHour: 19, perHour: 7 },
  { fromHour: 19, toHour: 20, perHour: 3 },
];

/** Expected orders per hour at normal crowd for a given hour of the day (0 outside opening hours). */
export function arrivalsPerHour(hour: number): number {
  const band = ARRIVALS_PER_HOUR.find((entry) => hour >= entry.fromHour && hour < entry.toHour);
  return band?.perHour ?? 0;
}

/** How popular each menu item is when a customer picks one. */
export const MENU_WEIGHTS: readonly Weighted<string>[] = [
  { value: 'kopi_susu', weight: 30 },
  { value: 'es_teh_manis', weight: 20 },
  { value: 'nasi_goreng', weight: 20 },
  { value: 'roti_bakar', weight: 10 },
  { value: 'mie_goreng', weight: 10 },
  { value: 'kopi_hitam', weight: 10 },
];

export const MENU_WEIGHT_IDS: readonly string[] = MENU_WEIGHTS.map((entry) => entry.value);
export const SEED_MENU_IDS: readonly string[] = MENU_ITEMS.map((item) => item.id);
