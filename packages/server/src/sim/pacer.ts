import type { SimClock } from '@cafe/core';

export const MIN_SPEED = 1;
export const MAX_SPEED = 3600;
export const DEFAULT_SPEED = 60;
const DEFAULT_TICK_MS = 200;

export interface PacerOptions {
  /** Virtual seconds per real second, a whole number from 1 to 3600. Default 60. */
  speed?: number;
  paused?: boolean;
  /** How often the real-time loop wakes up. Default 200 ms. */
  tickMs?: number;
  /** Source of real time in milliseconds. Tests replace it. Default `performance.now`. */
  now?: () => number;
}

/**
 * Connects real time to the virtual clock (decision 021). Every tick it works out how many whole
 * virtual seconds have passed (`real seconds x speed`) and calls `clock.advance`. Speed and pause
 * are not events: they only change how often the clock is advanced.
 *
 * The maths is done in whole milli-virtual-seconds, so slow speeds are exact: at speed 1 a 200 ms
 * tick adds nothing, and the fifth tick adds one second, with no floating point drift.
 */
export class Pacer {
  private speedValue: number;
  private pausedValue: boolean;
  private carryMilli = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastRealMs = 0;
  private readonly tickMs: number;
  private readonly now: () => number;

  constructor(
    private readonly clock: SimClock,
    options: PacerOptions = {},
  ) {
    this.speedValue = DEFAULT_SPEED;
    this.pausedValue = options.paused ?? false;
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.now = options.now ?? (() => performance.now());
    if (options.speed !== undefined) this.setSpeed(options.speed);
  }

  get speed(): number {
    return this.speedValue;
  }

  get paused(): boolean {
    return this.pausedValue;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  setSpeed(speed: number): void {
    if (!Number.isInteger(speed) || speed < MIN_SPEED || speed > MAX_SPEED) {
      throw new Error(
        `speed must be a whole number from ${MIN_SPEED} to ${MAX_SPEED}, got ${speed}`,
      );
    }
    this.speedValue = speed;
  }

  pause(): void {
    this.pausedValue = true;
  }

  resume(): void {
    this.pausedValue = false;
  }

  /**
   * Lets `elapsedMs` of real time pass. Returns how many virtual seconds the clock was advanced.
   * Time that passes while paused is not saved up.
   */
  tick(elapsedMs: number): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new Error(`elapsedMs must be a non-negative number, got ${elapsedMs}`);
    }
    if (this.pausedValue) return 0;
    const milli = this.carryMilli + Math.round(elapsedMs) * this.speedValue;
    const seconds = Math.floor(milli / 1000);
    this.carryMilli = milli - seconds * 1000;
    if (seconds > 0) this.clock.advance(seconds);
    return seconds;
  }

  /** Starts the real-time loop. Calling it twice does nothing. */
  start(): void {
    if (this.timer !== undefined) return;
    this.lastRealMs = this.now();
    this.timer = setInterval(() => {
      const nowMs = this.now();
      const elapsed = nowMs - this.lastRealMs;
      this.lastRealMs = nowMs; // also while paused, so resuming does not jump
      this.tick(elapsed);
    }, this.tickMs);
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
