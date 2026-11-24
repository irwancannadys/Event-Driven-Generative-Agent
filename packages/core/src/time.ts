/** Integer virtual seconds since day 0 at 00:00. */
export type SimTime = number;

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86400;

/** Seconds since midnight for a wall-clock time, e.g. `timeOfDay(8, 30)` is 08:30. */
export function timeOfDay(hours: number, minutes = 0): number {
  return hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE;
}

/** Virtual time for a given day (0-based) and wall-clock time. */
export function simTime(day: number, hours: number, minutes = 0): SimTime {
  return day * SECONDS_PER_DAY + timeOfDay(hours, minutes);
}

export function dayOf(time: SimTime): number {
  return Math.floor(time / SECONDS_PER_DAY);
}

export function secondsIntoDay(time: SimTime): number {
  return time - dayOf(time) * SECONDS_PER_DAY;
}

/** Wall-clock label such as `08:30`. */
export function formatClock(time: SimTime): string {
  const seconds = secondsIntoDay(time);
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export const OPEN_TIME_SEC = timeOfDay(8);
export const CLOSE_TIME_SEC = timeOfDay(20);
