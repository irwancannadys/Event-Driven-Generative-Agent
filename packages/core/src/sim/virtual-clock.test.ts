import { describe, expect, it } from 'vitest';
import { makeScenario } from './scenario';
import { dueItems, type DueItem } from './schedule';
import { VirtualClock } from './virtual-clock';
import { SECONDS_PER_DAY, simTime } from '../time';

interface Tick {
  time: number;
  label: string;
}

/** A tiny timetable for tests: the items that are due, with a label. */
function timetable(...entries: [number, string][]): (after: number, upTo: number) => Tick[] {
  return (after, upTo) =>
    entries
      .filter(([time]) => time > after && time <= upTo)
      .map(([time, label]) => ({ time, label }));
}

describe('VirtualClock', () => {
  it('starts at the given time and moves to the target even when nothing is due', () => {
    const clock = new VirtualClock(
      1000,
      () => [],
      () => undefined,
    );
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
    clock.advance(0);
    expect(clock.now()).toBe(1500);
  });

  it('handles due items in order, with now() set to the time of each item', () => {
    const seen: { label: string; now: number }[] = [];
    // `due` must return items sorted by time, like the real schedule does.
    const clock: VirtualClock<Tick> = new VirtualClock(
      0,
      timetable([10, 'a'], [20, 'b'], [30, 'c']),
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
      () => [
        { time: 5, label: 'first' },
        { time: 5, label: 'second' },
        { time: 5, label: 'third' },
      ],
      (item) => handled.push(item.label),
    );
    clock.advance(10);
    expect(handled).toEqual(['first', 'second', 'third']);
  });

  it('rejects amounts that are negative or not whole seconds', () => {
    const clock = new VirtualClock(
      0,
      () => [],
      () => undefined,
    );
    expect(() => clock.advance(-1)).toThrow(/non-negative integer/);
    expect(() => clock.advance(1.5)).toThrow(/non-negative integer/);
    expect(() => clock.advance(Number.NaN)).toThrow(/non-negative integer/);
    expect(
      () =>
        new VirtualClock(
          -1,
          () => [],
          () => undefined,
        ),
    ).toThrow(/non-negative integer/);
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

describe('VirtualClock with the real schedule', () => {
  const scenario = makeScenario(42);

  function run(steps: number[]): string[] {
    const log: string[] = [];
    const clock: VirtualClock<DueItem> = new VirtualClock<DueItem>(
      0,
      (after, upTo) => dueItems(after, upTo, scenario),
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
