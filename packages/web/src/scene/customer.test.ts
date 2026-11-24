import { describe, expect, it } from 'vitest';
import { TASK_DURATION_SEC, WALK_IN_SEC, WALK_SEC_PER_UNIT } from '@cafe/core';
import type { CustomerState } from '../state/world';
import {
  CUSTOMER_SEC_PER_UNIT,
  MAX_VISIBLE_CUSTOMERS,
  PICKUP_HOLD_SEC,
  arrivalPose,
  customerKey,
  customerPose,
  dishesOnCounter,
  pickupTime,
  visibleCustomers,
} from './customer';
import { findPath, pathLength } from './navigation';
import { DOOR, orderSpot, pickupSpot, waitingSpot } from './registry';

const CUSTOMER = 48_300;
const COUNTER = orderSpot(CUSTOMER);
const PICKUP_SPOT = pickupSpot(3);

// The order is placed (at the counter) at T0; the customer came in at the door WALK_IN_SEC before.
const T0 = 10_000;
const RECORDED = T0 + TASK_DURATION_SEC.recording_order;
const customer = (overrides: Partial<CustomerState> = {}): CustomerState => ({
  orderId: 3,
  customerId: CUSTOMER,
  source: 'walk_in',
  status: 'cooking',
  createdAt: T0,
  recordedAt: RECORDED,
  doneAt: null,
  complaint: 'none',
  ...overrides,
});
/** An order the cashier has not written down yet: the customer waits at the counter. */
const unrecorded = (overrides: Partial<CustomerState> = {}) =>
  customer({ status: 'placed', recordedAt: null, ...overrides });

const secondsBetween = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  pathLength(findPath(a, b)) * CUSTOMER_SEC_PER_UNIT;

const spot = waitingSpot(3);
const SETTLED = RECORDED + secondsBetween(COUNTER, spot);

describe('the walk in at the door, which takes as long as the domain says', () => {
  it('is as long as the route in the cafe says (the domain keeps its own number)', () => {
    // `WALK_IN_SEC` is a number of the domain; the layout must stay near it, or the customers would have
    // to walk faster or slower than the staff to be at the counter on time.
    for (let minute = 480; minute < 540; minute += 1) {
      for (const n of [0, 1, 2]) {
        const seconds = pathLength(findPath(DOOR, orderSpot(minute * 100 + n))) * WALK_SEC_PER_UNIT;
        expect(Math.abs(seconds - WALK_IN_SEC)).toBeLessThanOrEqual(WALK_IN_SEC * 0.1);
      }
    }
  });

  it('is not there before it comes in at the door, and starts at the door', () => {
    expect(customerPose(customer(), T0 - WALK_IN_SEC - 1).visible).toBe(false);
    expect(customerPose(customer(), T0 - WALK_IN_SEC)).toMatchObject({
      visible: true,
      x: DOOR.x,
      z: DOOR.z,
      moving: true,
    });
  });

  it('walks to the cashier, facing the way it goes, and is there when the order is placed', () => {
    const halfway = customerPose(customer(), T0 - WALK_IN_SEC / 2);
    expect(halfway.moving).toBe(true);
    expect(halfway.x).toBeCloseTo((DOOR.x + COUNTER.x) / 2, 0);
    expect(halfway.facing).toBeCloseTo(Math.atan2(COUNTER.x - DOOR.x, COUNTER.z - DOOR.z), 1);
    expect(customerPose(customer(), T0 - 1).moving).toBe(true);
    expect(customerPose(customer(), T0)).toMatchObject({
      x: COUNTER.x,
      z: COUNTER.z,
      facing: COUNTER.facing,
      moving: false,
    });
  });

  it('is the same person on the way in as at the counter: the same place at the same moment', () => {
    for (const now of [T0 - 150, T0 - 60, T0 - 1, T0]) {
      const walker = arrivalPose(CUSTOMER, T0 - WALK_IN_SEC, now);
      const placed = customerPose(customer(), now);
      expect([walker.x, walker.z, walker.moving]).toEqual([placed.x, placed.z, placed.moving]);
    }
  });
});

