import { describe, expect, it } from 'vitest';
import {
  CLOSE_TIME_SEC,
  OPEN_TIME_SEC,
  SECONDS_PER_DAY,
  dueItems,
  makeScenario,
  simTime,
  type Scenario,
  type StoredEvent,
} from '@cafe/core';
import type { Db } from '../db/database';
import { EventBus } from '../events/bus';
import { listEvents } from '../events/store';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import { countRows, createTestDb } from '../test-support/world';
import { saveClockState, readClockState } from './clock-state';
import { FIRST_BOOT_START, bootSimulation, type Simulation } from './simulation';

const TWO_DAYS = 2 * SECONDS_PER_DAY;

function boot(
  db: Db,
  seed = 42,
  overrides: Partial<Omit<Scenario, 'seed'>> = {},
  bus?: EventBus,
): Simulation {
  return bootSimulation({ db, bus, scenario: makeScenario(seed, overrides) });
}

function runTo(sim: Simulation, time: number): void {
  sim.clock.advance(time - sim.clock.now());
}

/** The log of a world that simply ran, without interruptions, until `until`. */
function straightRun(until: number, seed = 42, overrides: Partial<Omit<Scenario, 'seed'>> = {}) {
  const db = createTestDb();
  const sim = boot(db, seed, overrides);
  runTo(sim, until);
  return { db, sim, log: listEvents(db) };
}

function withoutIds(log: StoredEvent[]): Record<string, unknown>[] {
  return log.map((event) =>
    Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'id')),
  );
}

function ofType(log: StoredEvent[], type: string): StoredEvent[] {
  return log.filter((event) => event.type === type);
}

describe('a new world', () => {
  it('starts at 07:50 with world_initialized and fills the projections', () => {
    const db = createTestDb();
    const sim = boot(db);
    expect(sim.recovered).toBe(false);
    expect(sim.replayedEvents).toBe(0);
    expect(sim.clock.now()).toBe(FIRST_BOOT_START);
    expect(FIRST_BOOT_START).toBe(simTime(0, 7, 50));
    const log = listEvents(db);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      type: 'world_initialized',
      sim_time: FIRST_BOOT_START,
      actor: 'system',
      origin: 'system',
      payload: { seed: 42 },
    });
    expect(countRows(db, 'stock')).toBe(8);
  });
});

describe('a day that runs by itself', () => {
  const { db, log } = straightRun(SECONDS_PER_DAY);

  it('opens at 08:00, expects the regulars and closes at 20:00', () => {
    expect(
      ofType(log, 'day_opened').map((e) => [e.sim_time, e.actor, e.origin, e.payload]),
    ).toEqual([[OPEN_TIME_SEC, 'system', 'scheduler', { day: 0 }]]);
    expect(ofType(log, 'day_closed').map((e) => [e.sim_time, e.payload])).toEqual([
      [CLOSE_TIME_SEC, { day: 0 }],
    ]);
    expect(
      ofType(log, 'regular_expected').map((e) => [
        e.sim_time,
        (e.payload as { regular_id: string }).regular_id,
      ]),
    ).toEqual([
      [simTime(0, 8, 5), 'pak_budi'],
      [simTime(0, 11, 35), 'bu_sari'],
      [simTime(0, 16, 35), 'mas_joko'],
    ]);
  });

  it('brings orders at exactly the scheduled times, with the scheduled items', () => {
    const scheduled = dueItems(FIRST_BOOT_START, SECONDS_PER_DAY, makeScenario(42)).flatMap(
      (item) => (item.kind === 'order_arrival' ? [[item.time, item.items]] : []),
    );
    const created = ofType(log, 'order_created').map((e) => [
      e.sim_time,
      (e.payload as { items: unknown }).items,
    ]);
    expect(scheduled.length).toBeGreaterThan(50);
    expect(created).toEqual(scheduled);
    for (const event of ofType(log, 'order_created')) {
      expect(event.actor).toBe('world');
      expect(event.origin).toBe('generator');
    }
  });

  it('leaves the orders waiting, because nobody cooks yet', () => {
    expect(db.prepare('SELECT DISTINCT status FROM orders').pluck().all()).toEqual(['placed']);
  });

  it('lets customers complain only about orders that waited long enough, once each', () => {
    const complaints = ofType(log, 'complaint_received');
    expect(complaints.length).toBeGreaterThan(0);
    const created = new Map(
      ofType(log, 'order_created').map((e) => [
        (e.payload as { order_id: number }).order_id,
        e.sim_time,
      ]),
    );
    const orderIds = complaints.map((e) => (e.payload as { order_id: number }).order_id);
    expect(new Set(orderIds).size).toBe(orderIds.length);
    complaints.forEach((event, index) => {
      const payload = event.payload as { complaint_id: number; order_id: number; cause: string };
      expect(payload.complaint_id).toBe(index + 1);
      expect(payload.cause).toBe('slow_service');
      expect(event.sim_time - (created.get(payload.order_id) as number)).toBeGreaterThanOrEqual(
        1200,
      );
    });
  });

  it('writes only the event types that exist in stage 2, in time order', () => {
    const types = new Set(log.map((e) => e.type));
    expect([...types].sort()).toEqual(
      [
        'complaint_received',
        'day_closed',
        'day_opened',
        'order_created',
        'regular_expected',
        'world_initialized',
      ].sort(),
    );
    for (let i = 1; i < log.length; i += 1) {
      expect((log[i] as StoredEvent).sim_time).toBeGreaterThanOrEqual(
        (log[i - 1] as StoredEvent).sim_time,
      );
    }
  });
});

