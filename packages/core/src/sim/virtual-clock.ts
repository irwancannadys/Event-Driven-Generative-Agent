import type { SimClock } from '../clock';
import type { SimTime } from '../time';

/**
 * The virtual clock of the cafe (decision 020). It owns the current virtual time and, whenever time
 * moves, walks through every item that falls due on the way, in order:
 *
 *   advance(seconds):  for each item due in (now, now + seconds]:  now := item.time; handle(item)
 *
 * While `handle` runs, `now()` is the time of the item, so everything written during it is stamped
 * with the right time. Because `due` is a pure function of absolute time, cutting one `advance` into
 * smaller ones (30 x 60 s instead of 1800 s) gives exactly the same items in the same order.
 *
 * If `handle` throws, the clock goes back to the time of the last item that was handled and the error
 * propagates, so the failed item is still due on the next `advance`.
 */
export class VirtualClock<T extends { time: SimTime }> implements SimClock {
  private time: SimTime;

  constructor(
    start: SimTime,
    private readonly due: (after: SimTime, upTo: SimTime) => T[],
    private readonly handle: (item: T) => void,
  ) {
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
    const target = this.time + seconds;
    for (const item of this.due(this.time, target)) {
      const before = this.time;
      this.time = item.time;
      try {
        this.handle(item);
      } catch (error) {
        this.time = before;
        throw error;
      }
    }
    this.time = target;
  }
}

function assertTime(time: number): void {
  if (!Number.isInteger(time) || time < 0) {
    throw new Error(`time must be a non-negative integer number of seconds, got ${time}`);
  }
}
