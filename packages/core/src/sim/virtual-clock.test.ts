import { describe, expect, it } from 'vitest';
import { makeScenario } from './scenario';
import { makeStaticSource, type DueItem } from './schedule';
import { VirtualClock } from './virtual-clock';
import { SECONDS_PER_DAY, simTime } from '../time';

interface Tick {
  time: number;
  label: string;
}

/**
 * A timetable for tests, as a `due` function: it returns the group of items due at the earliest
 * time in (after, upTo], like the real sources do. Items given at the same time keep their order.
 */
function timetable(...entries: [number, string][]): (after: number, upTo: number) => Tick[] {
  return (after, upTo) => {
    const inWindow = entries
      .filter(([time]) => time > after && time <= upTo)
      .sort((a, b) => a[0] - b[0]);
    if (inWindow.length === 0) return [];
    const earliest = (inWindow[0] as [number, string])[0];
    return inWindow.filter(([time]) => time === earliest).map(([time, label]) => ({ time, label }));
  };
}

const noop = () => undefined;

describe('VirtualClock', () => {
  it('starts at the given time and moves to the target even when nothing is due', () => {
    const clock = new VirtualClock(1000, () => [], noop);
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
    clock.advance(0);
    expect(clock.now()).toBe(1500);
  });

  it('handles due items in order, with now() set to the time of each item', () => {
    const seen: { label: string; now: number }[] = [];
    const clock: VirtualClock<Tick> = new VirtualClock(
      0,
      timetable([30, 'c'], [10, 'a'], [20, 'b']),
      (item) => seen.push({ label: item.label, now: clock.now() }),
    );
    clock.advance(100);
    expect(seen).toEqual([
      { label: 'a', now: 10 },
      { label: 'b', now: 20 },
      { label: 'c', now: 30 },
    ]);
    expect(clock.now()).toBe(100); // and it ends at the target, not at the last item
  });

  it('only handles items inside (now, now + seconds]', () => {
    const handled: string[] = [];
    const clock = new VirtualClock<Tick>(
      10,
      timetable([10, 'at start'], [11, 'first'], [20, 'last'], [21, 'after']),
      (item) => handled.push(item.label),
    );
    clock.advance(10);
    expect(handled).toEqual(['first', 'last']);
    clock.advance(1);
    expect(handled).toEqual(['first', 'last', 'after']);
  });

  it('keeps the given order for items due in the same second', () => {
    const handled: string[] = [];
    const clock = new VirtualClock<Tick>(
      0,
      timetable([5, 'first'], [5, 'second'], [5, 'third']),
      (item) => handled.push(item.label),
    );
    clock.advance(10);
    expect(handled).toEqual(['first', 'second', 'third']);
  });

  it('rejects amounts that are negative or not whole seconds', () => {
    const clock = new VirtualClock(0, () => [], noop);
    expect(() => clock.advance(-1)).toThrow(/non-negative integer/);
    expect(() => clock.advance(1.5)).toThrow(/non-negative integer/);
    expect(() => clock.advance(Number.NaN)).toThrow(/non-negative integer/);
    expect(() => new VirtualClock(-1, () => [], noop)).toThrow(/non-negative integer/);
  });

  it('goes back to the last handled item when a handler fails, and retries the failed item', () => {
    let failOnce = true;
    const handled: string[] = [];
    const clock = new VirtualClock<Tick>(0, timetable([10, 'a'], [20, 'b'], [30, 'c']), (item) => {
      if (item.label === 'b' && failOnce) {
        failOnce = false;
        throw new Error('boom');
      }
      handled.push(item.label);
    });
    expect(() => clock.advance(100)).toThrow('boom');
    expect(handled).toEqual(['a']);
    expect(clock.now()).toBe(10);
    clock.advance(100);
    expect(handled).toEqual(['a', 'b', 'c']);
    expect(clock.now()).toBe(110);
  });
});