describe('determinism', () => {
  const expected = straightRun(TWO_DAYS).log;

  it('gives the same log whether time moves in one step, by the minute, or in uneven steps', () => {
    for (const steps of [
      [TWO_DAYS - FIRST_BOOT_START],
      Array<number>((TWO_DAYS - FIRST_BOOT_START) / 60).fill(60),
      [1, 59, 3600, 7, 100000, TWO_DAYS - FIRST_BOOT_START - (1 + 59 + 3600 + 7 + 100000)],
    ]) {
      const db = createTestDb();
      const sim = boot(db);
      for (const step of steps) sim.clock.advance(step);
      expect(listEvents(db)).toEqual(expected);
    }
  });

  it('gives the same log for the same seed and a different one for another seed', () => {
    expect(straightRun(SECONDS_PER_DAY).log).toEqual(straightRun(SECONDS_PER_DAY).log);
    const other = ofType(straightRun(SECONDS_PER_DAY, 7).log, 'order_created');
    expect(other).not.toEqual(ofType(straightRun(SECONDS_PER_DAY).log, 'order_created'));
  });

  it('builds the same state from the log as the live run has (replay equals live)', () => {
    const { db } = straightRun(TWO_DAYS);
    const live = snapshotProjections(db);
    rebuildProjections(db);
    expect(snapshotProjections(db)).toEqual(live);
  });
});

describe('restarting the server', () => {
  const expected = straightRun(TWO_DAYS).log;
  const cuts = [
    FIRST_BOOT_START + 1,
    OPEN_TIME_SEC, // exactly when the day opens
    simTime(0, 9, 18) + 17,
    simTime(0, 12, 0),
    CLOSE_TIME_SEC,
    CLOSE_TIME_SEC + 1,
    SECONDS_PER_DAY - 5,
    SECONDS_PER_DAY + simTime(0, 14, 3) + 30, // the next day, mid-afternoon
  ];

  it.each(cuts)('gives the identical log when the server restarts at %i s', (cut) => {
    const db = createTestDb();
    const first = boot(db);
    runTo(first, cut);
    const eventsBefore = countRows(db, 'events');

    const second = boot(db); // the restart: a new simulation on the same database
    expect(second.recovered).toBe(true);
    expect(second.replayedEvents).toBe(eventsBefore);
    expect(countRows(db, 'events')).toBe(eventsBefore); // booting writes nothing
    runTo(second, TWO_DAYS);

    expect(listEvents(db)).toEqual(expected);
  });

  it.each(cuts)(
    'gives the identical log when the clock was saved before the restart at %i s',
    (cut) => {
      const db = createTestDb();
      const first = boot(db);
      runTo(first, cut);
      saveClockState(db, { current_sim_sec: first.clock.now(), speed: 60, paused: false });

      const second = boot(db);
      expect(second.clock.now()).toBe(cut);
      runTo(second, TWO_DAYS);

      expect(listEvents(db)).toEqual(expected);
    },
  );

  it('survives several restarts in a row', () => {
    const db = createTestDb();
    let sim = boot(db);
    for (const stop of [30000, 31000, 45000, 45001, 80000, 100000, 150000]) {
      runTo(sim, stop);
      sim = boot(db);
    }
    runTo(sim, TWO_DAYS);
    expect(listEvents(db)).toEqual(expected);
  });

  it('puts the clock at the last event when no clock was saved, and at the saved clock when it is later', () => {
    const db = createTestDb();
    const first = boot(db);
    runTo(first, simTime(0, 9, 0));
    const lastEvent = (listEvents(db).at(-1) as StoredEvent).sim_time;
    expect(lastEvent).toBeLessThanOrEqual(simTime(0, 9, 0));

    expect(boot(db).clock.now()).toBe(lastEvent); // saved clock is still 0

    saveClockState(db, { current_sim_sec: simTime(0, 9, 0), speed: 60, paused: false });
    expect(boot(db).clock.now()).toBe(simTime(0, 9, 0));

    saveClockState(db, { current_sim_sec: 100, speed: 60, paused: false }); // older than the log
    expect(boot(db).clock.now()).toBe(lastEvent);
  });

  it('takes the seed from the log, not from the configuration', () => {
    const db = createTestDb();
    const first = boot(db, 42);
    runTo(first, simTime(0, 12, 0));
    const second = boot(db, 7); // config now says 7
    expect(second.scenario.seed).toBe(42);
    runTo(second, TWO_DAYS);
    expect(listEvents(db)).toEqual(expected);
  });

  it('keeps the other scenario settings from the current configuration', () => {
    const db = createTestDb();
    boot(db, 42, { crowdPct: 100 });
    const second = boot(db, 42, { crowdPct: 300 });
    expect(second.scenario.crowdPct).toBe(300);
  });
});

