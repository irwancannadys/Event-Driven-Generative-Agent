import { describe, expect, it } from 'vitest';
import { makeScenario, type StoredEvent } from '@cafe/core';
import { listEvents } from '../events/store';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import { FIRST_BOOT_START, bootSimulation, type Simulation } from '../sim/simulation';
import { createTestDb } from '../test-support/world';
import { createOrder } from '../usecases/orders';
import { readAgent } from './engine';

const START = FIRST_BOOT_START;

function quietWorld() {
  const db = createTestDb();
  const sim = bootSimulation({ db, scenario: makeScenario(42, { crowdPct: 0 }) });
  return { db, sim };
}

const kopiSusu = (qty = 1) => ({ items: [{ menu_item_id: 'kopi_susu', qty }] });

function times(db: ReturnType<typeof createTestDb>, type: string): number[] {
  return listEvents(db)
    .filter((event: StoredEvent) => event.type === type)
    .map((event) => event.sim_time - START);
}

const status = (db: ReturnType<typeof createTestDb>, id: number) =>
  db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(id);

describe('one order, from the door to the table', () => {
  it('goes from the cashier to the cook and is done when the cooking time is up', () => {
    const { db, sim } = quietWorld();
    const { order_id } = createOrder(sim.ctx, kopiSusu());
    sim.clock.advance(1000);

    expect(times(db, 'order_created')).toEqual([0]);
    expect(times(db, 'cooking_started')).toEqual([45]); // after the cashier wrote it down
    expect(times(db, 'cooking_done')).toEqual([45 + 180]);
    expect(status(db, order_id)).toBe('done');
    expect(db.prepare('SELECT done_at_sim FROM orders WHERE id = ?').pluck().get(order_id)).toBe(
      START + 225,
    );
    expect(readAgent(db, 'cashier').state).toBe('idle');
    expect(readAgent(db, 'cook').state).toBe('idle');
  });

  it('keeps the cook idle while the cashier is writing, and the cashier idle while the cook cooks', () => {
    const { db, sim } = quietWorld();
    createOrder(sim.ctx, kopiSusu());
    sim.clock.advance(10);
    expect(readAgent(db, 'cashier').state).toBe('working');
    expect(readAgent(db, 'cook').state).toBe('idle');
    sim.clock.advance(40);
    expect(readAgent(db, 'cashier').state).toBe('idle');
    expect(readAgent(db, 'cook').state).toBe('working');
  });

  it('uses the ingredients when the cook starts, not when the order comes in', () => {
    const { db, sim } = quietWorld();
    createOrder(sim.ctx, kopiSusu());
    const susu = () =>
      db.prepare("SELECT qty FROM stock WHERE ingredient_id = 'susu'").pluck().get();
    sim.clock.advance(44);
    expect(susu()).toBe(2500);
    sim.clock.advance(1);
    expect(susu()).toBe(2350);
  });

  it('takes as long to cook as all the portions of the order together', () => {
    const { db, sim } = quietWorld();
    createOrder(sim.ctx, {
      items: [
        { menu_item_id: 'nasi_goreng', qty: 1 },
        { menu_item_id: 'roti_bakar', qty: 2 },
      ],
    });
    sim.clock.advance(5000);
    expect(times(db, 'cooking_started')).toEqual([45]);
    expect(times(db, 'cooking_done')).toEqual([45 + 480 + 2 * 300]);
  });
});

describe('several orders at once', () => {
  it('queue up at the cashier and then at the cook, first in first out', () => {
    const { db, sim } = quietWorld();
    const ids = [1, 2, 3].map(() => createOrder(sim.ctx, kopiSusu()).order_id);
    sim.clock.advance(5000);
    // The cashier writes them down at 45, 90 and 135. The cook is busy until 225 and 405.
    expect(times(db, 'cooking_started')).toEqual([45, 225, 405]);
    expect(times(db, 'cooking_done')).toEqual([225, 405, 585]);
    for (const id of ids) expect(status(db, id)).toBe('done');
    const cooked = listEvents(db)
      .filter((event) => event.type === 'cooking_started')
      .map((event) => (event.payload as { order_id: number }).order_id);
    expect(cooked).toEqual(ids);
  });
});

describe('an order that cannot be cooked', () => {
  it('is held when the ingredients are short, and does not block the next order', () => {
    const { db, sim } = quietWorld();
    const big = createOrder(sim.ctx, kopiSusu(17)).order_id; // needs 2550 ml of milk, only 2500 in stock
    const small = createOrder(sim.ctx, kopiSusu()).order_id;
    sim.clock.advance(5000);

    expect(status(db, big)).toBe('held');
    expect(status(db, small)).toBe('done');
    expect(times(db, 'order_held')).toEqual([45]);
    expect(times(db, 'cooking_done')).toHaveLength(1);
    // Only the small order used milk.
    expect(db.prepare("SELECT qty FROM stock WHERE ingredient_id = 'susu'").pluck().get()).toBe(
      2350,
    );
    expect(readAgent(db, 'cook').state).toBe('idle');
  });
});

describe('restarting in the middle of the work', () => {
  function story(restartAt?: number) {
    const { db, sim: first } = quietWorld();
    for (let i = 0; i < 3; i += 1) createOrder(first.ctx, kopiSusu());
    createOrder(first.ctx, kopiSusu(17));
    let sim: Simulation = first;
    if (restartAt !== undefined) {
      first.clock.advance(restartAt - first.clock.now());
      sim = bootSimulation({ db, scenario: makeScenario(42, { crowdPct: 0 }) });
    }
    sim.clock.advance(START + 4000 - sim.clock.now());
    return { db, log: listEvents(db) };
  }

  const straight = story();

  it('has a story worth checking: cooked orders and a held one', () => {
    const types = straight.log.map((event) => event.type);
    expect(types.filter((type) => type === 'cooking_done')).toHaveLength(3);
    expect(types).toContain('order_held');
  });

  it.each([
    START + 1,
    START + 44,
    START + 45,
    START + 100,
    START + 225,
    START + 300,
    START + 585,
    START + 700,
  ])('gives the identical log when the server restarts at %i s', (restartAt) => {
    expect(story(restartAt).log).toEqual(straight.log);
  });

  it('builds the same state from the log as the live run has', () => {
    const { db } = straight;
    const live = snapshotProjections(db);
    rebuildProjections(db);
    expect(snapshotProjections(db)).toEqual(live);
  });
});
