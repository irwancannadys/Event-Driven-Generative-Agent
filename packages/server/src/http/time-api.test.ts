import { afterEach, describe, expect, it } from 'vitest';
import { OPEN_TIME_SEC, SECONDS_PER_DAY } from '@cafe/core';
import { listEvents } from '../events/store';
import { Pacer } from '../sim/pacer';
import { FIRST_BOOT_START, bootSimulation } from '../sim/simulation';
import { createTimeControl } from '../sim/time-control';
import { createTestDb } from '../test-support/world';
import { makeScenario } from '@cafe/core';
import { startApiServer, type RunningApi } from './api';

let api: RunningApi | undefined;

afterEach(async () => {
  await api?.close();
  api = undefined;
});

async function boot() {
  const db = createTestDb();
  const sim = bootSimulation({ db, scenario: makeScenario(42) });
  const pacer = new Pacer(sim.clock);
  api = await startApiServer(sim.ctx, { time: createTimeControl(sim, pacer) });
  return { db, sim, pacer, url: api.url };
}

function postTime(url: string, body: unknown) {
  return fetch(`${url}/time`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('GET /time', () => {
  it('shows the virtual clock', async () => {
    const { url } = await boot();
    const response = await fetch(`${url}/time`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sim_time: FIRST_BOOT_START,
      clock: '07:50',
      day: 0,
      speed: 60,
      paused: false,
    });
  });

  it('does not exist when the server was started without time controls', async () => {
    const db = createTestDb();
    const sim = bootSimulation({ db, scenario: makeScenario(42) });
    api = await startApiServer(sim.ctx);
    expect((await fetch(`${api.url}/time`)).status).toBe(404);
  });
});

describe('POST /time', () => {
  it('changes the speed', async () => {
    const { url, pacer } = await boot();
    const response = await postTime(url, { speed: 600 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ speed: 600, paused: false });
    expect(pacer.speed).toBe(600);
  });

  it('pauses and resumes', async () => {
    const { url, pacer } = await boot();
    expect(await (await postTime(url, { paused: true })).json()).toMatchObject({ paused: true });
    expect(pacer.paused).toBe(true);
    expect(await (await postTime(url, { paused: false })).json()).toMatchObject({ paused: false });
    expect(pacer.paused).toBe(false);
  });

  it('jumps forward, records the jump as the boss and does not lose the events on the way', async () => {
    const { url, db } = await boot();
    const response = await postTime(url, { advance_seconds: 1800 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sim_time: FIRST_BOOT_START + 1800,
      clock: '08:20',
    });
    const log = listEvents(db);
    expect(log.find((event) => event.type === 'sim_time_advanced')).toMatchObject({
      actor: 'boss',
      origin: 'boss',
      sim_time: FIRST_BOOT_START,
      payload: { from: FIRST_BOOT_START, to: FIRST_BOOT_START + 1800 },
    });
    expect(log.find((event) => event.type === 'day_opened')?.sim_time).toBe(OPEN_TIME_SEC);
    expect(log.filter((event) => event.type === 'order_created').length).toBeGreaterThan(0);
  });

  it('can jump while paused', async () => {
    const { url } = await boot();
    await postTime(url, { paused: true });
    const state = (await (await postTime(url, { advance_seconds: 600 })).json()) as {
      sim_time: number;
      paused: boolean;
    };
    expect(state).toMatchObject({ sim_time: FIRST_BOOT_START + 600, paused: true });
  });

  it('applies several fields at once and answers with the clock afterwards', async () => {
    const { url } = await boot();
    const response = await postTime(url, { speed: 120, paused: true, advance_seconds: 60 });
    expect(await response.json()).toEqual({
      sim_time: FIRST_BOOT_START + 60,
      clock: '07:51',
      day: 0,
      speed: 120,
      paused: true,
    });
  });

  it('rejects an empty request', async () => {
    const { url } = await boot();
    const response = await postTime(url, {});
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string; issues: string[] };
    expect(json.error).toBe('invalid_body');
    expect(json.issues.join(' ')).toMatch(/at least one of speed, paused, advance_seconds/);
  });

  it('rejects values that make no sense and changes nothing', async () => {
    const { url, pacer, sim } = await boot();
    const before = sim.clock.now();
    for (const body of [
      { speed: 0 },
      { speed: 3601 },
      { speed: 1.5 },
      { speed: 'fast' },
      { paused: 'yes' },
      { advance_seconds: 0 },
      { advance_seconds: -5 },
      { advance_seconds: 1.5 },
      { advance_seconds: 8 * SECONDS_PER_DAY },
    ]) {
      const response = await postTime(url, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('invalid_body');
    }
    expect(pacer.speed).toBe(60);
    expect(sim.clock.now()).toBe(before);
  });

  it('rejects broken JSON', async () => {
    const { url } = await boot();
    const response = await postTime(url, '{nope');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_json' });
  });

  it('answers 405 with the allowed methods for a wrong method', async () => {
    const { url } = await boot();
    const response = await fetch(`${url}/time`, { method: 'DELETE' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
  });

  it('leaves the cashier routes working, stamped with the virtual time', async () => {
    const { url, db } = await boot();
    await postTime(url, { advance_seconds: 1200 });
    const response = await fetch(`${url}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ menu_item_id: 'kopi_hitam', qty: 1 }] }),
    });
    expect(response.status).toBe(201);
    const manual = listEvents(db)
      .filter((event) => event.type === 'order_created')
      .at(-1);
    expect(manual?.sim_time).toBe(FIRST_BOOT_START + 1200);
  });
});