describe('VirtualClock with items that appear while handling (decision 023)', () => {
  /** A pool of items that handlers can add to, like tasks that end at a time known only once they start. */
  function dynamicPool(initial: [number, string][]) {
    const entries: [number, string][] = [...initial];
    const due = (after: number, upTo: number): Tick[] => timetable(...entries)(after, upTo);
    const remove = (item: Tick) => {
      const index = entries.findIndex(
        ([time, label]) => time === item.time && label === item.label,
      );
      entries.splice(index, 1);
    };
    return { entries, due, remove };
  }

  it('processes an item that a handler adds inside the same advance', () => {
    const pool = dynamicPool([[10, 'start']]);
    const handled: string[] = [];
    const clock = new VirtualClock<Tick>(0, pool.due, (item) => {
      pool.remove(item);
      handled.push(`${item.label}@${item.time}`);
      if (item.label === 'start') pool.entries.push([item.time + 25, 'end']);
    });
    clock.advance(100);
    expect(handled).toEqual(['start@10', 'end@35']);
  });

  it('leaves an item that falls after the target for a later advance', () => {
    const pool = dynamicPool([[10, 'start']]);
    const handled: string[] = [];
    const clock = new VirtualClock<Tick>(0, pool.due, (item) => {
      pool.remove(item);
      handled.push(item.label);
      if (item.label === 'start') pool.entries.push([item.time + 90, 'end']);
    });
    clock.advance(50);
    expect(handled).toEqual(['start']);
    clock.advance(60);
    expect(handled).toEqual(['start', 'end']);
  });

  it('chains several steps: each item adds the next one', () => {
    const pool = dynamicPool([[5, 'step1']]);
    const times: number[] = [];
    const clock = new VirtualClock<Tick>(0, pool.due, (item) => {
      pool.remove(item);
      times.push(item.time);
      if (times.length < 4) pool.entries.push([item.time + 10, `step${times.length + 1}`]);
    });
    clock.advance(1000);
    expect(times).toEqual([5, 15, 25, 35]);
  });

  it('accepts an item that is due right now (an overdue item), as long as it gets resolved', () => {
    const pool = dynamicPool([[100, 'overdue']]);
    const handled: string[] = [];
    // The provider reports an overdue item at the current time, as the server does after a crash.
    const due = (after: number, upTo: number): Tick[] => {
      const overdue = pool.entries.filter(([time]) => time <= after);
      if (overdue.length > 0) return overdue.map(([, label]) => ({ time: after, label }));
      return pool.due(after, upTo);
    };
    const clock = new VirtualClock<Tick>(200, due, (item) => {
      pool.entries.splice(0, pool.entries.length);
      handled.push(`${item.label}@${item.time}`);
    });
    clock.advance(10);
    expect(handled).toEqual(['overdue@200']);
    expect(clock.now()).toBe(210);
  });

  it('gives up with an error when an item is never resolved', () => {
    const clock = new VirtualClock<Tick>(0, (after) => [{ time: after, label: 'stuck' }], noop, {
      maxGroups: 50,
    });
    expect(() => clock.advance(10)).toThrow(/gave up after 50 groups/);
  });

  it('refuses an item outside the window it was asked for', () => {
    const early = new VirtualClock<Tick>(100, () => [{ time: 50, label: 'past' }], noop);
    expect(() => early.advance(10)).toThrow(/outside the window/);
    const late = new VirtualClock<Tick>(0, () => [{ time: 500, label: 'future' }], noop);
    expect(() => late.advance(10)).toThrow(/outside the window/);
  });
});

describe('VirtualClock with the real static schedule', () => {
  const scenario = makeScenario(42);

  function run(steps: number[]): string[] {
    const log: string[] = [];
    const source = makeStaticSource(scenario);
    const clock: VirtualClock<DueItem> = new VirtualClock<DueItem>(
      0,
      (after, upTo) => source(after, upTo),
      (item) => {
        expect(clock.now()).toBe(item.time);
        log.push(`${item.time}:${item.kind}`);
      },
    );
    for (const step of steps) clock.advance(step);
    return log;
  }

  it('gives the same items for 1800 s, 30 x 60 s and 1800 x 1 s', () => {
    const start = simTime(0, 12);
    const warmUp = [start];
    const whole = run([...warmUp, 1800]);
    const minutes = run([...warmUp, ...Array<number>(30).fill(60)]);
    const seconds = run([...warmUp, ...Array<number>(1800).fill(1)]);
    expect(minutes).toEqual(whole);
    expect(seconds).toEqual(whole);
    expect(whole.length).toBeGreaterThan(30);
  });

  it('gives the same items for a whole day in one step and in hourly steps', () => {
    const day = run([SECONDS_PER_DAY]);
    const hourly = run(Array<number>(24).fill(3600));
    expect(hourly).toEqual(day);
    expect(day.filter((entry) => entry.endsWith(':order_arrival')).length).toBeGreaterThan(50);
  });
});
