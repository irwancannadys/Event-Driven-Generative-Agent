import { dayOf, formatClock } from '@cafe/core';
import type { Config } from './config';
import { openDatabase } from './db/database';
import { loadMigrations, runMigrations } from './db/migrate';
import { seedReferenceData } from './db/seed';
import { EventBus } from './events/bus';
import { startApiServer } from './http/api';
import { formatEvent } from './log/terminal-log';
import { saveClockState } from './sim/clock-state';
import { Pacer } from './sim/pacer';
import { bootSimulation, type Simulation } from './sim/simulation';
import { createTimeControl } from './sim/time-control';

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

  const bus = new EventBus();
  bus.subscribe((events) => {
    for (const event of events) {
      const line = formatEvent(event);
      if (line !== null) log(line);
    }
  });

  const simulation = bootSimulation({ db, bus, scenario: config.scenario });
  const pacer = new Pacer(simulation.clock, { speed: config.speed, tickMs: options.tickMs });
  const api = await startApiServer(simulation.ctx, {
    port: config.port,
    time: createTimeControl(simulation, pacer),
  });

  const now = simulation.clock.now();
  const where = `jam ${formatClock(now)}, hari ${dayOf(now)}`;
  log('=== Server kafe virtual ===');
  log(`Database : ${config.databasePath}`);
  log(`API      : ${api.url}  (GET /time /menu /stock, POST /orders /time)`);
  log(`Kecepatan: ${pacer.speed}x (1 detik asli = ${pacer.speed} detik virtual)`);
  log(
    simulation.recovered
      ? `Dunia dipulihkan dari log: ${simulation.replayedEvents} event dibaca ulang, ${where}, seed ${simulation.scenario.seed}`
      : `Dunia baru dibuat: ${where}, seed ${simulation.scenario.seed}`,
  );
  log('Tekan Ctrl+C untuk berhenti. Jam virtual disimpan saat berhenti.');

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
      await api.close();
      saveClock();
      db.close();
    },
  };
}
