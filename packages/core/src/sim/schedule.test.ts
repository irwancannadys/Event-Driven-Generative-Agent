import { describe, expect, it } from 'vitest';
import { SEED_MENU_IDS, makeScenario } from './scenario';
import { dueItems, type DueItem } from './schedule';
import { CLOSE_TIME_SEC, OPEN_TIME_SEC, SECONDS_PER_DAY, formatClock, simTime } from '../time';

const scenario = makeScenario(42);
const oneDay = (s = scenario) => dueItems(0, SECONDS_PER_DAY, s);
const arrivals = (items: DueItem[]) =>
  items.filter(
    (item): item is Extract<DueItem, { kind: 'order_arrival' }> => item.kind === 'order_arrival',
  );

describe('dueItems for one day', () => {
  it('opens at 08:00 and closes at 20:00', () => {
    const items = oneDay();
    expect(items.filter((item) => item.kind === 'day_opened')).toEqual([
      { kind: 'day_opened', time: OPEN_TIME_SEC, day: 0 },
    ]);
    expect(items.filter((item) => item.kind === 'day_closed')).toEqual([
      { kind: 'day_closed', time: CLOSE_TIME_SEC, day: 0 },
    ]);
  });

  it('expects each regular 25 minutes before the usual time', () => {
    const expected = oneDay().filter((item) => item.kind === 'regular_expected');
    expect(
      expected.map(
        (item) =>
          item.kind === 'regular_expected' && [
            formatClock(item.time),
            item.regular_id,
            item.table_id,
            formatClock(item.expected_at),
          ],
      ),
    ).toEqual([
      ['08:05', 'pak_budi', 1, '08:30'],
      ['11:35', 'bu_sari', 2, '12:00'],
      ['16:35', 'mas_joko', 3, '17:00'],
    ]);
  });

  it('checks for complaints once a minute while open (08:01 up to and including 20:00)', () => {
    const checks = oneDay().filter((item) => item.kind === 'complaint_check');
    expect(checks).toHaveLength(720);
    expect(checks[0]?.time).toBe(OPEN_TIME_SEC + 60);
    expect(checks.at(-1)?.time).toBe(CLOSE_TIME_SEC);
  });

  it('only has orders during opening hours, with valid menu items and quantities', () => {
    const orders = arrivals(oneDay());
    expect(orders.length).toBeGreaterThan(50);
    expect(orders.length).toBeLessThan(120);
    for (const order of orders) {
      expect(order.time).toBeGreaterThanOrEqual(OPEN_TIME_SEC);
      expect(order.time).toBeLessThan(CLOSE_TIME_SEC);
      expect(order.items.length).toBeGreaterThanOrEqual(1);
      expect(order.items.length).toBeLessThanOrEqual(3);
      const ids = order.items.map((item) => item.menu_item_id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const item of order.items) {
        expect(SEED_MENU_IDS).toContain(item.menu_item_id);
        expect(item.qty).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('is busier at lunch than in the afternoon, over several seeds', () => {
    let lunch = 0;
    let afternoon = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const order of arrivals(oneDay(makeScenario(seed)))) {
        const hour = Math.floor(order.time / 3600);
        if (hour >= 12 && hour < 14) lunch += 1;
        if (hour >= 14 && hour < 17) afternoon += 1;
      }
    }
    expect(lunch).toBeGreaterThan(afternoon * 1.5);
  });

  it('is ordered by time and then by priority', () => {
    const items = oneDay();
    for (let i = 1; i < items.length; i += 1) {
      expect((items[i - 1] as DueItem).time).toBeLessThanOrEqual((items[i] as DueItem).time);
    }
    // At 20:00 the last complaint check comes before the closing.
    const last = items.slice(-2).map((item) => item.kind);
    expect(last).toEqual(['complaint_check', 'day_closed']);
  });
});

describe('dueItems window rules', () => {
  it('excludes the start of the window and includes its end', () => {
    expect(dueItems(OPEN_TIME_SEC, OPEN_TIME_SEC, scenario)).toEqual([]);
    expect(dueItems(OPEN_TIME_SEC - 1, OPEN_TIME_SEC, scenario)).toEqual([
      { kind: 'day_opened', time: OPEN_TIME_SEC, day: 0 },
    ]);
    expect(
      dueItems(OPEN_TIME_SEC, OPEN_TIME_SEC + 1, scenario).map((item) => item.kind),
    ).not.toContain('day_opened');
  });

  it('returns nothing for an empty or backwards window', () => {
    expect(dueItems(100, 100, scenario)).toEqual([]);
    expect(dueItems(200, 100, scenario)).toEqual([]);
  });

  it('gives the same items however the time span is cut into pieces', () => {
    const whole = dueItems(0, 2 * SECONDS_PER_DAY, scenario);
    const cuts = [
      0,
      28799,
      28800,
      30000,
      30001,
      45000,
      72000,
      72001,
      86400,
      100000,
      150000,
      2 * SECONDS_PER_DAY,
    ];
    const pieces: DueItem[] = [];
    for (let i = 1; i < cuts.length; i += 1) {
      pieces.push(...dueItems(cuts[i - 1] as number, cuts[i] as number, scenario));
    }
    expect(pieces).toEqual(whole);
  });

  it('gives the same items when stepping one second at a time', () => {
    const start = simTime(0, 12);
    const end = start + 600;
    const whole = dueItems(start, end, scenario);
    const stepped: DueItem[] = [];
    for (let time = start; time < end; time += 1)
      stepped.push(...dueItems(time, time + 1, scenario));
    expect(stepped).toEqual(whole);
  });

  it('continues on the next day', () => {
    const items = dueItems(0, 2 * SECONDS_PER_DAY, scenario);
    expect(
      items
        .filter((item) => item.kind === 'day_opened')
        .map((item) => item.kind === 'day_opened' && item.day),
    ).toEqual([0, 1]);
    expect(items.filter((item) => item.kind === 'day_closed')).toHaveLength(2);
    expect(items.filter((item) => item.kind === 'regular_expected')).toHaveLength(6);
  });
});

describe('dueItems and the scenario', () => {
  it('is repeatable for a seed, and different for another seed', () => {
    expect(oneDay()).toEqual(oneDay());
    expect(arrivals(oneDay(makeScenario(7)))).not.toEqual(arrivals(oneDay()));
  });

  it('follows the crowd setting', () => {
    const normal = arrivals(oneDay()).length;
    const double = arrivals(oneDay(makeScenario(42, { crowdPct: 200 }))).length;
    const empty = arrivals(oneDay(makeScenario(42, { crowdPct: 0 }))).length;
    expect(double).toBeGreaterThan(normal * 1.5);
    expect(empty).toBe(0);
  });

  it('can bring several orders in the same minute when it is very busy', () => {
    const rush = arrivals(oneDay(makeScenario(42, { crowdPct: 1000 })));
    const perMinute = new Map<number, number>();
    for (const order of rush) {
      const minute = Math.floor(order.time / 60);
      perMinute.set(minute, (perMinute.get(minute) ?? 0) + 1);
    }
    expect(Math.max(...perMinute.values())).toBeGreaterThan(1);
  });
});
