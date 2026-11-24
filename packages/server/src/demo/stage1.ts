import { isDeepStrictEqual } from 'node:util';
import type { StoredEvent } from '@cafe/core';
import { ManualClock } from '../clock/manual-clock';
import { openDatabase } from '../db/database';
import { loadMigrations, runMigrations } from '../db/migrate';
import { readStock } from '../db/queries';
import { seedReferenceData } from '../db/seed';
import { startApiServer } from '../http/api';
import { formatEvent } from '../log/terminal-log';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import type { Context } from '../usecases/context';
import { completeCooking, startCooking } from '../usecases/cooking';
import { initializeWorld } from '../usecases/world';

export interface Stage1Result {
  events: StoredEvent[];
  counts: Record<string, number>;
  replayOk: boolean;
}

/**
 * Stage 1 in one run, on an in-memory database so it can be repeated. Orders come in through the HTTP
 * API; a script plays the cook (there are no characters before stage 3) and moves the manual clock.
 * Every committed event is printed as a log line, and at the end the state is rebuilt from the log
 * and compared with the live state.
 */
export async function runStage1Demo(
  options: { log?: (line: string) => void } = {},
): Promise<Stage1Result> {
  const log = options.log ?? console.log;

  const db = openDatabase(':memory:');
  runMigrations(db, loadMigrations());
  seedReferenceData(db);

  const clock = new ManualClock();
  const events: StoredEvent[] = [];
  const ctx: Context = {
    db,
    clock,
    publish: (batch) => {
      for (const event of batch) {
        events.push(event);
        const line = formatEvent(event);
        if (line !== null) log(line);
      }
    },
  };

  log('=== Demo Tahap 1: pesanan masuk, stok turun, stock_low ===');
  initializeWorld(ctx, { seed: 42 });

  const api = await startApiServer(ctx);
  try {
    const menu = (await getJson(api.url, '/menu')) as unknown[];
    const stock = (await getJson(api.url, '/stock')) as unknown[];
    log(`API: GET /menu -> ${menu.length} menu, GET /stock -> ${stock.length} bahan`);

    log('--- Fase A: 11 kopi susu (susu 2500 ml, batas 1000 ml, 150 ml per cangkir) ---');
    for (let cup = 1; cup <= 11; cup += 1) {
      clock.advance(60);
      cook(ctx, await postOrder(api.url, 'kopi_susu', 1));
    }

    log('--- Fase B: 20 nasi goreng sekaligus (nasi habis, telur turun ke batas) ---');
    clock.advance(60);
    cook(ctx, await postOrder(api.url, 'nasi_goreng', 20));

    log('--- Fase C: 1 nasi goreng lagi (nasi sudah habis, pesanan ditahan) ---');
    clock.advance(60);
    cook(ctx, await postOrder(api.url, 'nasi_goreng', 1));
  } finally {
    await api.close();
  }

  const live = snapshotProjections(db);
  rebuildProjections(db);
  const replayOk = isDeepStrictEqual(live, snapshotProjections(db));

  const counts: Record<string, number> = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;

  log('--- Ringkasan ---');
  log(
    `Jumlah event: ${events.length} (${Object.entries(counts)
      .map(([type, count]) => `${type}=${count}`)
      .join(', ')})`,
  );
  const lows = events
    .filter((event) => event.type === 'stock_low')
    .map((event) => (event.payload as { ingredient_id: string }).ingredient_id);
  log(`stock_low muncul untuk: ${lows.join(', ')} (masing-masing sekali)`);
  const finalStock = readStock(db)
    .filter((row) => ['susu', 'nasi', 'telur'].includes(row.ingredient_id))
    .map((row) => `${row.ingredient_id}=${row.qty}${row.unit}`);
  log(`Stok akhir: ${finalStock.join(', ')}`);
  log(
    replayOk
      ? 'Replay check: OK (state hasil replay dari log sama dengan state live)'
      : 'Replay check: GAGAL (state hasil replay berbeda dari state live)',
  );

  return { events, counts, replayOk };
}

/** Plays the cook: start the order and, when it is cooking, wait for the cooking time and finish it. */
function cook(ctx: Context, orderId: number): void {
  const result = startCooking(ctx, orderId);
  if (result.held) return;
  ctx.clock.advance(result.duration_sim_sec);
  completeCooking(ctx, orderId);
}

async function getJson(baseUrl: string, path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`GET ${path} failed with ${response.status}`);
  return response.json();
}

async function postOrder(baseUrl: string, menu_item_id: string, qty: number): Promise<number> {
  const response = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ menu_item_id, qty }] }),
  });
  if (response.status !== 201) throw new Error(`POST /orders failed with ${response.status}`);
  return ((await response.json()) as { order_id: number }).order_id;
}
