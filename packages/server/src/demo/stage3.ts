import { isDeepStrictEqual } from 'node:util';
import { SECONDS_PER_DAY, formatClock, makeScenario, simTime, type StoredEvent } from '@cafe/core';
import type { Db } from '../db/database';
import { openSeededMemoryDb } from '../db/memory';
import { EventBus } from '../events/bus';
import { listEvents } from '../events/store';
import { formatEvent } from '../log/terminal-log';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import { bootSimulation } from '../sim/simulation';
import { AutoBoss } from '../test-support/auto-boss';
import { decideLikeTheTestBoss } from '../test-support/play-day';

export interface Stage3Result {
  events: StoredEvent[];
  counts: Record<string, number>;
  replayOk: boolean;
  restartOk: boolean;
}

/** Where the "server" is switched off and on again in the restart check: 12:07:30 on day 0. */
const RESTART_AT = simTime(0, 12, 7) + 30;

const rows = (db: Db, sql: string) => db.prepare(sql).all() as Record<string, string | number>[];

/**
 * Stage 3 in one run, in memory: one whole virtual day with the three characters at work and a boss
 * who is played by the computer (he says yes, except to every fourth report). Every event is printed,
 * then a summary and two checks:
 * - Replay check: the state rebuilt from the log equals the live state.
 * - Restart check: the same day, with a restart in the middle, gives an identical log.
 */
export function runStage3Demo(
  options: { log?: (line: string) => void; seed?: number } = {},
): Stage3Result {
  const log = options.log ?? ((line: string) => console.log(line));
  const scenario = makeScenario(options.seed ?? 42);

  log(`=== Demo Tahap 3: satu hari kafe dengan karakter (seed ${scenario.seed}, bos otomatis) ===`);

  // Run A: the day in one go, with every event printed as it happens.
  const db = openSeededMemoryDb();
  const bus = new EventBus();
  bus.subscribe((batch) => {
    for (const event of batch) {
      const line = formatEvent(event);
      if (line !== null) log(line);
    }
  });
  const simulation = bootSimulation({ db, bus, scenario });
  new AutoBoss(simulation, { decide: decideLikeTheTestBoss }).advanceTo(SECONDS_PER_DAY);
  const events = listEvents(db);

  const counts: Record<string, number> = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;

  log('--- Ringkasan satu hari ---');
  log(`Jumlah event: ${events.length}`);
  const orders = Object.fromEntries(
    rows(db, 'SELECT status, COUNT(*) AS n FROM orders GROUP BY status').map((row) => [
      row.status,
      row.n,
    ]),
  );
  const inProgress = Number(orders.placed ?? 0) + Number(orders.cooking ?? 0);
  log(
    `Pesanan: ${counts.order_created ?? 0} masuk, ${orders.done ?? 0} selesai, ` +
      `${orders.held ?? 0} ditahan, ${inProgress} masih diproses ` +
      `(${counts.order_held ?? 0} kali sempat ditahan karena bahan kurang)`,
  );
  const reports = Object.fromEntries(
    rows(db, 'SELECT status, COUNT(*) AS n FROM reports GROUP BY status').map((row) => [
      row.status,
      row.n,
    ]),
  );
  const suppliers = Object.fromEntries(
    rows(db, 'SELECT supplier, COUNT(*) AS n FROM restock_orders GROUP BY supplier').map((row) => [
      row.supplier,
      row.n,
    ]),
  );
  log(
    `Belanja: ${counts.report_submitted ?? 0} laporan ke meja bos ` +
      `(${reports.approved ?? 0} disetujui, ${reports.rejected ?? 0} ditolak, ${reports.submitted ?? 0} menunggu), ` +
      `pemasok tepat waktu ${suppliers.on_time ?? 0}, telat ${suppliers.late ?? 0}, kosong ${suppliers.out ?? 0}`,
  );
  log(
    `Komplain: ${counts.complaint_received ?? 0} masuk, ${counts.complaint_replied ?? 0} dibalas ` +
      `(${rows(db, 'SELECT id FROM complaints WHERE report_id IS NOT NULL').length} lewat bos)`,
  );
  log(
    `Stok akhir: ${rows(db, 'SELECT ingredient_id, qty FROM stock ORDER BY ingredient_id')
      .map((row) => `${row.ingredient_id}=${row.qty}`)
      .join(', ')}`,
  );

  // Replay check: rebuild the projections from the log and compare with the live state.
  const live = snapshotProjections(db);
  rebuildProjections(db);
  const replayOk = isDeepStrictEqual(live, snapshotProjections(db));

  // Restart check: the same day with the server restarted halfway (the boss is restarted too).
  const restartDb = openSeededMemoryDb();
  const before = bootSimulation({ db: restartDb, scenario });
  new AutoBoss(before, { decide: decideLikeTheTestBoss }).advanceTo(RESTART_AT);
  const after = bootSimulation({ db: restartDb, scenario }); // the "restart": a new simulation on the same database
  new AutoBoss(after, { decide: decideLikeTheTestBoss }).advanceTo(SECONDS_PER_DAY);
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
