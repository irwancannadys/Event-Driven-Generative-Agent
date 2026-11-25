import { WS_PATH, dayOf, formatClock } from '@cafe/core';
import type { Config } from './config';
import { openDatabase } from './db/database';
import { loadMigrations, runMigrations } from './db/migrate';
import { seedReferenceData } from './db/seed';
import { EventBus } from './events/bus';
import { startApiServer } from './http/api';
import { makeLlm } from './llm/make-llm';
import { formatEvent } from './log/terminal-log';
import { saveClockState } from './sim/clock-state';
import { Pacer } from './sim/pacer';
import { bootSimulation, type Simulation } from './sim/simulation';
import { createTimeControl, type TimeControl } from './sim/time-control';
import { buildSnapshot } from './ws/snapshot';
import { attachWebSocket } from './ws/socket';

export interface DevServerOptions {
  config: Config;
  /** Where log lines go. Default `console.log`. */
  log?: (line: string) => void;
  /** How often the real-time loop wakes up (ms). Default 200. */
  tickMs?: number;
  /** How often the virtual clock is saved while running (ms). Default 5000. */
  clockSaveMs?: number;
}

export interface DevServer {
  url: string;
  simulation: Simulation;
  pacer: Pacer;
  /** Stops the loop, saves the clock, closes the API and the database. Safe to call twice. */
  stop(): Promise<void>;
}

/**
 * The live server: opens the database, brings the world up (new, or restored from the log), starts
 * the HTTP API and lets the virtual clock run at the configured speed while every event is printed.
 */
export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const { config } = options;
  const log = options.log ?? ((line: string) => console.log(line));

  const db = openDatabase(config.databasePath);
  runMigrations(db, loadMigrations());
  seedReferenceData(db);

  // Events written while the world boots (a new world writes world_initialized) are held back until
  // the banner is printed, so the log reads in a natural order.
  const heldBack: string[] = [];
  let banner = false;
  const bus = new EventBus();
  bus.subscribe((events) => {
    for (const event of events) {
      const line = formatEvent(event);
      if (line === null) continue;
      if (banner) log(line);
      else heldBack.push(line);
    }
  });

  const simulation = bootSimulation({
    db,
    bus,
    scenario: config.scenario,
    llm: makeLlm(config),
  });
  const pacer = new Pacer(simulation.clock, { speed: config.speed, tickMs: options.tickMs });
  // Pages hear about a change of speed or pause right away, not at the next 250 ms tick.
  const baseTime = createTimeControl(simulation, pacer);
  let notifyClock = (): void => undefined;
  const time: TimeControl = {
    state: () => baseTime.state(),
    setSpeed(speed) {
      baseTime.setSpeed(speed);
      notifyClock();
    },
    pause() {
      baseTime.pause();
      notifyClock();
    },
    resume() {
      baseTime.resume();
      notifyClock();
    },
    skip(seconds) {
      baseTime.skip(seconds);
      notifyClock();
    },
  };
  const api = await startApiServer(simulation.ctx, { port: config.port, time });
  const sockets = attachWebSocket(api.server, {
    bus,
    snapshot: () => buildSnapshot(simulation.ctx, time.state()),
    clock: () => time.state(),
  });
  notifyClock = sockets.broadcastClock;

  const now = simulation.clock.now();
  const where = `jam ${formatClock(now)}, hari ${dayOf(now)}`;
  log('=== Server kafe virtual ===');
  log(`Database : ${config.databasePath}`);
  log(
    `API      : ${api.url}  (GET /time /menu /stock /orders /agents /reports, POST /orders /time /reports/:id/decision)`,
  );
  log(
    `Realtime : ${api.url.replace(/^http/, 'ws')}${WS_PATH}  (halaman web: snapshot, event, jam)`,
  );
  log(`Kecepatan: ${pacer.speed}x (1 detik asli = ${pacer.speed} detik virtual)`);
  log(
    `Model    : ${
      config.llmProvider === 'ollama'
        ? `${config.ollama.model} lewat Ollama (${config.ollama.url}), jawaban ditunggu paling lama ${config.ollama.timeoutSec} detik`
        : config.llmProvider === 'fake'
          ? 'FakeLLM (skrip, tanpa model sungguhan)'
          : 'tidak ada, aturan yang memutuskan'
    }`,
  );
  log(
    simulation.recovered
      ? `Dunia dipulihkan dari log: ${simulation.replayedEvents} event dibaca ulang, ${where}, seed ${simulation.scenario.seed}`
      : `Dunia baru dibuat: ${where}, seed ${simulation.scenario.seed}`,
  );
  if (simulation.settledThoughts > 0) {
    log(
      `Pemikiran Admin Stok yang terputus saat server berhenti diselesaikan aturan: ${simulation.settledThoughts}`,
    );
  }
  log('Tekan Ctrl+C untuk berhenti. Jam virtual disimpan saat berhenti.');
  banner = true;
  for (const line of heldBack.splice(0)) log(line);

  const saveClock = (): void => {
    saveClockState(db, {
      current_sim_sec: simulation.clock.now(),
      speed: pacer.speed,
      paused: pacer.paused,
    });
  };
  const saver = setInterval(saveClock, options.clockSaveMs ?? 5000);
  pacer.start();

  let stopped = false;
  return {
    url: api.url,
    simulation,
    pacer,
    async stop() {
      if (stopped) return;
      stopped = true;
      pacer.stop();
      clearInterval(saver);
      // A question the model is still working on is left open: the next boot finishes it (decision 037).
      simulation.thinker?.close();
      await simulation.thinker?.idle();
      await sockets.close();
      await api.close();
      saveClock();
      db.close();
    },
  };
}
