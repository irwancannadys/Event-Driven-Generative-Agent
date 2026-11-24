import { afterEach, describe, expect, it } from 'vitest';
import { makeScenario, walkDurationSec } from '@cafe/core';
import { listEvents } from '../events/store';
import { FIRST_BOOT_START, bootSimulation, type Simulation } from '../sim/simulation';
import { createTestDb } from '../test-support/world';
import { createOrder } from '../usecases/orders';
import { startApiServer, type RunningApi } from './api';

let api: RunningApi | undefined;

afterEach(async () => {
  await api?.close();
  api = undefined;
});

async function boot(scenario = makeScenario(42, { crowdPct: 0 })) {
  const db = createTestDb();
  const sim = bootSimulation({ db, scenario });
  api = await startApiServer(sim.ctx);
  return { db, sim, url: api.url };
}

const runTo = (sim: Simulation, seconds: number) =>
  sim.clock.advance(FIRST_BOOT_START + seconds - sim.clock.now());

const cups = (sim: Simulation, qty: number) =>
  createOrder(sim.ctx, { items: [{ menu_item_id: 'kopi_susu', qty }] }).order_id;

// Ten cups of coffee with milk push the milk to its minimum: the admin checks the shelf, writes a
// proposal, and has handed in the report at this moment (the same story as in restock.test.ts).
const REPORT_ON_DESK_AT = 45 + 90 + walkDurationSec('stock_shelf', 'boss_desk') + 60;

async function bossDesk() {
  const world = await boot();
  cups(world.sim, 10);
  runTo(world.sim, REPORT_ON_DESK_AT + 1);
  return world;
}

const json = async (response: Response) => (await response.json()) as unknown;

