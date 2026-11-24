import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { WS_PATH, makeScenario, type ServerMessage } from '@cafe/core';
import { EventBus } from '../events/bus';
import { startApiServer, type RunningApi } from '../http/api';
import { Pacer } from '../sim/pacer';
import { bootSimulation } from '../sim/simulation';
import { createTimeControl } from '../sim/time-control';
import { createTestDb } from '../test-support/world';
import { createOrder } from '../usecases/orders';
import { buildSnapshot } from './snapshot';
import { attachWebSocket, type SocketHub } from './socket';

interface Page {
  socket: WebSocket;
  messages: ServerMessage[];
  /** Waits until a message that fits has arrived (it may have arrived already). */
  waitFor(fits: (message: ServerMessage) => boolean): Promise<ServerMessage>;
}

const pages: Page[] = [];
let api: RunningApi | undefined;
let hub: SocketHub | undefined;

afterEach(async () => {
  for (const page of pages.splice(0)) page.socket.terminate();
  await hub?.close();
  await api?.close();
  hub = undefined;
  api = undefined;
});

async function boot(options: { clockEveryMs?: number } = {}) {
  const db = createTestDb();
  const bus = new EventBus();
  const sim = bootSimulation({ db, bus, scenario: makeScenario(42, { crowdPct: 0 }) });
  const time = createTimeControl(sim, new Pacer(sim.clock));
  api = await startApiServer(sim.ctx, { time });
  hub = attachWebSocket(api.server, {
    bus,
    snapshot: () => buildSnapshot(sim.ctx, time.state()),
    clock: () => time.state(),
    clockEveryMs: options.clockEveryMs ?? 60_000,
  });
  return { sim, url: api.url, hub };
}

function open(url: string, path = WS_PATH): Promise<Page> {
  const socket = new WebSocket(`${url.replace(/^http/, 'ws')}${path}`);
  const messages: ServerMessage[] = [];
  const listeners: (() => void)[] = [];
  socket.on('message', (data) => {
    messages.push(JSON.parse(data.toString()) as ServerMessage);
    for (const listener of [...listeners]) listener();
  });
  const page: Page = {
    socket,
    messages,
    waitFor: (fits) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), 3000);
        const check = (): void => {
          const found = messages.find(fits);
          if (!found) return;
          clearTimeout(timer);
          listeners.splice(listeners.indexOf(check), 1);
          resolve(found);
        };
        listeners.push(check);
        check();
      }),
  };
  pages.push(page);
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(page));
    socket.once('error', reject);
  });
}

const kinds = (page: Page) => page.messages.map((message) => message.kind);
const order = (sim: { ctx: Parameters<typeof createOrder>[0] }) =>
  createOrder(sim.ctx, { items: [{ menu_item_id: 'kopi_susu', qty: 1 }] });

describe('the snapshot on connect', () => {
  it('is the first thing a page receives', async () => {
    const { url } = await boot();
    const page = await open(url);
    const first = await page.waitFor(() => true);
    expect(first.kind).toBe('snapshot');
    if (first.kind !== 'snapshot') return;
    expect(first.snapshot.agents).toHaveLength(4);
    expect(first.snapshot.events.map((event) => event.type)).toEqual(['world_initialized']);
    expect(first.snapshot.last_event_id).toBe(1);
  });
});

describe('the stream of events', () => {
  it('sends the events of one step as one batch, in the order they were written, after the snapshot', async () => {
    const { sim, url } = await boot();
    const page = await open(url);
    await page.waitFor((message) => message.kind === 'snapshot');
    order(sim);
    const batch = await page.waitFor((message) => message.kind === 'events');
    expect(kinds(page)).toEqual(['snapshot', 'events']);
    if (batch.kind !== 'events') return;
    // order_created, the cashier gets the task and starts it, all in one step
    expect(batch.events.map((event) => event.type)).toEqual([
      'order_created',
      'agent_task_assigned',
      'agent_state_changed',
    ]);
    expect(batch.events.map((event) => event.id)).toEqual([2, 3, 4]);
  });

  it('has no gap and no duplicate between the snapshot and the events that follow', async () => {
    const { sim, url } = await boot();
    order(sim);
    order(sim);
    const late = await open(url); // connects in the middle of the story
    const snapshot = await late.waitFor((message) => message.kind === 'snapshot');
    if (snapshot.kind !== 'snapshot') return;
    order(sim);
    order(sim);
    await late.waitFor(
      (message) =>
        message.kind === 'events' &&
        message.events.some((e) => e.type === 'order_created' && e.payload.order_id === 4),
    );
    const ids = late.messages.flatMap((message) =>
      message.kind === 'events' ? message.events.map((event) => event.id) : [],
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0]).toBe(snapshot.snapshot.last_event_id + 1);
    expect(ids).toEqual(ids.map((_, index) => snapshot.snapshot.last_event_id + 1 + index));
  });

  it('gives every page the same events', async () => {
    const { sim, url } = await boot();
    const [one, two] = await Promise.all([open(url), open(url)]);
    await Promise.all([one, two].map((page) => page.waitFor((m) => m.kind === 'snapshot')));
    order(sim);
    await Promise.all([one, two].map((page) => page.waitFor((m) => m.kind === 'events')));
    expect(one.messages.slice(1)).toEqual(two.messages.slice(1));
    expect(hub?.clientCount()).toBe(2);
  });

  it('keeps serving the others when one page disappears without saying goodbye', async () => {
    const { sim, url } = await boot();
    const [gone, stays] = await Promise.all([open(url), open(url)]);
    await Promise.all([gone, stays].map((page) => page.waitFor((m) => m.kind === 'snapshot')));
    gone.socket.terminate();
    order(sim);
    await stays.waitFor((message) => message.kind === 'events');
    expect(kinds(stays)).toEqual(['snapshot', 'events']);
  });
});

describe('the clock', () => {
  it('is sent on its own beat', async () => {
    const { url } = await boot({ clockEveryMs: 20 });
    const page = await open(url);
    const clock = await page.waitFor((message) => message.kind === 'clock');
    if (clock.kind !== 'clock') return;
    expect(clock.time).toMatchObject({ clock: '07:50', day: 0, speed: 60, paused: false });
  });

  it('is sent at once when asked, for example after the boss changed the speed', async () => {
    const { hub: running, url } = await boot(); // the beat is a minute: only the request can send it
    const page = await open(url);
    await page.waitFor((message) => message.kind === 'snapshot');
    running.broadcastClock();
    await page.waitFor((message) => message.kind === 'clock');
    expect(kinds(page)).toEqual(['snapshot', 'clock']);
  });
});

describe('the connection itself', () => {
  it('refuses any other path, and the HTTP API next to it keeps working', async () => {
    const { url } = await boot();
    await expect(open(url, '/elsewhere')).rejects.toThrow(/404/);
    expect((await fetch(`${url}/menu`)).status).toBe(200);
  });

  it('is closed for every page when the hub closes, and closing twice is fine', async () => {
    const { url, hub: running } = await boot();
    const page = await open(url);
    await page.waitFor((message) => message.kind === 'snapshot');
    const closed = new Promise<void>((resolve) => page.socket.once('close', () => resolve()));
    await running.close();
    await running.close();
    await closed;
    expect(running.clientCount()).toBe(0);
  });
});
