import { REGULARS } from '../seed-data';
import type { TableId } from '../ids';
import type { OrderItem } from '../schema-parts';
import {
  CLOSE_TIME_SEC,
  OPEN_TIME_SEC,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  dayOf,
  type SimTime,
} from '../time';
import { pickWeighted, rand, randInt } from './rng';
import {
  MENU_WEIGHTS,
  REGULAR_LEAD_SEC,
  SLOT_SEC,
  arrivalsPerHour,
  type Scenario,
} from './scenario';

// Everything that is "due" at a certain time, computed as a pure function of the seed and the time
// (decision 020). Nothing is remembered between calls, so asking for the same window again, or for the
// same time span cut into pieces, always gives the same answer.

export type DueItem =
  | { kind: 'day_opened'; time: SimTime; day: number }
  | { kind: 'day_closed'; time: SimTime; day: number }
  | {
      kind: 'regular_expected';
      time: SimTime;
      regular_id: string;
      table_id: TableId;
      expected_at: SimTime;
    }
  | { kind: 'order_arrival'; time: SimTime; items: OrderItem[] }
  | { kind: 'complaint_check'; time: SimTime };

/** What goes first when two items are due in the same second. */
const PRIORITY: Record<DueItem['kind'], number> = {
  day_opened: 0,
  regular_expected: 1,
  order_arrival: 2,
  complaint_check: 3,
  day_closed: 4,
};

/** All items due in the window (after, upTo], ordered by time and then by priority. */
export function dueItems(after: SimTime, upTo: SimTime, scenario: Scenario): DueItem[] {
  if (upTo <= after) return [];
  const items: DueItem[] = [];
  for (let day = Math.max(0, dayOf(after)); day <= dayOf(upTo); day += 1) {
    collectDay(day * SECONDS_PER_DAY, day, after, upTo, scenario, items);
  }
  return items.sort((a, b) => a.time - b.time || PRIORITY[a.kind] - PRIORITY[b.kind]);
}

function inWindow(time: SimTime, after: SimTime, upTo: SimTime): boolean {
  return time > after && time <= upTo;
}

function collectDay(
  base: SimTime,
  day: number,
  after: SimTime,
  upTo: SimTime,
  scenario: Scenario,
  out: DueItem[],
): void {
  const opens = base + OPEN_TIME_SEC;
  const closes = base + CLOSE_TIME_SEC;

  if (inWindow(opens, after, upTo)) out.push({ kind: 'day_opened', time: opens, day });
  if (inWindow(closes, after, upTo)) out.push({ kind: 'day_closed', time: closes, day });

  for (const regular of REGULARS) {
    const time = base + regular.usual_time_sec - REGULAR_LEAD_SEC;
    if (inWindow(time, after, upTo)) {
      out.push({
        kind: 'regular_expected',
        time,
        regular_id: regular.id,
        table_id: regular.favorite_table,
        expected_at: base + regular.usual_time_sec,
      });
    }
  }

  // Complaint checks beat once per slot while the cafe is open (after opening, up to and including closing).
  const firstTick = Math.max(opens + SLOT_SEC, (Math.floor(after / SLOT_SEC) + 1) * SLOT_SEC);
  for (let time = firstTick; time <= Math.min(closes, upTo); time += SLOT_SEC) {
    out.push({ kind: 'complaint_check', time });
  }

  // Orders: every one-minute slot of the opening hours gets its own draws. An arrival lands somewhere
  // in the slot, so only slots that overlap the window can contribute.
  const firstSlot = Math.max(opens, Math.floor((after - (SLOT_SEC - 1)) / SLOT_SEC) * SLOT_SEC);
  const lastSlot = Math.min(closes - SLOT_SEC, Math.floor(upTo / SLOT_SEC) * SLOT_SEC);
  for (let slot = firstSlot; slot <= lastSlot; slot += SLOT_SEC) {
    collectArrivals(slot, after, upTo, scenario, out);
  }
}

function collectArrivals(
  slot: SimTime,
  after: SimTime,
  upTo: SimTime,
  scenario: Scenario,
  out: DueItem[],
): void {
  const hour = Math.floor((slot % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const expected = (arrivalsPerHour(hour) * scenario.crowdPct) / 100 / SLOT_SEC;
  const whole = Math.floor(expected);
  const arrivals = whole + (rand(scenario.seed, `arrival@${slot}`) < expected - whole ? 1 : 0);
  for (let n = 0; n < arrivals; n += 1) {
    const tag = `${slot}#${n}`;
    const time = slot + randInt(scenario.seed, `arrival_sec@${tag}`, SLOT_SEC);
    if (inWindow(time, after, upTo)) {
      out.push({ kind: 'order_arrival', time, items: chooseItems(scenario.seed, tag) });
    }
  }
}

const LINE_COUNTS = [
  { value: 1, weight: 70 },
  { value: 2, weight: 25 },
  { value: 3, weight: 5 },
];
const QUANTITIES = [
  { value: 1, weight: 85 },
  { value: 2, weight: 15 },
];

/** One to three different menu items, mostly one portion each. */
function chooseItems(seed: number, tag: string): OrderItem[] {
  const lines = pickWeighted(seed, `lines@${tag}`, LINE_COUNTS);
  let pool = MENU_WEIGHTS.slice();
  const items: OrderItem[] = [];
  for (let line = 0; line < lines; line += 1) {
    const menu_item_id = pickWeighted(seed, `item${line}@${tag}`, pool);
    pool = pool.filter((option) => option.value !== menu_item_id);
    items.push({ menu_item_id, qty: pickWeighted(seed, `qty${line}@${tag}`, QUANTITIES) });
  }
  return items;
}
