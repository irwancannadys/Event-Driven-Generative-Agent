import { OPEN_TIME_SEC, type SimClock, type SimTime } from '@cafe/core';

/**
 * A stand-in for the real virtual clock (stage 2): time only moves when the caller says so.
 * Time never goes backwards.
 */
export class ManualClock implements SimClock {
  private time: SimTime;

  constructor(start: SimTime = OPEN_TIME_SEC) {
    assertTime(start);
    this.time = start;
  }

  now(): SimTime {
    return this.time;
  }

  advance(seconds: number): void {
    if (!Number.isInteger(seconds) || seconds < 0) {
      throw new Error(`advance expects a non-negative integer number of seconds, got ${seconds}`);
    }
    this.time += seconds;
  }

  /** Jumps forward to an absolute time. */
  set(time: SimTime): void {
    assertTime(time);
    if (time < this.time) {
      throw new Error(`the clock cannot go back from ${this.time} to ${time}`);
    }
    this.time = time;
  }
}

function assertTime(time: number): void {
  if (!Number.isInteger(time) || time < 0) {
    throw new Error(`time must be a non-negative integer number of seconds, got ${time}`);
  }
}
