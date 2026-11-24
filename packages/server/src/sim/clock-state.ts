import type { Db } from '../db/database';

export interface ClockState {
  current_sim_sec: number;
  /** Virtual seconds per real second. */
  speed: number;
  paused: boolean;
}

/** The single `sim_clock` row (runtime settings, not derived from events: decision 021). */
export function readClockState(db: Db): ClockState {
  const row = db
    .prepare('SELECT current_sim_sec, speed, paused FROM sim_clock WHERE id = 1')
    .get() as { current_sim_sec: number; speed: number; paused: number } | undefined;
  if (!row) throw new Error('sim_clock has no row: was the schema migrated?');
  return { current_sim_sec: row.current_sim_sec, speed: row.speed, paused: row.paused === 1 };
}

export function saveClockState(db: Db, state: ClockState): void {
  db.prepare('UPDATE sim_clock SET current_sim_sec = ?, speed = ?, paused = ? WHERE id = 1').run(
    state.current_sim_sec,
    state.speed,
    state.paused ? 1 : 0,
  );
}
