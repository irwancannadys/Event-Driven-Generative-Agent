import { describe, expect, it } from 'vitest';
import {
  CLOSE_TIME_SEC,
  OPEN_TIME_SEC,
  dayOf,
  formatClock,
  secondsIntoDay,
  simTime,
  timeOfDay,
} from './time';

describe('virtual time helpers', () => {
  it('converts wall-clock time to seconds', () => {
    expect(timeOfDay(8)).toBe(28800);
    expect(timeOfDay(8, 30)).toBe(30600);
    expect(OPEN_TIME_SEC).toBe(28800);
    expect(CLOSE_TIME_SEC).toBe(72000);
  });

  it('splits virtual time into day and time of day', () => {
    expect(dayOf(86399)).toBe(0);
    expect(dayOf(86400)).toBe(1);
    expect(simTime(2, 8, 0)).toBe(2 * 86400 + 28800);
    expect(secondsIntoDay(simTime(2, 17, 5))).toBe(timeOfDay(17, 5));
  });

  it('formats a clock label', () => {
    expect(formatClock(30600)).toBe('08:30');
    expect(formatClock(simTime(3, 17, 5))).toBe('17:05');
    expect(formatClock(0)).toBe('00:00');
  });
});
