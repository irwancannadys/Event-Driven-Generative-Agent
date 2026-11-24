import { isDeepStrictEqual } from 'node:util';
import {
  DEFAULT_FAKE_SCRIPT,
  FakeLLM,
  dayMetrics,
  formatClock,
  makeScenario,
  simTime,
  type DayMetrics,
  type StoredEvent,
} from '@cafe/core';
import { openSeededMemoryDb } from '../db/memory';
import { readMemories, readStock, type ReportRow } from '../db/queries';
import { EventBus } from '../events/bus';
import { listEvents } from '../events/store';
import { formatEvent } from '../log/terminal-log';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import { bootSimulation } from '../sim/simulation';
import { AutoBoss } from '../test-support/auto-boss';

export interface Stage5Result {
  days: DayMetrics[];
  events: StoredEvent[];
  counts: Record<string, number>;
  replayOk: boolean;
  restartOk: boolean;
}

export interface Stage5Options {
  log?: (line: string) => void;
  seed?: number;
  /** How many whole days to play. Default 4. */
  days?: number;
  /**
   * Whether the cafe learns (decision 034): a model helps the stock admin, she looks ahead twice a day, and the
   * boss approves her proposals of policy. Off: the cafe of stage 3 (the rules alone, the boss refuses every
   * proposal of policy). The two are what the experiment compares.
   */
  learning?: boolean;
}

/** The events that tell the story of the learning, printed as they happen. */
const STORY = new Set([
  'daily_review_created',
  'policy_proposed',
  'policy_changed',
  'memory_created',
  'restock_proposed',
]);

/** Where the "server" is switched off and on again in the restart check: 12:07:30 on day 1. */
const RESTART_AT = simTime(1, 12, 7) + 30;

/** Every restock report is approved. A proposal of policy is approved when the cafe learns, refused when not. */
const bossOf =
  (learning: boolean) =>
  (report: ReportRow): 'approved' | 'rejected' =>
    report.type === 'policy' && !learning ? 'rejected' : 'approved';

function playDays(seed: number, days: number, learning: boolean, until: number, bus?: EventBus) {
  const db = openSeededMemoryDb();
  const scenario = makeScenario(seed, { stockForecast: learning });
  const sim = bootSimulation({
    db,
    bus,
    scenario,
    ...(learning && { llm: new FakeLLM(DEFAULT_FAKE_SCRIPT) }),
  });
  new AutoBoss(sim, { decide: bossOf(learning) }).advanceTo(until);
  return { db, scenario, sim, days };
}

const minutes = (seconds: number) => Math.round(seconds / 60);

/**
 * Stage 5 in one run, in memory: several virtual days of the cafe in which the stock admin looks ahead, reviews
 * every day after closing, proposes a change of policy, and learns whether it helped. The story is printed,
 * then a line per day and two checks:
 * - Replay check: the state rebuilt from the log equals the live state, and the model is not asked again.
 * - Restart check: the same days, with a restart in the middle of day 1, give an identical log.
 */
export function runStage5Demo(options: Stage5Options = {}): Stage5Result {
  const log = options.log ?? ((line: string) => console.log(line));
  const seed = options.seed ?? 42;
  const dayCount = options.days ?? 4;
  const learning = options.learning ?? true;
  const until = dayCount * 86400;

  log(
    `=== Demo Tahap 5: ${dayCount} hari kafe, ${learning ? 'Admin Stok belajar' : 'tanpa belajar (aturan saja)'} (seed ${seed}) ===`,
  );

  const bus = new EventBus();
  bus.subscribe((batch) => {
    for (const event of batch) {
      if (!STORY.has(event.type)) continue;
      const line = formatEvent(event);
      if (line !== null) log(line);
    }
  });
  const { db, scenario } = playDays(seed, dayCount, learning, until, bus);
  const events = listEvents(db);
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;

  log('--- Per hari ---');
  const days: DayMetrics[] = [];
  for (let day = 0; day < dayCount; day += 1) {
    const metrics = dayMetrics(events, day);
    days.push(metrics);
    const out = Object.entries(metrics.stockout_sec)
      .filter(([, seconds]) => seconds >= 60)
      .map(([ingredient, seconds]) => `${ingredient} ${minutes(seconds)} mnt`)
      .join(', ');
    log(
      `Hari ${day}: ${metrics.orders} pesanan, ${metrics.done} selesai, ${metrics.held} kali ditahan, ` +
        `${metrics.complaints} komplain, stok habis: ${out || 'tidak ada'}`,
    );
  }
  const total = days.reduce(
    (sum, day) => ({
      held: sum.held + day.held,
      complaints: sum.complaints + day.complaints,
      out: sum.out + Object.values(day.stockout_sec).reduce((a, b) => a + b, 0),
    }),
    { held: 0, complaints: 0, out: 0 },
  );
  log(
    `Jumlah: ${total.held} kali ditahan, ${total.complaints} komplain, stok habis ${minutes(total.out)} menit`,
  );

  log('--- Kebijakan yang berlaku ---');
  const changed = readStock(db).filter((row) => row.min_qty !== row.base_min_qty);
  log(
    changed.length > 0
      ? changed
          .map(
            (row) =>
              `${row.name}: batas minimum ${row.base_min_qty} jadi ${row.min_qty} ${row.unit}`,
          )
          .join('; ')
      : 'Tidak ada yang berubah dari awal.',
  );
  log('--- Catatan Admin Stok ---');
  for (const note of readMemories(db, 'stock_admin')) {
    log(`[${note.kind}] ${formatClock(note.sim_time)} ${note.text}`);
  }

  // Replay check: rebuild the projections from the log and compare with the live state.
  const live = snapshotProjections(db);
  rebuildProjections(db);
  const replayOk = isDeepStrictEqual(live, snapshotProjections(db));

  // Restart check: the same days, with the server restarted in the middle of day 1.
  const restartDb = openSeededMemoryDb();
  const llm = () => (learning ? new FakeLLM(DEFAULT_FAKE_SCRIPT) : undefined);
  const make = () => bootSimulation({ db: restartDb, scenario, ...(learning && { llm: llm() }) });
  const before = make();
  new AutoBoss(before, { decide: bossOf(learning) }).advanceTo(RESTART_AT);
  const after = make(); // the "restart": a new simulation, and a new model, on the same database
  new AutoBoss(after, { decide: bossOf(learning) }).advanceTo(until);
  const restartOk = after.recovered && isDeepStrictEqual(listEvents(restartDb), events);

  log(
    replayOk
      ? 'Replay check: OK (state hasil replay dari log sama dengan state live)'
      : 'Replay check: GAGAL (state hasil replay berbeda dari state live)',
  );
  log(
    restartOk
      ? `Restart check: OK (restart hari 1 pukul ${formatClock(RESTART_AT)} memberi log yang identik)`
      : `Restart check: GAGAL (restart hari 1 pukul ${formatClock(RESTART_AT)} memberi log yang berbeda)`,
  );
  return { days, events, counts, replayOk, restartOk };
}
