import { afterEach, describe, expect, it } from 'vitest';
import { makeScenario } from '@cafe/core';
import { startApiServer, type RunningApi } from '../http/api';
import { Pacer } from '../sim/pacer';
import { bootSimulation } from '../sim/simulation';
import { createTimeControl } from '../sim/time-control';
import { createTestDb } from '../test-support/world';
import { createOrder } from '../usecases/orders';
import { fetchDashboard } from './fetch-dashboard';
import { runWatch } from './watch';

let api: RunningApi | undefined;

afterEach(async () => {
  await api?.close();
  api = undefined;
});

async function boot() {
  const db = createTestDb();
  const sim = bootSimulation({ db, scenario: makeScenario(42, { crowdPct: 0 }) });
  api = await startApiServer(sim.ctx, { time: createTimeControl(sim, new Pacer(sim.clock)) });
  return { sim, url: api.url };
}

describe('fetchDashboard', () => {
  it('collects the board from a running server', async () => {
    const { sim, url } = await boot();
    createOrder(sim.ctx, { items: [{ menu_item_id: 'kopi_susu', qty: 1 }] });
    const view = await fetchDashboard(url);
    expect(view.apiUrl).toBe(url);
    expect(view.time.clock).toBe('07:50');
    expect(view.agents.map((agent) => agent.id)).toEqual([
      'cashier',
      'cook',
      'stock_admin',
      'waiter',
    ]);
    expect(view.stock).toHaveLength(8);
    expect(view.orders.placed.map((order) => order.id)).toEqual([1]);
    expect(view.orders.done).toEqual([]);
    expect(view.reports).toEqual([]);
  });

  it('fails when the server does not answer well', async () => {
    const broken = (() => Promise.resolve(new Response('no', { status: 500 }))) as typeof fetch;
    await expect(fetchDashboard('http://x', broken)).rejects.toThrow(/answered 500/);
  });
});

describe('runWatch', () => {
  it('prints the board once and exits with 0', async () => {
    const { url } = await boot();
    const out: string[] = [];
    const code = await runWatch({ apiUrl: url, once: true, write: (text) => out.push(text) });
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("=== Cand's Coffee ===");
    expect(out[0]).toContain('KARAKTER');
    expect(out[0]).not.toContain('\x1b');
  });

  it('clears the screen between boards when it draws on a terminal', async () => {
    const { url } = await boot();
    const out: string[] = [];
    await runWatch({ apiUrl: url, once: true, clear: true, write: (text) => out.push(text) });
    expect(out[0]?.startsWith('\x1b[2J\x1b[H')).toBe(true);
  });

  it('says that the server is not there, and exits with 1 when asked for one board', async () => {
    const { url } = await boot();
    await api?.close();
    api = undefined;
    const out: string[] = [];
    const code = await runWatch({ apiUrl: url, once: true, write: (text) => out.push(text) });
    expect(code).toBe(1);
    expect(out[0]).toContain('Belum bisa menyambung');
    expect(out[0]).toContain('npm run dev');
  });

  it('keeps redrawing until it is stopped', async () => {
    const { url } = await boot();
    const out: string[] = [];
    const stop = new AbortController();
    const running = runWatch({
      apiUrl: url,
      intervalMs: 5,
      signal: stop.signal,
      write: (text) => {
        out.push(text);
        if (out.length === 3) stop.abort();
      },
    });
    expect(await running).toBe(0);
    expect(out).toHaveLength(3);
  });
});
