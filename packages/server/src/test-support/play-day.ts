import { SECONDS_PER_DAY, makeScenario, type StoredEvent } from '@cafe/core';
import type { Db } from '../db/database';
import { openSeededMemoryDb } from '../db/memory';
import type { ReportRow } from '../db/queries';
import { listEvents } from '../events/store';
import { bootSimulation } from '../sim/simulation';
import { AutoBoss } from './auto-boss';

/** The boss of the test days says no to every fourth report, so the retry after a "no" is part of the day. */
export const decideLikeTheTestBoss = (report: ReportRow): 'approved' | 'rejected' =>
  report.id % 4 === 0 ? 'rejected' : 'approved';

export interface PlayDayOptions {
  seed?: number;
  /** Absolute moments at which the server is stopped and started again (a restart check). */
  restartAt?: number[];
  /** Moves the time in steps of this many seconds instead of one jump to the end of the day. */
  stepSec?: number;
  /** Where the day stops. Default: midnight of day 0. */
  until?: number;
}

export interface PlayedDay {
  db: Db;
  log: StoredEvent[];
}

/**
 * Plays a virtual day of the whole cafe: generator, characters and an automatic boss, on a fresh
 * in-memory database. The time only moves through the boss, who looks at his desk every minute.
 */
export function playDay(options: PlayDayOptions = {}): PlayedDay {
  const db = openSeededMemoryDb();
  const scenario = makeScenario(options.seed ?? 42);
  const until = options.until ?? SECONDS_PER_DAY;
  const restarts = [...(options.restartAt ?? [])].sort((a, b) => a - b);
  const step = options.stepSec ?? Number.MAX_SAFE_INTEGER;

  let sim = bootSimulation({ db, scenario });
  let boss = new AutoBoss(sim, { decide: decideLikeTheTestBoss });
  for (const stop of [...restarts, until]) {
    while (sim.clock.now() < stop) {
      boss.advanceTo(Math.min(stop, sim.clock.now() + step));
    }
    if (stop !== until) {
      sim = bootSimulation({ db, scenario });
      if (!sim.recovered) throw new Error('the world was not recovered after the restart');
      boss = new AutoBoss(sim, { decide: decideLikeTheTestBoss });
    }
  }
  return { db, log: listEvents(db) };
}
