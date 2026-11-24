import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
  INITIAL_STOCK,
  OPEN_TIME_SEC,
  SECONDS_PER_DAY,
  eventSchema,
  type StoredEvent,
} from '@cafe/core';
import type { Db } from '../db/database';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import { playDay } from '../test-support/play-day';

// A whole virtual day of the cafe with the characters and an automatic boss (stage 3). The day is a
// story with a lot in it: orders, a stock that runs low, reports, a "no" from the boss and a new
// proposal, deliveries that are on time or late, held orders that continue, and complaints.

const day = playDay();
const count = (log: StoredEvent[], type: string) =>
  log.filter((event) => event.type === type).length;

describe('a day with the characters', () => {
  it('has all the ingredients of a story worth checking', () => {
    const { log } = day;
    expect(count(log, 'order_created')).toBeGreaterThan(50);
    expect(count(log, 'cooking_done')).toBeGreaterThan(50);
    expect(count(log, 'stock_low')).toBeGreaterThan(0);
    expect(count(log, 'report_submitted')).toBeGreaterThan(0);
    expect(count(log, 'order_held')).toBeGreaterThan(0);
    expect(count(log, 'order_resumed')).toBeGreaterThan(0);
    expect(count(log, 'restock_arrived')).toBeGreaterThan(0);
    expect(count(log, 'complaint_replied')).toBeGreaterThan(0);

    const decisions = log
      .filter((event) => event.type === 'report_decided')
      .map((event) => (event.payload as { decision: string }).decision);
    expect(decisions).toContain('approved');
    expect(decisions).toContain('rejected');
    const suppliers = log
      .filter((event) => event.type === 'restock_ordered')
      .map((event) => (event.payload as { supplier: string }).supplier);
    expect(new Set(suppliers).size).toBeGreaterThan(1);
  });

  it('writes only events from the catalog, valid, with consecutive ids and the time never going back', () => {
    const { log } = day;
    for (const event of log) {
      expect(EVENT_TYPES as readonly string[], event.type).toContain(event.type);
      const { type, sim_time, actor, origin, payload } = event;
      const parsed = eventSchema.safeParse({ type, sim_time, actor, origin, payload });
      expect(parsed.success, `${event.id} ${event.type}`).toBe(true);
    }
    expect(log.map((event) => event.id)).toEqual(log.map((_, index) => index + 1));
    for (let index = 1; index < log.length; index += 1) {
      expect(log[index]?.sim_time, `event ${index + 1}`).toBeGreaterThanOrEqual(
        log[index - 1]?.sim_time ?? 0,
      );
    }
  });

  it('answers every complaint, and the ones that need the boss wait for him', () => {
    const { log } = day;
    expect(count(log, 'complaint_replied')).toBe(count(log, 'complaint_received'));
    const triaged = log.filter((event) => event.type === 'complaint_triaged');
    for (const event of triaged) {
      const { needs_boss_decision, report } = event.payload as {
        needs_boss_decision: boolean;
        report?: unknown;
      };
      expect(report !== undefined).toBe(needs_boss_decision);
    }
  });
});