describe('arrivalPose: before the order exists', () => {
  it('is not there before it comes in, walks in for WALK_IN_SEC, then waits at the counter', () => {
    const arrivedAt = 5_000;
    expect(arrivalPose(CUSTOMER, arrivedAt, arrivedAt - 1).visible).toBe(false);
    expect(arrivalPose(CUSTOMER, arrivedAt, arrivedAt)).toMatchObject({
      visible: true,
      x: DOOR.x,
      z: DOOR.z,
      moving: true,
    });
    expect(arrivalPose(CUSTOMER, arrivedAt, arrivedAt + WALK_IN_SEC - 1).moving).toBe(true);
    expect(arrivalPose(CUSTOMER, arrivedAt, arrivedAt + WALK_IN_SEC)).toMatchObject({
      x: COUNTER.x,
      z: COUNTER.z,
      moving: false,
      bubble: null,
    });
    // the page may be a moment ahead of the order that is on its way: it simply waits at the counter
    expect(arrivalPose(CUSTOMER, arrivedAt, arrivedAt + WALK_IN_SEC + 30).moving).toBe(false);
  });
});

describe('customerPose: at the counter and waiting', () => {
  it('stands at the cashier, facing her, for as long as the order is not written down', () => {
    for (const now of [T0, T0 + 44, T0 + 5_000]) {
      expect(customerPose(unrecorded(), now)).toMatchObject({
        x: COUNTER.x,
        z: COUNTER.z,
        facing: COUNTER.facing,
        moving: false,
        bubble: null,
      });
    }
  });

  it('leaves the counter when the cashier has written the order down, not before', () => {
    expect(customerPose(customer(), RECORDED - 0.5).moving).toBe(false);
    expect(customerPose(customer(), RECORDED + 5).moving).toBe(true);
  });

  it('goes to its waiting place and stays there, sitting if it is a seat', () => {
    const there = customerPose(customer(), SETTLED + 500);
    expect(there).toMatchObject({
      x: spot.x,
      z: spot.z,
      facing: spot.facing,
      moving: false,
      seated: spot.seat,
      bubble: null,
    });
    expect(customerPose(customer(), SETTLED + 50_000)).toEqual(there); // however long it takes
  });

  it('stands at the counter for 45 s in a world from before the page knew when the order was written down', () => {
    const old = customer({ recordedAt: null, status: 'cooking' });
    expect(customerPose(old, T0 + 40).moving).toBe(false);
    expect(customerPose(old, T0 + 50).moving).toBe(true);
  });

  it('appears at the counter at once for an order made by hand: nobody came in at the door', () => {
    const byHand = customer({ customerId: null, recordedAt: null, status: 'placed' });
    expect(customerPose(byHand, T0 - 1).visible).toBe(false);
    expect(customerPose(byHand, T0)).toMatchObject({ visible: true, moving: false });
    expect(customerKey(byHand)).toBe(-3);
  });

  it('says that it waits for the ingredients when the order is held, once it has left the counter', () => {
    const held = customer({ status: 'held' });
    expect(customerPose(held, RECORDED - 5).bubble).toBeNull(); // still ordering
    expect(customerPose(held, SETTLED + 10).bubble).toBe('held');
  });

  it('is upset from a complaint until it is answered, whatever else it does', () => {
    const upset = customer({ complaint: 'open', status: 'cooking' });
    expect(customerPose(upset, SETTLED + 10).bubble).toBe('upset');
    expect(customerPose(customer({ complaint: 'open', status: 'held' }), SETTLED + 10).bubble).toBe(
      'upset',
    );
    expect(customerPose(customer({ complaint: 'none' }), SETTLED + 10).bubble).toBeNull();
  });

  it('is the same for the same time, so a paused clock freezes the customers', () => {
    expect(customerPose(customer(), T0 - 77.5)).toEqual(customerPose(customer(), T0 - 77.5));
  });
});

