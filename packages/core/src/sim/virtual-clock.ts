import type { SimClock } from '../clock';
import type { SimTime } from '../time';

const DEFAULT_MAX_GROUPS = 1_000_000;

export interface VirtualClockOptions {
  /** Safety net: the most groups of items one `advance` may process before it gives up. */
  maxGroups?: number;
}

/**
 * The virtual clock of the cafe (decisions 020 and 023). It owns the current virtual time and, whenever
 * time moves, walks through every item that falls due on the way, in order:
 *
 *   advance(seconds):  until nothing is left in (now, target]:
 *                        group := due(now, target)       // the items due at the earliest time
 *                        for each item of the group:  now := item.time; handle(item)
 *
 * `due` returns only the earliest group and is asked again after every group, so items that appear
 * while handling (the end of a task that has just started) are picked up in the same `advance`.
 * While `handle` runs, `now()` is the time of the item, so everything written during it is stamped
 * with the right time. Static items are a pure function of absolute time, and dynamic items are read
 * from the projections, so cutting one `advance` into smaller ones gives exactly the same items in
 * the same order.
 *
 * An item may be due "now" (time equal to the current time, for example a task that is overdue after a
 * crash). It must be gone once handled, or the safety net stops the loop with an error.
 *
 * If `handle` throws, the clock goes back to the time of the last item that was handled and the error
 * propagates, so the failed item is still due on the next `advance`.
 */
export class VirtualClock<T extends { time: SimTime }> implements SimClock {
  private time: SimTime;
  private readonly maxGroups: number;

  constructor(
    start: SimTime,
    private readonly due: (after: SimTime, upTo: SimTime) => T[],
    private readonly handle: (item: T) => void,
    options: VirtualClockOptions = {},
  ) {
    assertTime(start);
    this.time = start;
    this.maxGroups = options.maxGroups ?? DEFAULT_MAX_GROUPS;
  }

  now(): SimTime {
    return this.time;
  }

  advance(seconds: number): void {
    if (!Number.isInteger(seconds) || seconds < 0) {
      throw new Error(`advance expects a non-negative integer number of seconds, got ${seconds}`);
    }
    const target = this.time + seconds;
    for (let groups = 0; ; groups += 1) {
      const group = this.due(this.time, target);
      if (group.length === 0) break;
      if (groups >= this.maxGroups) {
        throw new Error(
          `advance gave up after ${this.maxGroups} groups of items: is an item never resolved?`,
        );
      }
      for (const item of group) {
        if (item.time < this.time || item.time > target) {
          throw new Error(
            `an item is due at ${item.time}, outside the window (${this.time}, ${target}]`,
          );
        }
        const before = this.time;
        this.time = item.time;
        try {
          this.handle(item);
        } catch (error) {
          this.time = before;
          throw error;
        }
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
