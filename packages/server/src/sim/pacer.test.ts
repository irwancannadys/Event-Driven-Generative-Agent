import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimClock } from '@cafe/core';
import { DEFAULT_SPEED, MAX_SPEED, Pacer } from './pacer';

class FakeClock implements SimClock {
  time = 0;
  advances: number[] = [];
  now(): number {
    return this.time;
  }
  advance(seconds: number): void {
    this.advances.push(seconds);
    this.time += seconds;
  }
}

describe('Pacer.tick', () => {
  it('advances speed x real seconds: one real second at 60x is 60 virtual seconds', () => {
    const clock = new FakeClock();
    const pacer = new Pacer(clock);
    expect(pacer.speed).toBe(DEFAULT_SPEED);
    expect(pacer.tick(1000)).toBe(60);
    expect(clock.time).toBe(60);
    expect(pacer.tick(200)).toBe(12);
    expect(clock.time).toBe(72);
  });

  it('is exact at slow speeds: at speed 1 the fifth 200 ms tick adds the first second', () => {
    const clock = new FakeClock();
    const pacer = new Pacer(clock, { speed: 1 });
    expect([1, 2, 3, 4].map(() => pacer.tick(200))).toEqual([0, 0, 0, 0]);
    expect(pacer.tick(200)).toBe(1);
    for (let i = 0; i < 995; i += 1) pacer.tick(200);
    expect(clock.time).toBe(200); // 1000 ticks x 200 ms = 200 real seconds at speed 1
  });

  it('carries the leftover of every tick, so nothing is lost at odd speeds', () => {
    const clock = new FakeClock();
    const pacer = new Pacer(clock, { speed: 7 });
    for (let i = 0; i < 20; i += 1) pacer.tick(150); // 20 x 0.15 s x 7 = 21 virtual seconds
    expect(clock.time).toBe(21);
  });

  it('does not call advance when less than a virtual second has passed', () => {
    const clock = new FakeClock();
    const pacer = new Pacer(clock, { speed: 1 });
    pacer.tick(100);
    pacer.tick(0);
    expect(clock.advances).toEqual([]);
  });

  it('does nothing while paused, and does not save that time up', () => {
    const clock = new FakeClock();
    const pacer = new Pacer(clock);
    pacer.pause();
    expect(pacer.paused).toBe(true);
    expect(pacer.tick(5000)).toBe(0);
    expect(clock.time).toBe(0);
    pacer.resume();
    expect(pacer.tick(1000)).toBe(60); // only the second after resuming counts
    expect(clock.time).toBe(60);
  });

  it('can start paused and with a given speed', () => {
    const pacer = new Pacer(new FakeClock(), { speed: 600, paused: true });
    expect(pacer.speed).toBe(600);
    expect(pacer.paused).toBe(true);
  });

  it('applies a new speed from the next tick on', () => {
    const clock = new FakeClock();
    const pacer = new Pacer(clock);
    pacer.tick(1000);
    pacer.setSpeed(600);
    expect(pacer.tick(1000)).toBe(600);
  });

  it('rejects a speed outside 1..3600 or one that is not a whole number', () => {
    const pacer = new Pacer(new FakeClock());
    for (const bad of [0, -1, MAX_SPEED + 1, 1.5, Number.NaN]) {
      expect(() => pacer.setSpeed(bad), String(bad)).toThrow(/whole number from 1 to 3600/);
    }
    pacer.setSpeed(1);
    pacer.setSpeed(MAX_SPEED);
    expect(pacer.speed).toBe(MAX_SPEED);
    expect(() => new Pacer(new FakeClock(), { speed: 0 })).toThrow(/whole number/);
  });

  it('rejects elapsed time that is negative or not a number', () => {
    const pacer = new Pacer(new FakeClock());
    expect(() => pacer.tick(-1)).toThrow(/non-negative/);
    expect(() => pacer.tick(Number.NaN)).toThrow(/non-negative/);
  });
});

describe('Pacer loop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A loop driven by fake timers: each step moves the fake real time and fires the timer. */
  function loop(options: { speed?: number; paused?: boolean } = {}) {
    vi.useFakeTimers();
    let realNow = 1000;
    const clock = new FakeClock();
    const pacer = new Pacer(clock, { ...options, tickMs: 200, now: () => realNow });
    const step = (times = 1) => {
      for (let i = 0; i < times; i += 1) {
        realNow += 200;
        vi.advanceTimersByTime(200);
      }
    };
    return { clock, pacer, step };
  }

  it('advances the clock in step with real time once started', () => {
    const { clock, pacer, step } = loop();
    pacer.start();
    expect(pacer.running).toBe(true);
    step(5); // one real second
    expect(clock.time).toBe(60);
    pacer.stop();
  });

  it('stops advancing after stop', () => {
    const { clock, pacer, step } = loop();
    pacer.start();
    step(5);
    pacer.stop();
    expect(pacer.running).toBe(false);
    step(10);
    expect(clock.time).toBe(60);
  });

  it('starting twice does not run two loops', () => {
    const { clock, pacer, step } = loop();
    pacer.start();
    pacer.start();
    step(5);
    expect(clock.time).toBe(60);
    pacer.stop();
  });

  it('does not jump after being paused for a while', () => {
    const { clock, pacer, step } = loop();
    pacer.start();
    step(5);
    pacer.pause();
    step(50);
    expect(clock.time).toBe(60);
    pacer.resume();
    step(5);
    expect(clock.time).toBe(120);
    pacer.stop();
  });
});
