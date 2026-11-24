import { REGULARS } from '../seed-data';
import { WALK_IN_SEC } from '../stations';
import type { AgentId, TableId } from '../ids';
import type { OrderItem } from '../schema-parts';
import {
  CLOSE_TIME_SEC,
  OPEN_TIME_SEC,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  dayOf,
  timeOfDay,
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

/** Items whose time follows from the seed and the clock alone. */
export type StaticDueItem =
  | { kind: 'day_opened'; time: SimTime; day: number }
  | { kind: 'day_closed'; time: SimTime; day: number }
  | {
      kind: 'regular_expected';
      time: SimTime;
      regular_id: string;
      table_id: TableId;
      expected_at: SimTime;
    }
  | { kind: 'customer_arrival'; time: SimTime; customer_id: number }
  | { kind: 'order_arrival'; time: SimTime; customer_id: number; items: OrderItem[] }
  | { kind: 'stock_forecast'; time: SimTime }
  | { kind: 'complaint_check'; time: SimTime };

/**
 * Items whose time is only known while the world runs, so the server reads them from the projections
 * (decision 023): the end of an agent's task and the arrival of a supplier delivery.
 */
export type DynamicDueItem =
  | { kind: 'task_end'; time: SimTime; agent_id: AgentId; task_id: number }
  | { kind: 'restock_arrival'; time: SimTime; restock_id: number };

export type DueItem = StaticDueItem | DynamicDueItem;

/** What goes first when two items are due in the same second. */
const PRIORITY: Record<DueItem['kind'], number> = {
  day_opened: 0,
  regular_expected: 1,
  restock_arrival: 2,
  task_end: 3,
  customer_arrival: 4,
  order_arrival: 5,
  stock_forecast: 6,
  complaint_check: 7,
  day_closed: 8,
};

export function priorityOf(item: DueItem): number {
  return PRIORITY[item.kind];
}

/** The hours of the day at which the stock admin looks ahead: before the lunch rush and in the afternoon. */
export const STOCK_FORECAST_HOURS = [10, 15] as const;

/** All items due in the window (after, upTo], ordered by time and then by priority. */
export function dueItems(after: SimTime, upTo: SimTime, scenario: Scenario): StaticDueItem[] {
  if (upTo <= after) return [];
  const items: StaticDueItem[] = [];
  for (let day = Math.max(0, dayOf(after)); day <= dayOf(upTo); day += 1) {
    collectDay(day * SECONDS_PER_DAY, day, after, upTo, scenario, items);
  }
  return items.sort((a, b) => a.time - b.time || priorityOf(a) - priorityOf(b));
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
  out: StaticDueItem[],
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

  // The stock admin looks ahead twice a day (decision 034), when the hours of the rush still lie before her.
  for (const hour of scenario.stockForecast ? STOCK_FORECAST_HOURS : []) {
    const time = base + timeOfDay(hour);
    if (inWindow(time, after, upTo)) out.push({ kind: 'stock_forecast', time });
  }

  // Complaint checks beat once per slot while the cafe is open (after opening, up to and including closing).
  const firstTick = Math.max(opens + SLOT_SEC, (Math.floor(after / SLOT_SEC) + 1) * SLOT_SEC);
  for (let time = firstTick; time <= Math.min(closes, upTo); time += SLOT_SEC) {
    out.push({ kind: 'complaint_check', time });
  }

  // Customers: every one-minute slot of the opening hours gets its own draws. A customer arrives somewhere
  // in the slot and places its order `WALK_IN_SEC` later, when it has walked to the cashier. Either of the
  // two can fall in the window, so the slots are looked at from `WALK_IN_SEC` further back.
  const firstSlot = Math.max(
    opens,
    Math.floor((after - WALK_IN_SEC - (SLOT_SEC - 1)) / SLOT_SEC) * SLOT_SEC,
  );
  // The last customer comes in early enough to place its order before the cafe closes.
  const lastSlot = Math.min(
    closes - SLOT_SEC - WALK_IN_SEC,
    Math.floor(upTo / SLOT_SEC) * SLOT_SEC,
  );
  for (let slot = firstSlot; slot <= lastSlot; slot += SLOT_SEC) {
    collectArrivals(slot, after, upTo, scenario, out);
  }
}

/**
 * The number of a customer: unique and the same every time, from the slot and the place in the slot
 * (decision 032). It is what ties the arrival at the door to the order at the counter.
 */
export function customerIdOf(slot: SimTime, n: number): number {
  if (n >= CUSTOMERS_PER_SLOT_MAX) throw new RangeError(`customer ${n} in one slot is too many`);
  return (slot / SLOT_SEC) * CUSTOMERS_PER_SLOT_MAX + n;
}

/** More customers than this in one minute of one day cannot be told apart by `customerIdOf`. */
const CUSTOMERS_PER_SLOT_MAX = 100;

function collectArrivals(
  slot: SimTime,
  after: SimTime,
  upTo: SimTime,
  scenario: Scenario,
  out: StaticDueItem[],
): void {
  const hour = Math.floor((slot % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const expected = (arrivalsPerHour(hour) * scenario.crowdPct) / 100 / SLOT_SEC;
  const whole = Math.floor(expected);
  const arrivals = whole + (rand(scenario.seed, `arrival@${slot}`) < expected - whole ? 1 : 0);
  for (let n = 0; n < arrivals; n += 1) {
    const tag = `${slot}#${n}`;
    const time = slot + randInt(scenario.seed, `arrival_sec@${tag}`, SLOT_SEC);
    const customer_id = customerIdOf(slot, n);
    if (inWindow(time, after, upTo)) out.push({ kind: 'customer_arrival', time, customer_id });
    if (inWindow(time + WALK_IN_SEC, after, upTo)) {
      out.push({
        kind: 'order_arrival',
        time: time + WALK_IN_SEC,
        customer_id,
        items: chooseItems(scenario.seed, tag),
      });
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

/**
 * The static items as a source for `VirtualClock`: for a window `(after, upTo]` it returns the group
 * of items due at the earliest time. The items of a whole `advance` are worked out once and cached,
 * so the many calls of one `advance` do not each recompute the same window. A different `upTo`, or an
 * `after` before the cached start, starts a fresh calculation.
 */
export function makeStaticSource(
  scenario: Scenario,
): (after: SimTime, upTo: SimTime) => StaticDueItem[] {
  let cache: { from: SimTime; upTo: SimTime; items: StaticDueItem[] } | undefined;
  return (after, upTo) => {
    if (upTo <= after) return [];
    if (!cache || cache.upTo !== upTo || after < cache.from) {
      cache = { from: after, upTo, items: dueItems(after, upTo, scenario) };
    }
    const { items } = cache;
    let low = 0;
    let high = items.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((items[middle] as StaticDueItem).time > after) high = middle;
      else low = middle + 1;
    }
    if (low >= items.length) return [];
    const time = (items[low] as StaticDueItem).time;
    let end = low;
    while (end < items.length && (items[end] as StaticDueItem).time === time) end += 1;
    return items.slice(low, end);
  };
}
