import type { SimTime } from './time';

/**
 * Deterministic virtual clock (specification only, implemented in stage 2).
 *
 * - `now()` is the current virtual time in integer seconds.
 * - `advance(seconds)` moves time forward and must process every scheduled item that falls inside the
 *   interval, in order, no matter how the interval is split into ticks: `advance(1800)` gives the same
 *   events as thirty `advance(60)` calls.
 * - It never reads the real clock.
 *
 * Real-time pacing (pause, speed) belongs to the server, which decides how often to call `advance`.
 * Speed and pause are not events. Only an explicit jump from the boss is (`sim_time_advanced`).
 */
export interface SimClock {
  now(): SimTime;
  advance(seconds: number): void;
}
