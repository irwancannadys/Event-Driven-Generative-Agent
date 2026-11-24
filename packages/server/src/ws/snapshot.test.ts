import { describe, expect, it } from 'vitest';
import { makeScenario, walkDurationSec, type TimeView } from '@cafe/core';
import { EventBus } from '../events/bus';
import { FIRST_BOOT_START, bootSimulation, type Simulation } from '../sim/simulation';
import { ev } from '../test-support/events';
import { appendInTransaction, createTestDb, createTestWorld } from '../test-support/world';
import { createOrder } from '../usecases/orders';
import { decideReport } from '../usecases/reports';
import { SNAPSHOT_EVENT_COUNT, buildSnapshot } from './snapshot';

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
