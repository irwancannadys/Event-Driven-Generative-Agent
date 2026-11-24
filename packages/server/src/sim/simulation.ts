import {
  OPEN_TIME_SEC,
  VirtualClock,
  makeStaticSource,
  priorityOf,
  type DueItem,
  type InstantLLM,
  type Scenario,
  type SimTime,
} from '@cafe/core';
import type { Db } from '../db/database';
import type { EventBus } from '../events/bus';
import { reactToEvent } from '../agents/reactions';
import { readWorldSeed } from '../db/queries';
import { rebuildProjections } from '../projection/rebuild';
import { transact, type Context } from '../usecases/context';
import { hasWorld, initializeWorld } from '../usecases/world';
import { readClockState } from './clock-state';
import { nextDynamicDue } from './dynamic-due';
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
  /**
   * Whether the characters work (decision 022). The real world always has them. Tests of the earlier
   * stages, which rely on "nobody cooks yet", switch them off. Default `true`.
   */
  agents?: boolean;
  /** The model that helps the agents decide. Without one the rules decide (decision 034). */
  llm?: InstantLLM;
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
  const agents = options.agents ?? true;
  const existing = hasWorld(db);

  let scenario = options.scenario;
  let start = FIRST_BOOT_START;
  let replayedEvents = 0;
  if (existing) {
    replayedEvents = rebuildProjections(db);
    scenario = { ...options.scenario, seed: readWorldSeed(db) };
    start = Math.max(readClockState(db).current_sim_sec, lastEventTime(db));
  }

  // The clock needs the context (its handlers write events) and the context needs the clock,
  // so the context is filled in right after the clock exists.
  const holder: { ctx?: Context } = {};
  const staticSource = makeStaticSource(scenario);
  const due = (after: SimTime, upTo: SimTime): DueItem[] => {
    const fromSchedule = staticSource(after, upTo);
    const fromWorld = agents ? nextDynamicDue(db, after, upTo) : [];
    if (fromWorld.length === 0) return fromSchedule;
    if (fromSchedule.length === 0) return fromWorld;
    const [first] = fromSchedule as [DueItem];
    const [other] = fromWorld as [DueItem];
    if (first.time !== other.time) return first.time < other.time ? fromSchedule : fromWorld;
    return [...fromSchedule, ...fromWorld].sort((a, b) => priorityOf(a) - priorityOf(b));
  };
  const clock = new VirtualClock<DueItem>(start, due, (item) =>
    handleDueItem(requireContext(holder.ctx), item, scenario),
  );
  const context: Context = {
    db,
    clock,
    publish: bus?.publish,
    react: agents ? reactToEvent : undefined,
    scenario,
    llm: options.llm,
  };
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

function lastEventTime(db: Db): SimTime {
  return db.prepare('SELECT COALESCE(MAX(sim_time), 0) FROM events').pluck().get() as number;
}
