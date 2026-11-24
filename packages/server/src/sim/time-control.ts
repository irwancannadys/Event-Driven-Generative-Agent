import { dayOf, formatClock, type TimeView } from '@cafe/core';
import type { Pacer } from './pacer';
import type { Simulation } from './simulation';

export type { TimeView };

/** What the boss can do with time (the API of stage 2, the control panel of stage 4). */
export interface TimeControl {
  state(): TimeView;
  setSpeed(speed: number): void;
  pause(): void;
  resume(): void;
  /** Jumps forward and records `sim_time_advanced`. Works while paused too. */
  skip(seconds: number): void;
}

export function createTimeControl(simulation: Simulation, pacer: Pacer): TimeControl {
  return {
    state() {
      const now = simulation.clock.now();
      return {
        sim_time: now,
        clock: formatClock(now),
        day: dayOf(now),
        speed: pacer.speed,
        paused: pacer.paused,
      };
    },
    setSpeed: (speed) => pacer.setSpeed(speed),
    pause: () => pacer.pause(),
    resume: () => pacer.resume(),
    skip: (seconds) => simulation.skipTime(seconds),
  };
}