describe('skipTime', () => {
  it('records sim_time_advanced as the boss and then moves the clock, without losing events on the way', () => {
    const db = createTestDb();
    const sim = boot(db);
    runTo(sim, OPEN_TIME_SEC);
    sim.skipTime(1800);

    expect(sim.clock.now()).toBe(OPEN_TIME_SEC + 1800);
    const log = listEvents(db);
    const skip = ofType(log, 'sim_time_advanced');
    expect(skip).toHaveLength(1);
    expect(skip[0]).toMatchObject({
      actor: 'boss',
      origin: 'boss',
      sim_time: OPEN_TIME_SEC,
      payload: { from: OPEN_TIME_SEC, to: OPEN_TIME_SEC + 1800 },
    });
    const withoutSkip = log.filter((event) => event.type !== 'sim_time_advanced');
    // Same events as a run without the jump (ids differ because of the extra event).
    expect(withoutIds(withoutSkip)).toEqual(withoutIds(straightRun(OPEN_TIME_SEC + 1800).log));
  });

  it('rejects an amount that is not a positive whole number', () => {
    const sim = boot(createTestDb());
    expect(() => sim.skipTime(0)).toThrow(/positive whole number/);
    expect(() => sim.skipTime(-5)).toThrow(/positive whole number/);
    expect(() => sim.skipTime(1.5)).toThrow(/positive whole number/);
  });
});

describe('scenario settings', () => {
  it('lets every order that waited long enough complain at 100%', () => {
    const { log } = straightRun(SECONDS_PER_DAY, 42, { complaintChancePct: 100 });
    const complained = new Set(
      ofType(log, 'complaint_received').map((e) => (e.payload as { order_id: number }).order_id),
    );
    // The last complaint check of the day is at closing time.
    const lastCheck = CLOSE_TIME_SEC;
    const mustComplain = ofType(log, 'order_created').filter((e) => {
      const due = Math.ceil((e.sim_time + 1200) / 60) * 60;
      return due <= lastCheck;
    });
    expect(mustComplain.length).toBeGreaterThan(50);
    expect(complained).toEqual(
      new Set(mustComplain.map((e) => (e.payload as { order_id: number }).order_id)),
    );
  });

  it('has no complaints at 0%', () => {
    expect(
      ofType(straightRun(SECONDS_PER_DAY, 42, { complaintChancePct: 0 }).log, 'complaint_received'),
    ).toEqual([]);
  });

  it('has no orders at crowd 0, but the cafe still opens, expects its regulars and closes', () => {
    const { log } = straightRun(SECONDS_PER_DAY, 42, { crowdPct: 0 });
    expect(ofType(log, 'order_created')).toEqual([]);
    expect(ofType(log, 'day_opened')).toHaveLength(1);
    expect(ofType(log, 'regular_expected')).toHaveLength(3);
    expect(ofType(log, 'day_closed')).toHaveLength(1);
  });
});

describe('publishing', () => {
  it('hands every event that was saved to the bus, in the order it was saved', () => {
    const db = createTestDb();
    const bus = new EventBus();
    const published: StoredEvent[] = [];
    bus.subscribe((events) => published.push(...events));
    const sim = boot(db, 42, {}, bus);
    runTo(sim, SECONDS_PER_DAY);
    sim.skipTime(600);
    expect(published).toEqual(listEvents(db));
    expect(published.length).toBeGreaterThan(80);
  });

  it('keeps the saved clock readable', () => {
    const db = createTestDb();
    saveClockState(db, { current_sim_sec: 123, speed: 600, paused: true });
    expect(readClockState(db)).toEqual({ current_sim_sec: 123, speed: 600, paused: true });
  });
});