function decide(url: string, id: number | string, body: unknown) {
  return fetch(`${url}/reports/${id}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('GET /agents', () => {
  it('shows all four characters at home, doing nothing', async () => {
    const { url } = await boot();
    expect(await json(await fetch(`${url}/agents`))).toEqual([
      { id: 'cashier', role: 'cashier', station: 'cashier', state: 'idle', task: null, queued: 0 },
      { id: 'cook', role: 'cook', station: 'kitchen', state: 'idle', task: null, queued: 0 },
      {
        id: 'stock_admin',
        role: 'stock_admin',
        station: 'stock_shelf',
        state: 'idle',
        task: null,
        queued: 0,
      },
      { id: 'waiter', role: 'waiter', station: 'table_2', state: 'idle', task: null, queued: 0 },
    ]);
  });

  it('shows what a busy character is doing, until when, and how much waits behind it', async () => {
    const { sim, url } = await boot();
    cups(sim, 1);
    cups(sim, 1);
    const now = sim.clock.now();
    const agents = (await json(await fetch(`${url}/agents`))) as { id: string }[];
    expect(agents.find((agent) => agent.id === 'cashier')).toMatchObject({
      state: 'working',
      station: 'cashier',
      task: { kind: 'work', label: 'recording_order', ends_at_sim: now + 45 },
      queued: 1, // the second order waits behind the first
    });
  });

  it('shows a walking character with the station she walks to', async () => {
    const { sim, url } = await boot();
    cups(sim, 10);
    runTo(sim, 45 + 90 + 20); // the admin has decided and is on her way to the boss
    const agents = (await json(await fetch(`${url}/agents`))) as { id: string }[];
    expect(agents.find((agent) => agent.id === 'stock_admin')).toMatchObject({
      state: 'walking',
      task: { kind: 'goto', station: 'boss_desk' },
    });
  });
});

describe('GET /orders', () => {
  it('lists the orders with their items, oldest first', async () => {
    const { sim, url } = await boot();
    cups(sim, 2);
    createOrder(sim.ctx, { items: [{ menu_item_id: 'roti_bakar', qty: 1 }] });
    const orders = (await json(await fetch(`${url}/orders`))) as { id: number }[];
    expect(orders.map((order) => order.id)).toEqual([1, 2]);
    expect(orders[0]).toEqual({
      id: 1,
      status: 'placed',
      source: 'walk_in',
      created_at_sim: FIRST_BOOT_START,
      done_at_sim: null,
      items: [{ menu_item_id: 'kopi_susu', qty: 2 }],
    });
  });

  it('can filter by status and keep only the newest ones', async () => {
    const { sim, url } = await boot();
    for (let order = 0; order < 3; order += 1) cups(sim, 1);
    runTo(sim, 45 + 180 + 5); // the first order is cooked by now
    const done = (await json(await fetch(`${url}/orders?status=done`))) as { id: number }[];
    expect(done.map((order) => order.id)).toEqual([1]);
    const newest = (await json(await fetch(`${url}/orders?limit=2`))) as { id: number }[];
    expect(newest.map((order) => order.id)).toEqual([2, 3]);
  });

  it('answers 400 for a status or a limit that makes no sense', async () => {
    const { url } = await boot();
    for (const query of ['status=ready', 'limit=0', 'limit=abc', 'limit=1001', 'limit=1.5']) {
      const response = await fetch(`${url}/orders?${query}`);
      expect(response.status, query).toBe(400);
      expect(await json(response)).toMatchObject({ error: 'invalid_query' });
    }
  });
});

describe('GET /reports', () => {
  it('is empty before anybody wrote a report', async () => {
    const { url } = await boot();
    expect(await json(await fetch(`${url}/reports`))).toEqual([]);
  });

  it('shows the proposal that waits on the boss desk', async () => {
    const { sim, url } = await bossDesk();
    const reports = (await json(await fetch(`${url}/reports?status=submitted`))) as {
      subject: unknown;
    }[];
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      id: 1,
      type: 'restock',
      status: 'submitted',
      title: expect.stringContaining('Susu') as unknown,
      subject: { items: [{ ingredient_id: 'susu', qty: 5000 }] },
      created_at_sim: FIRST_BOOT_START + 135,
      submitted_at_sim: FIRST_BOOT_START + REPORT_ON_DESK_AT,
      decided_at_sim: null,
    });
    expect(sim.clock.now()).toBeGreaterThan(FIRST_BOOT_START + REPORT_ON_DESK_AT);
  });

  it('filters by status and rejects a status that does not exist', async () => {
    const { url } = await bossDesk();
    expect(await json(await fetch(`${url}/reports?status=approved`))).toEqual([]);
    expect(((await json(await fetch(`${url}/reports`))) as unknown[]).length).toBe(1);
    expect((await fetch(`${url}/reports?status=waiting`)).status).toBe(400);
  });
});

describe('POST /reports/:id/decision', () => {
  it('approves the report: the boss decision is written and the stock admin places the order', async () => {
    const { db, sim, url } = await bossDesk();
    const response = await decide(url, 1, { decision: 'approved' });
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ id: 1, status: 'approved' });

    const decided = listEvents(db).find((event) => event.type === 'report_decided');
    expect(decided).toMatchObject({
      actor: 'boss',
      origin: 'boss',
      payload: { report_id: 1, decision: 'approved' },
    });
    // The reaction happened in the same step: she is already walking or placing the order.
    expect(db.prepare('SELECT status FROM reports WHERE id = 1').pluck().get()).toBe('approved');

    runTo(sim, REPORT_ON_DESK_AT + 1 + 3 * 3600);
    const stock = (await json(await fetch(`${url}/stock`))) as {
      ingredient_id: string;
      qty: number;
    }[];
    expect(stock.find((row) => row.ingredient_id === 'susu')?.qty).toBeGreaterThan(5000);
  });

  it('rejects the report: nothing is ordered', async () => {
    const { db, url } = await bossDesk();
    const response = await decide(url, 1, { decision: 'rejected' });
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ status: 'rejected' });
    expect(listEvents(db).some((event) => event.type === 'restock_ordered')).toBe(false);
  });

  it('answers 404 for a report that does not exist, and for an id that is no number', async () => {
    const { url } = await bossDesk();
    const missing = await decide(url, 99, { decision: 'approved' });
    expect(missing.status).toBe(404);
    expect(await json(missing)).toMatchObject({ error: 'report_not_found' });
    expect((await decide(url, 'abc', { decision: 'approved' })).status).toBe(404);
  });

  it('answers 409 when the report was decided already, and does not write a second event', async () => {
    const { db, url } = await bossDesk();
    await decide(url, 1, { decision: 'approved' });
    const again = await decide(url, 1, { decision: 'rejected' });
    expect(again.status).toBe(409);
    expect(await json(again)).toMatchObject({ error: 'report_not_submitted' });
    expect(listEvents(db).filter((event) => event.type === 'report_decided')).toHaveLength(1);
  });

  it('answers 409 for a report that has not reached the boss desk yet', async () => {
    const { sim, url } = await boot();
    cups(sim, 10);
    runTo(sim, 45 + 90 + 20); // the proposal is written but the admin is still walking
    expect((await json(await fetch(`${url}/reports?status=drafted`))) as unknown[]).toHaveLength(1);
    expect((await decide(url, 1, { decision: 'approved' })).status).toBe(409);
  });

  it('answers 400 for broken JSON and for a decision that is not allowed', async () => {
    const { url } = await bossDesk();
    expect((await decide(url, 1, '{nope')).status).toBe(400);
    for (const body of [{}, { decision: 'maybe' }, { decision: 1 }]) {
      const response = await decide(url, 1, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await json(response)).toMatchObject({ error: 'invalid_body' });
    }
  });

  it('only accepts POST on the decision path', async () => {
    const { url } = await bossDesk();
    const response = await fetch(`${url}/reports/1/decision`);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect((await fetch(`${url}/reports/1`)).status).toBe(404);
  });
});

describe('a complaint report through the API', () => {
  it('lets the boss give the compensation the cashier suggested', async () => {
    const world = await boot(
      makeScenario(42, { crowdPct: 0, complaintChancePct: 100, complaintWaitSec: 2700 }),
    );
    createOrder(world.sim.ctx, { items: [{ menu_item_id: 'nasi_goreng', qty: 10 }] });
    const handedIn = 2700 + 60 + walkDurationSec('cashier', 'boss_desk') + 60;
    runTo(world.sim, handedIn + 1);
    const [report] = (await json(await fetch(`${world.url}/reports?status=submitted`))) as {
      id: number;
      type: string;
      subject: unknown;
    }[];
    expect(report).toMatchObject({ type: 'complaint', subject: { complaint_id: 1 } });

    await decide(world.url, report?.id ?? 0, { decision: 'approved' });
    runTo(world.sim, handedIn + 1 + 400);
    const replied = listEvents(world.db).find((event) => event.type === 'complaint_replied');
    expect(replied?.payload).toMatchObject({ compensation: 'discount_10' });
  });
});
