import {
  OPEN_TIME_SEC,
  VirtualClock,
  dueItems,
  type DueItem,
  type Scenario,
  type SimTime,
} from '@cafe/core';
import type { Db } from '../db/database';
import type { EventBus } from '../events/bus';
import { rebuildProjections } from '../projection/rebuild';
import { transact, type Context } from '../usecases/context';
import { hasWorld, initializeWorld } from '../usecases/world';
import { readClockState } from './clock-state';
import { handleDueItem } from './handlers';

/** A brand new world starts 10 virtual minutes before opening, so `day_opened` follows quickly. */
export const FIRST_BOOT_START: SimTime = OPEN_TIME_SEC - 600;

export interface Simulation {
  ctx: Context;
  clock: VirtualClock<DueItem>;
  /** The scenario in effect: the seed comes from the log once a world exists. */
  scenario: Scenario;
  /** True when an existing world was restored from the event log. */
  recovered: boolean;
  /** How many events were replayed to restore the world (0 for a new world). */
  replayedEvents: number;
  /** The boss jumps forward in time: records `sim_time_advanced`, then moves the clock. */
  skipTime(seconds: number): void;
}

export interface BootOptions {
  db: Db;
  bus?: EventBus;
  /** `scenario.seed` is only used to create a new world, later boots read the seed from the log. */
  scenario: Scenario;
}

/**
 * Brings the world up.
 * - Empty log: write `world_initialized` and start the clock at 07:50 of day 0.
 * - Existing log: rebuild the projections by replaying it, take the seed from the last
 *   `world_initialized`, and put the clock at the later of the saved clock and the last event
 *   (decision 011).
 * The reference data must already be seeded and the schema migrated.
 */
export function bootSimulation(options: BootOptions): Simulation {
  const { db, bus } = options;
  const existing = hasWorld(db);

  let scenario = options.scenario;
  let start = FIRST_BOOT_START;
  let replayedEvents = 0;
  if (existing) {
    replayedEvents = rebuildProjections(db);
    scenario = { ...options.scenario, seed: lastWorldSeed(db) };
    start = Math.max(readClockState(db).current_sim_sec, lastEventTime(db));
  }

  // The clock needs the context (its handlers write events) and the context needs the clock,
  // so the context is filled in right after the clock exists.
  const holder: { ctx?: Context } = {};
  const clock = new VirtualClock<DueItem>(
    start,
    (after, upTo) => dueItems(after, upTo, scenario),
    (item) => handleDueItem(requireContext(holder.ctx), item, scenario),
  );
  const context: Context = { db, clock, publish: bus?.publish };
  holder.ctx = context;

  if (!existing) initializeWorld(context, { seed: scenario.seed });

  return {
    ctx: context,
    clock,
    scenario,
    recovered: existing,
    replayedEvents,
    skipTime(seconds: number): void {
      if (!Number.isInteger(seconds) || seconds <= 0) {
        throw new Error(`skipTime expects a positive whole number of seconds, got ${seconds}`);
      }
      transact(context, (emit) => {
        emit({
          type: 'sim_time_advanced',
          actor: 'boss',
          origin: 'boss',
          payload: { from: clock.now(), to: clock.now() + seconds },
        });
      });
      clock.advance(seconds);
    },
  };
}

function requireContext(ctx: Context | undefined): Context {
  if (!ctx) throw new Error('the simulation is not ready yet');
  return ctx;
}

function lastWorldSeed(db: Db): number {
  const payload = db
    .prepare(
      "SELECT payload_json FROM events WHERE type = 'world_initialized' ORDER BY id DESC LIMIT 1",
    )
    .pluck()
    .get() as string;
  return (JSON.parse(payload) as { seed: number }).seed;
}

function lastEventTime(db: Db): SimTime {
  return db.prepare('SELECT COALESCE(MAX(sim_time), 0) FROM events').pluck().get() as number;
}
