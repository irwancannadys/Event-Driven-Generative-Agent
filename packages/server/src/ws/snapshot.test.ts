import { describe, expect, it } from 'vitest';
import {
  RECENT_COMPLAINT_WINDOW_SEC,
  WALK_IN_SEC,
  makeScenario,
  walkDurationSec,
  type TimeView,
} from '@cafe/core';
import { EventBus } from '../events/bus';
import { FIRST_BOOT_START, bootSimulation, type Simulation } from '../sim/simulation';
import { ev } from '../test-support/events';
import { appendInTransaction, createTestDb, createTestWorld } from '../test-support/world';
import { createOrder } from '../usecases/orders';
import { decideReport } from '../usecases/reports';
import {
  RECENT_DONE_WINDOW_SEC,
  SNAPSHOT_EVENT_COUNT,
  SNAPSHOT_ORDER_COUNT,
  buildSnapshot,
} from './snapshot';

const TIME: TimeView = { sim_time: 28_200, clock: '07:50', day: 0, speed: 60, paused: false };

function world() {
  const db = createTestDb();
  const sim = bootSimulation({
    db,
    bus: new EventBus(),
    scenario: makeScenario(42, { crowdPct: 0 }),
  });
  return { db, sim };
}

const runTo = (sim: Simulation, seconds: number) =>
  sim.clock.advance(FIRST_BOOT_START + seconds - sim.clock.now());
const cups = (sim: Simulation, qty: number) =>
  createOrder(sim.ctx, { items: [{ menu_item_id: 'kopi_susu', qty }] }).order_id;

// The story of restock.test.ts: ten cups of coffee, the admin checks the shelf (from 45 s), writes a
// proposal (at 135 s), walks to the boss desk, hands the report in (60 s) and walks back.
const TO_BOSS = walkDurationSec('stock_shelf', 'boss_desk');
const SUBMITTED_AT = 45 + 90 + TO_BOSS + 60;

