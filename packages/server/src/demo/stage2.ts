import { isDeepStrictEqual } from 'node:util';
import { SECONDS_PER_DAY, formatClock, makeScenario, simTime, type StoredEvent } from '@cafe/core';
import { openSeededMemoryDb } from '../db/memory';
import { EventBus } from '../events/bus';
import { listEvents } from '../events/store';
import { formatEvent } from '../log/terminal-log';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import { bootSimulation } from '../sim/simulation';

export interface Stage2Result {
  events: StoredEvent[];
  counts: Record<string, number>;
  replayOk: boolean;
  restartOk: boolean;
}

/** Where the "server" is switched off and on again in the restart check: 12:07:30 on day 0. */
const RESTART_AT = simTime(0, 12, 7) + 30;

/**
 * Stage 2 in one run, in memory: one whole virtual day plays out by itself (opening, orders, regulars
 * expected, complaints, closing) and every event is printed. Two checks follow:
 * - Replay check: the state rebuilt from the log equals the live state.
 * - Restart check: the same day, but with a restart in the middle, gives an identical log.
 */
export function runStage2Demo(
  options: { log?: (line: string) => void; seed?: number } = {},
): Stage2Result {
  const log = options.log ?? ((line: string) => console.log(line));
  const scenario = makeScenario(options.seed ?? 42);

  log(`=== Demo Tahap 2: satu hari kafe berjalan sendiri (seed ${scenario.seed}) ===`);

  // Run A: the day in one go, with every event printed as it happens.
  const db = openSeededMemoryDb();
  const bus = new EventBus();
  bus.subscribe((batch) => {
    for (const event of batch) {
      const line = formatEvent(event);
      if (line !== null) log(line);
    }
  });
  const simulation = bootSimulation({ db, bus, scenario, agents: false });
  simulation.clock.advance(SECONDS_PER_DAY - simulation.clock.now());
  const events = listEvents(db);

  const counts: Record<string, number> = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;

  log('--- Ringkasan satu hari ---');
  log(
    `Jumlah event: ${events.length} (${Object.entries(counts)
      .map(([type, count]) => `${type}=${count}`)
      .join(', ')})`,
  );
  log('Pesanan per jam:');
  const perHour = new Array<number>(24).fill(0);
  for (const event of events) {
    if (event.type === 'order_created') {
      const hour = Math.floor((event.sim_time % SECONDS_PER_DAY) / 3600);
      perHour[hour] = (perHour[hour] ?? 0) + 1;
    }
  }
  perHour.forEach((count, hour) => {
    if (count === 0) return;
    const from = formatClock(hour * 3600);
    log(`  ${from}  ${'#'.repeat(count).padEnd(16)} ${count}`);
  });
  log(
    `Komplain: ${counts.complaint_received ?? 0} dari ${counts.order_created ?? 0} pesanan ` +
      '(pesanan menumpuk karena belum ada yang memasak, itu baru ada di Tahap 3)',
  );

  // Replay check: rebuild the projections from the log and compare with the live state.
  const live = snapshotProjections(db);
  rebuildProjections(db);
  const replayOk = isDeepStrictEqual(live, snapshotProjections(db));

  // Restart check: the same day with the server restarted halfway.
  const restartDb = openSeededMemoryDb();
  const before = bootSimulation({ db: restartDb, scenario, agents: false });
  before.clock.advance(RESTART_AT - before.clock.now());
  const after = bootSimulation({ db: restartDb, scenario, agents: false }); // the "restart": a new simulation on the same database
  after.clock.advance(SECONDS_PER_DAY - after.clock.now());
  const restartOk = after.recovered && isDeepStrictEqual(listEvents(restartDb), events);

  log(
    replayOk
      ? 'Replay check: OK (state hasil replay dari log sama dengan state live)'
      : 'Replay check: GAGAL (state hasil replay berbeda dari state live)',
  );
  log(
    restartOk
      ? `Restart check: OK (restart pukul ${formatClock(RESTART_AT)} memberi log yang identik)`
      : `Restart check: GAGAL (restart pukul ${formatClock(RESTART_AT)} memberi log yang berbeda)`,
  );

  return { events, counts, replayOk, restartOk };
}