describe('customerPose: fetching the food and going home', () => {
  const DONE = SETTLED + 600; // done long after the customer has settled
  const done = customer({ status: 'done', doneAt: DONE });
  const toPickup = secondsBetween(spot, PICKUP_SPOT);
  const ARRIVED = DONE + toPickup;

  it('shows that the food is ready and walks from its waiting place to the counter', () => {
    const start = customerPose(done, DONE);
    expect(start).toMatchObject({
      x: spot.x,
      z: spot.z,
      moving: true,
      bubble: 'ready',
      carrying: false,
      seated: false,
    });
    const middle = customerPose(done, DONE + toPickup / 2);
    expect(middle.moving).toBe(true);
    expect(middle.bubble).toBe('ready');
  });

  it('takes the food at the counter, facing the cook, and then holds it', () => {
    const at = customerPose(done, ARRIVED + 5);
    expect(at).toMatchObject({
      x: PICKUP_SPOT.x,
      z: PICKUP_SPOT.z,
      facing: PICKUP_SPOT.facing,
      moving: false,
      carrying: false,
    });
    const taken = customerPose(done, ARRIVED + PICKUP_HOLD_SEC / 2 + 1);
    expect(taken.carrying).toBe(true);
    expect(taken.bubble).toBe('ready');
  });

  it('then walks to the door with the food, no longer with a bubble, and is gone when it gets there', () => {
    const leaving = customerPose(done, ARRIVED + PICKUP_HOLD_SEC + 10);
    expect(leaving).toMatchObject({ moving: true, carrying: true, bubble: null, visible: true });
    const exit = ARRIVED + PICKUP_HOLD_SEC + secondsBetween(PICKUP_SPOT, DOOR);
    expect(customerPose(done, exit - 1).visible).toBe(true);
    expect(customerPose(done, exit + 1).visible).toBe(false);
    expect(customerPose(done, exit + 100_000).visible).toBe(false); // after a jump in time
  });

  it('still shows the complaint of a customer that is on its way out', () => {
    expect(
      customerPose({ ...done, complaint: 'open' }, ARRIVED + PICKUP_HOLD_SEC + 10).bubble,
    ).toBe('upset');
  });

  it('carries on from where it is when the food is done before it has reached its waiting place', () => {
    const early = customer({ status: 'done', doneAt: RECORDED - 20 }); // still at the cashier
    const justBefore = customerPose(early, early.doneAt! - 0.001);
    const justAfter = customerPose(early, early.doneAt! + 0.001);
    expect(justAfter.x).toBeCloseTo(justBefore.x, 1);
    expect(justAfter.z).toBeCloseTo(justBefore.z, 1);
    expect(justAfter.moving).toBe(true);

    const midWalk = customer({ status: 'done', doneAt: RECORDED + 40 }); // on the way to the waiting place
    const a = customerPose(midWalk, midWalk.doneAt! - 0.001);
    const b = customerPose(midWalk, midWalk.doneAt! + 0.001);
    expect(b.x).toBeCloseTo(a.x, 1);
    expect(b.z).toBeCloseTo(a.z, 1);
  });
});

describe('pickupTime and dishesOnCounter', () => {
  it('knows when the food is taken, and has none to take for an order that is not done', () => {
    expect(pickupTime(customer())).toBeNull();
    const done = customer({ status: 'done', doneAt: SETTLED + 600 });
    expect(pickupTime(done)).toBeCloseTo(
      SETTLED + 600 + secondsBetween(spot, PICKUP_SPOT) + PICKUP_HOLD_SEC / 2,
    );
  });

  it('counts a dish from the moment the food is done until the customer takes it', () => {
    const done = customer({ status: 'done', doneAt: SETTLED + 600 });
    const table = { 3: done };
    expect(dishesOnCounter(table, SETTLED + 599)).toBe(0);
    expect(dishesOnCounter(table, SETTLED + 601)).toBe(1);
    expect(dishesOnCounter(table, pickupTime(done)! + 1)).toBe(0);
    expect(dishesOnCounter({ 3: customer() }, SETTLED)).toBe(0);
  });

  it('counts every customer that is waiting for its food, and only those at a walk-in order', () => {
    const table = {
      1: customer({ orderId: 1, status: 'done', doneAt: SETTLED }),
      2: customer({ orderId: 2, status: 'done', doneAt: SETTLED }),
      3: customer({ orderId: 3, status: 'done', doneAt: SETTLED, source: 'regular' }),
    };
    expect(dishesOnCounter(table, SETTLED + 1)).toBe(2);
  });
});