describe('buildSnapshot', () => {
  it('describes a new world: everybody at home and idle, nothing ordered, the log from the start', () => {
    const { sim } = world();
    const snapshot = buildSnapshot(sim.ctx, TIME);
    expect(snapshot.time).toEqual(TIME);
    expect(snapshot.agents.map((agent) => [agent.id, agent.station, agent.state])).toEqual([
      ['cashier', 'cashier', 'idle'],
      ['cook', 'kitchen', 'idle'],
      ['stock_admin', 'stock_shelf', 'idle'],
      ['waiter', 'table_2', 'idle'],
    ]);
    expect(
      snapshot.agents.every((agent) => agent.task === null && agent.from_station === null),
    ).toBe(true);
    expect(snapshot.stock).toHaveLength(8);
    expect(snapshot.stock.find((row) => row.ingredient_id === 'susu')).toMatchObject({
      qty: 2500,
      low: false,
      out: false,
    });
    expect(snapshot.orders).toEqual({ placed: 0, held: 0, cooking: 0, done: 0 });
    expect(snapshot.recent_orders).toEqual([]);
    expect(snapshot.complaints).toEqual([]);
    expect(snapshot.reports).toEqual([]);
    expect(snapshot.events.map((event) => event.type)).toEqual(['world_initialized']);
    expect(snapshot.last_event_id).toBe(snapshot.events.at(-1)?.id);
  });

  it('survives a trip through JSON, as it travels over the socket', () => {
    const { sim } = world();
    cups(sim, 10);
    runTo(sim, 200);
    const snapshot = buildSnapshot(sim.ctx, TIME);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('shows who is doing what, until when, and how many tasks wait', () => {
    const { sim } = world();
    cups(sim, 10);
    const now = sim.clock.now();
    const { agents, orders } = buildSnapshot(sim.ctx, TIME);
    expect(agents[0]).toMatchObject({
      id: 'cashier',
      state: 'working',
      task: {
        kind: 'work',
        label: 'recording_order',
        started_at_sim: now,
        ends_at_sim: now + 45,
      },
    });
    expect(orders).toEqual({ placed: 1, held: 0, cooking: 0, done: 0 });
  });

  it('knows where a walking agent set off from', () => {
    const { sim } = world();
    cups(sim, 10);
    runTo(sim, 45 + 90 + 20); // the proposal is written and she is on her way to the boss
    const toBoss = buildSnapshot(sim.ctx, TIME).agents[2];
    expect(toBoss).toMatchObject({
      id: 'stock_admin',
      state: 'walking',
      station: 'boss_desk', // the destination
      from_station: 'stock_shelf',
      task: { kind: 'goto', station: 'boss_desk' },
    });
    expect((toBoss?.task?.ends_at_sim ?? 0) - (toBoss?.task?.started_at_sim ?? 0)).toBe(TO_BOSS);

    runTo(sim, SUBMITTED_AT + 20); // the report is handed in, she walks back
    expect(buildSnapshot(sim.ctx, TIME).agents[2]).toMatchObject({
      state: 'walking',
      station: 'stock_shelf',
      from_station: 'boss_desk',
    });
    runTo(sim, SUBMITTED_AT + TO_BOSS + 10);
    expect(buildSnapshot(sim.ctx, TIME).agents[2]).toMatchObject({
      state: 'idle',
      from_station: null,
    });
  });

  it('starts a first walk from the agent home when no state came before it', () => {
    const { db, ctx } = createTestWorld();
    appendInTransaction(
      db,
      ev.agentTaskAssigned('waiter', 1, {
        kind: 'goto',
        station: 'table_1',
        duration_sim_sec: 100,
      }),
      ev.agentStateChanged('waiter', 'walking', 'table_1', { task_id: 1, eta_sim_time: 28_900 }),
    );
    expect(buildSnapshot(ctx, TIME).agents[3]).toMatchObject({
      id: 'waiter',
      state: 'walking',
      from_station: 'table_2',
      station: 'table_1',
    });
  });

  it('lists the reports that are not decided yet, and drops them once decided', () => {
    const { sim } = world();
    cups(sim, 10);
    runTo(sim, 200);
    expect(buildSnapshot(sim.ctx, TIME).reports).toMatchObject([
      { id: 1, status: 'drafted', type: 'restock', title: 'Usul belanja: Susu' },
    ]);
    runTo(sim, SUBMITTED_AT + 1);
    expect(buildSnapshot(sim.ctx, TIME).reports).toMatchObject([{ id: 1, status: 'submitted' }]);
    decideReport(sim.ctx, { report_id: 1, decision: 'approved' });
    expect(buildSnapshot(sim.ctx, TIME).reports).toEqual([]);
  });

  it('keeps only the newest events, oldest first', () => {
    const { ctx } = createTestWorld();
    for (let order = 0; order < SNAPSHOT_EVENT_COUNT + 10; order += 1) {
      createOrder(ctx, { items: [{ menu_item_id: 'kopi_susu', qty: 1 }] });
    }
    const { events, last_event_id } = buildSnapshot(ctx, TIME);
    expect(events).toHaveLength(SNAPSHOT_EVENT_COUNT);
    expect(events.at(-1)?.id).toBe(last_event_id);
    expect(events.map((event) => event.id)).toEqual(
      events.map((_, index) => last_event_id - SNAPSHOT_EVENT_COUNT + 1 + index),
    );
  });
});

describe('the orders and complaints in a snapshot', () => {
  const at = (sim: Simulation) => ({ ...TIME, sim_time: sim.clock.now() });

  it('lists an order from the moment it is placed, until a while after it is done', () => {
    const { sim } = world();
    cups(sim, 1);
    expect(buildSnapshot(sim.ctx, at(sim)).recent_orders).toEqual([
      {
        id: 1,
        status: 'placed',
        source: 'walk_in',
        customer_id: null,
        created_at_sim: FIRST_BOOT_START,
        recorded_at_sim: null,
        done_at_sim: null,
      },
    ]);

    runTo(sim, 45 + 5); // the cashier is done writing it down, the cook starts
    expect(buildSnapshot(sim.ctx, at(sim)).recent_orders[0]).toMatchObject({
      status: 'cooking',
      recorded_at_sim: FIRST_BOOT_START + 45,
    });

    runTo(sim, 45 + 180 + 5); // cooked: it stays in the snapshot, with the time it was done
    expect(buildSnapshot(sim.ctx, at(sim)).recent_orders).toMatchObject([
      { id: 1, status: 'done', done_at_sim: FIRST_BOOT_START + 45 + 180 },
    ]);

    runTo(sim, 45 + 180 + RECENT_DONE_WINDOW_SEC - 10); // the customer is nearly out of the door
    expect(buildSnapshot(sim.ctx, at(sim)).recent_orders).toHaveLength(1);
    runTo(sim, 45 + 180 + RECENT_DONE_WINDOW_SEC + 10); // gone
    expect(buildSnapshot(sim.ctx, at(sim)).recent_orders).toEqual([]);
  });

  it('lists a customer that came in at the door until it places its order, and ties the order to it', () => {
    const db = createTestDb();
    const sim = bootSimulation({ db, bus: new EventBus(), scenario: makeScenario(42) });
    sim.clock.advance(28_993 - sim.clock.now());
    expect(buildSnapshot(sim.ctx, at(sim)).arrivals_in_flight).toEqual([]);
    sim.clock.advance(29_000 - sim.clock.now()); // in at the door at 28994 (08:03:14), still walking
    expect(buildSnapshot(sim.ctx, at(sim)).arrivals_in_flight).toEqual([
      { customer_id: 48_300, arrived_at_sim: 28_994 },
    ]);
    expect(buildSnapshot(sim.ctx, at(sim)).recent_orders).toEqual([]);
    sim.clock.advance(28_994 + WALK_IN_SEC - sim.clock.now()); // at the counter: the order comes in
    const snapshot = buildSnapshot(sim.ctx, at(sim));
    expect(snapshot.arrivals_in_flight.map((arrival) => arrival.customer_id)).not.toContain(48_300);
    expect(snapshot.recent_orders[0]).toMatchObject({ id: 1, customer_id: 48_300 });
  });

  it('keeps an order that is still not done however old it is', () => {
    const { sim } = world();
    for (let order = 0; order < 4; order += 1) cups(sim, 10); // the cook has hours of work
    runTo(sim, 5 * 3600);
    const { recent_orders } = buildSnapshot(sim.ctx, at(sim));
    expect(recent_orders.some((order) => order.status !== 'done')).toBe(true);
    expect(recent_orders.map((order) => order.id)).toEqual(
      [...recent_orders.map((order) => order.id)].sort((a, b) => a - b),
    );
  });

  it('carries at most the newest 200 orders, oldest first', () => {
    const { ctx } = createTestWorld();
    for (let order = 0; order < SNAPSHOT_ORDER_COUNT + 15; order += 1) {
      createOrder(ctx, { items: [{ menu_item_id: 'kopi_susu', qty: 1 }] });
    }
    const { recent_orders } = buildSnapshot(ctx, TIME);
    expect(recent_orders).toHaveLength(SNAPSHOT_ORDER_COUNT);
    expect(recent_orders[0]?.id).toBe(16);
    expect(recent_orders.at(-1)?.id).toBe(SNAPSHOT_ORDER_COUNT + 15);
  });

  it('lists a complaint from the moment it comes in, and for two hours after the cashier has answered it', () => {
    const db = createTestDb();
    const sim = bootSimulation({
      db,
      bus: new EventBus(),
      scenario: makeScenario(42, { crowdPct: 0, complaintChancePct: 100, complaintWaitSec: 600 }),
    });
    cups(sim, 10); // ten coffees: a long wait, so the customer complains
    // Complaints are only checked once the cafe is open (at 600 s), so the first one comes at 660 s, and the
    // cashier, who has to write it down for a minute, answers at 720 s.
    runTo(sim, 659);
    expect(buildSnapshot(sim.ctx, at(sim)).complaints).toEqual([]);
    runTo(sim, 700);
    expect(buildSnapshot(sim.ctx, at(sim)).complaints).toEqual([
      {
        complaint_id: 1,
        order_id: 1,
        cause: 'slow_service',
        status: 'received',
        received_at_sim: FIRST_BOOT_START + 660,
        replied_at_sim: null,
        compensation: null,
      },
    ]);
    runTo(sim, 730); // answered: it stays, with what the customer was given
    expect(buildSnapshot(sim.ctx, at(sim)).complaints).toMatchObject([
      { complaint_id: 1, status: 'replied', replied_at_sim: FIRST_BOOT_START + 720 },
    ]);
    runTo(sim, 720 + RECENT_COMPLAINT_WINDOW_SEC - 10);
    expect(buildSnapshot(sim.ctx, at(sim)).complaints).toHaveLength(1);
    runTo(sim, 720 + RECENT_COMPLAINT_WINDOW_SEC + 10); // long ago: gone
    expect(buildSnapshot(sim.ctx, at(sim)).complaints).toEqual([]);
  });
});
