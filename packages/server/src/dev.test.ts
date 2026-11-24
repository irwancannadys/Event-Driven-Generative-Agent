import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from './config';
import { openDatabase } from './db/database';
import { startDevServer, type DevServer } from './dev';
import { listEvents } from './events/store';

const running: DevServer[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const server of running.splice(0)) await server.stop();
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

function tempDatabase(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-dev-'));
  folders.push(folder);
  return path.join(folder, 'cafe.db');
}

async function start(env: Record<string, string>, databasePath = tempDatabase()) {
  const lines: string[] = [];
  const config = parseConfig({ PORT: '0', DATABASE_PATH: databasePath, ...env }, '/repo');
  const server = await startDevServer({ config, log: (line) => lines.push(line), tickMs: 20 });
  running.push(server);
  return { server, lines, databasePath };
}

async function getTime(server: DevServer) {
  return (await (await fetch(`${server.url}/time`)).json()) as {
    sim_time: number;
    clock: string;
    day: number;
    speed: number;
    paused: boolean;
  };
}

async function waitFor(condition: () => Promise<boolean> | boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for the condition');
}

describe('dev server', () => {
  it('creates a new world, serves the API and says what it did', async () => {
    const { server, lines } = await start({ SPEED: '1' });
    const time = await getTime(server);
    expect(time).toMatchObject({ clock: '07:50', day: 0, speed: 1, paused: false });
    expect(lines.join('\n')).toMatch(/Dunia baru dibuat: jam 07:50, hari 0, seed 42/);
    expect(lines.join('\n')).toMatch(/Kecepatan: 1x/);
    expect(lines.some((line) => line.includes('world_initialized'))).toBe(true);
    expect((await fetch(`${server.url}/menu`)).status).toBe(200);
  });

  it('runs at the configured speed', async () => {
    const { server } = await start({ SPEED: '600' });
    expect((await getTime(server)).speed).toBe(600);
    expect(server.pacer.speed).toBe(600);
  });

  it('lets the virtual clock run on its own, and prints what happens', async () => {
    const { server, lines } = await start({ SPEED: '3600' });
    const first = (await getTime(server)).sim_time;
    await waitFor(async () => (await getTime(server)).sim_time >= first + 300);
    // The cafe opens 10 virtual minutes after the start, which is only a fraction of a second at 3600x.
    await waitFor(() => lines.some((line) => line.includes('day_opened')));
  });

  it('stops cleanly: the port is closed afterwards, and stopping twice is fine', async () => {
    const { server } = await start({ SPEED: '1' });
    const url = server.url;
    await server.stop();
    await server.stop();
    await expect(fetch(`${url}/time`)).rejects.toThrow();
  });

  it('restores the world from the log after a restart and continues where it stopped', async () => {
    const databasePath = tempDatabase();
    const first = await start({ SPEED: '1' }, databasePath);
    await fetch(`${first.server.url}/time`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ advance_seconds: 3 * 3600 }),
    });
    const before = await getTime(first.server);
    expect(before.clock).toBe('10:50');
    await first.server.stop();

    const check = openDatabase(databasePath);
    const eventsBefore = listEvents(check);
    check.close();
    expect(eventsBefore.length).toBeGreaterThan(10);

    const second = await start({ SPEED: '1', SEED: '999' }, databasePath);
    const log = second.lines.join('\n');
    expect(log).toContain(`Dunia dipulihkan dari log: ${eventsBefore.length} event dibaca ulang`);
    expect(log).toContain('seed 42'); // the seed of the world, not the SEED of this run
    expect(log).not.toContain('Dunia baru dibuat');

    const after = await getTime(second.server);
    expect(after.sim_time).toBeGreaterThanOrEqual(before.sim_time);
    expect(after.sim_time).toBeLessThan(before.sim_time + 5); // continued, did not jump back to 07:50

    const reopened = openDatabase(databasePath);
    const eventsAfter = listEvents(reopened);
    reopened.close();
    expect(eventsAfter.slice(0, eventsBefore.length)).toEqual(eventsBefore); // nothing duplicated or lost
  });
});