describe('visibleCustomers', () => {
  const crowd = (count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        index + 1,
        customer({
          orderId: index + 1,
          customerId: 50_000 + index * 100,
          createdAt: T0 + index,
          recordedAt: T0 + index + 45,
        }),
      ]),
    );
  const NOW = T0 + 1_000;
  const ids = (shown: { customer: CustomerState | null }[]) =>
    shown.map((entry) => entry.customer?.orderId);

  it('draws the customers that are there, and not the ones that have not come or have gone', () => {
    const table = {
      1: customer({ orderId: 1, customerId: 50_000, createdAt: T0, recordedAt: T0 + 45 }),
      2: customer({ orderId: 2, customerId: 50_100, createdAt: T0 + 10_000 }), // not yet
      3: customer({
        orderId: 3,
        status: 'done',
        createdAt: T0 - 5000,
        recordedAt: T0 - 4950,
        doneAt: T0 - 4000,
      }), // gone long ago
    };
    expect(ids(visibleCustomers(table, {}, T0 + 100).shown)).toEqual([1]);
  });

  it('draws the customers that are still walking in, and not the ones that have not come in yet', () => {
    const { shown } = visibleCustomers({}, { 50_000: T0 - 100, 50_100: T0 + 500 }, T0);
    expect(shown.map((entry) => [entry.key, entry.customer])).toEqual([[50_000, null]]);
    expect(shown[0]?.pose).toMatchObject({ visible: true, moving: true });
  });

  it('does not draw a customer twice when its order is already there', () => {
    const table = { 1: customer({ orderId: 1, customerId: 50_000, createdAt: T0 }) };
    const { shown } = visibleCustomers(table, { 50_000: T0 - WALK_IN_SEC }, T0 + 1);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.customer?.orderId).toBe(1);
  });

  it('draws at most the limit, and counts the others', () => {
    const { shown, hidden } = visibleCustomers(crowd(30), {}, NOW);
    expect(shown).toHaveLength(MAX_VISIBLE_CUSTOMERS);
    expect(hidden).toBe(30 - MAX_VISIBLE_CUSTOMERS);
  });

  it('keeps the customers that have waited longest, and counts the newest arrivals instead', () => {
    const { shown } = visibleCustomers(crowd(30), {}, NOW);
    expect(ids(shown).sort((a, b) => a! - b!)).toEqual(
      Array.from({ length: MAX_VISIBLE_CUSTOMERS }, (_, index) => index + 1),
    );
  });

  it('always draws the customers that are leaving, even when the cafe is full', () => {
    const table = {
      ...crowd(30),
      31: customer({
        orderId: 31,
        customerId: 60_000,
        status: 'done',
        createdAt: T0 + 500,
        recordedAt: T0 + 545,
        doneAt: T0 + 900,
      }),
    };
    const { shown } = visibleCustomers(table, {}, NOW);
    expect(ids(shown)).toContain(31);
    expect(shown).toHaveLength(MAX_VISIBLE_CUSTOMERS);
  });

  it('draws a customer with a complaint even when many that waited longer fill the cafe', () => {
    const table = {
      ...crowd(30),
      31: customer({ orderId: 31, customerId: 60_000, createdAt: T0 + 100, complaint: 'open' }),
    };
    expect(ids(visibleCustomers(table, {}, NOW).shown)).toContain(31);
  });

  it('draws the customers at the cashier before the ones that wait seated, because she is working with them', () => {
    const waiting = crowd(MAX_VISIBLE_CUSTOMERS); // all settled long ago
    const atCounter = unrecorded({ orderId: 99, customerId: 70_000, createdAt: NOW - 10 });
    const { shown } = visibleCustomers({ ...waiting, 99: atCounter }, { 70_100: NOW - 50 }, NOW);
    expect(ids(shown)).toContain(99);
    expect(shown.map((entry) => entry.key)).toContain(70_100); // the one still walking in too
    expect(shown).toHaveLength(MAX_VISIBLE_CUSTOMERS);
  });

  it('leaves out the regulars: they are for stage 5', () => {
    const table = { 1: customer({ orderId: 1, source: 'regular' }) };
    expect(visibleCustomers(table, {}, T0 + 100)).toEqual({ shown: [], hidden: 0 });
  });
});