describe('what must always be true', () => {
  const stockByLog = (log: StoredEvent[]): Record<string, number> => {
    const stock: Record<string, number> = { ...INITIAL_STOCK };
    for (const event of log) {
      const payload = event.payload as Record<string, unknown>;
      if (event.type === 'stock_decreased') {
        const id = payload.ingredient_id as string;
        stock[id] = (stock[id] ?? 0) - (payload.qty as number);
      }
      if (event.type === 'restock_arrived') {
        for (const line of payload.items as { ingredient_id: string; qty: number }[]) {
          stock[line.ingredient_id] = (stock[line.ingredient_id] ?? 0) + line.qty;
        }
      }
    }
    return stock;
  };

  it('never lets the stock go below zero, and the stock adds up from the log', () => {
    for (const event of day.log) {
      if (event.type === 'stock_decreased') {
        expect((event.payload as { new_qty: number }).new_qty).toBeGreaterThanOrEqual(0);
      }
    }
    const stock = Object.fromEntries(
      (
        day.db.prepare('SELECT ingredient_id, qty FROM stock').all() as {
          ingredient_id: string;
          qty: number;
        }[]
      ).map((row) => [row.ingredient_id, row.qty]),
    );
    expect(stock).toEqual(stockByLog(day.log));
  });

  it('loses no order: each one is done, held, or still in the hands of a character', () => {
    const orders = day.db.prepare('SELECT id, status FROM orders').all() as {
      id: number;
      status: string;
    }[];
    const inHands = (db: Db, id: number) =>
      db
        .prepare(
          `SELECT COUNT(*) FROM agent_tasks
           WHERE status IN ('queued', 'active')
             AND json_extract(params_json, '$.ref.type') = 'order'
             AND json_extract(params_json, '$.ref.id') = ?`,
        )
        .pluck()
        .get(id) as number;
    expect(orders.length).toBe(count(day.log, 'order_created'));
    for (const order of orders) {
      if (order.status === 'done' || order.status === 'held') continue;
      expect(inHands(day.db, order.id), `order ${order.id} is ${order.status}`).toBeGreaterThan(0);
    }
  });

  it('has the characters in a sane state at midnight: nobody is walking to nowhere', () => {
    const agents = day.db.prepare('SELECT id, state FROM agents').all() as {
      id: string;
      state: string;
    }[];
    for (const agent of agents) {
      const active = day.db
        .prepare("SELECT COUNT(*) FROM agent_tasks WHERE agent_id = ? AND status = 'active'")
        .pluck()
        .get(agent.id) as number;
      expect(active > 0, `${agent.id} is ${agent.state}`).toBe(agent.state !== 'idle');
    }
  });

  it('opens at 08:00 and closes at 20:00, and nobody acts before the world exists', () => {
    expect(day.log[0]?.type).toBe('world_initialized');
    expect(day.log.find((event) => event.type === 'day_opened')?.sim_time).toBe(OPEN_TIME_SEC);
    expect(day.log.at(-1)?.sim_time).toBeLessThanOrEqual(SECONDS_PER_DAY);
  });
});

describe('determinism with characters', () => {
  it('gives the same log for the same seed and another one for another seed', () => {
    expect(playDay().log).toEqual(day.log);
    expect(playDay({ seed: 7 }).log).not.toEqual(day.log);
  });

  it.each([60, 1000, 3601])(
    'gives the identical log when the time moves in steps of %i s',
    (stepSec) => {
      expect(playDay({ stepSec }).log).toEqual(day.log);
    },
  );

  it('builds the same state from the log as the live run has (replay equals live)', () => {
    const live = snapshotProjections(day.db);
    rebuildProjections(day.db);
    expect(snapshotProjections(day.db)).toEqual(live);
  });
});

describe('restarting the server during the day', () => {
  // Cuts at moments that matter: just after boot, in the middle of a walk, a task, a cooking, at lunch,
  // while a report lies on the desk, while a delivery is under way, and around closing.
  const cuts = [
    28201, 28800, 29000, 31234, 36000, 41000, 43200, 45678, 47999, 48500, 50000, 55140, 60000,
    64680, 66452, 70000, 72000, 72601, 80000, 86399,
  ];

  it.each(cuts)('gives the identical log when the server restarts at %i s', (cut) => {
    expect(playDay({ restartAt: [cut] }).log).toEqual(day.log);
  });

  it('survives a restart every 37 minutes', () => {
    const every = 37 * 60;
    const restartAt: number[] = [];
    for (let at = 28200 + every; at < SECONDS_PER_DAY; at += every) restartAt.push(at);
    expect(restartAt.length).toBeGreaterThan(20);
    expect(playDay({ restartAt }).log).toEqual(day.log);
  });
});
