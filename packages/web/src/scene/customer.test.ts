import { describe, expect, it } from 'vitest';
import type { CustomerState } from '../state/world';
import {
  CUSTOMER_SEC_PER_UNIT,
  MAX_VISIBLE_CUSTOMERS,
  ORDER_HOLD_SEC,
  PICKUP_HOLD_SEC,
  customerPose,
  dishesOnCounter,
  pickupTime,
  visibleCustomers,
} from './customer';
import { DOOR, orderSpot, pickupSpot, waitingSpot } from './registry';

const ORDER_SPOT = orderSpot(3);
const PICKUP_SPOT = pickupSpot(3);

const T0 = 10_000;
const customer = (overrides: Partial<CustomerState> = {}): CustomerState => ({
  orderId: 3,
  customerId: null,
  source: 'walk_in',
  status: 'placed',
  createdAt: T0,
  recordedAt: null,
  doneAt: null,
  complaint: 'none',
  ...overrides,
});

const secondsBetween = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z) * CUSTOMER_SEC_PER_UNIT;

// The times of the story of one order: in at the door, a minute at the cashier, off to a waiting place.
const ARRIVES = T0 + secondsBetween(DOOR, ORDER_SPOT);
const ORDERED = ARRIVES + ORDER_HOLD_SEC;
const spot = waitingSpot(3);
const SETTLED = ORDERED + secondsBetween(ORDER_SPOT, spot);

describe('customerPose: coming in and waiting', () => {
  it('is not there before its order comes in', () => {
    expect(customerPose(customer(), T0 - 1).visible).toBe(false);
  });

  it('comes in at the door and walks to the cashier, facing the way it goes', () => {
    const start = customerPose(customer(), T0);
    expect(start).toMatchObject({ visible: true, x: DOOR.x, z: DOOR.z, moving: true });
    const halfway = customerPose(customer(), T0 + (ARRIVES - T0) / 2);
    expect(halfway.x).toBeCloseTo((DOOR.x + ORDER_SPOT.x) / 2);
    expect(halfway.z).toBeCloseTo((DOOR.z + ORDER_SPOT.z) / 2);
    expect(halfway.facing).toBeCloseTo(Math.atan2(ORDER_SPOT.x - DOOR.x, ORDER_SPOT.z - DOOR.z));
  });

  it('stands at the cashier for a minute, facing her, while the order is written down', () => {
    for (const now of [ARRIVES, ARRIVES + 30, ORDERED - 1]) {
      expect(customerPose(customer(), now)).toMatchObject({
        x: ORDER_SPOT.x,
        z: ORDER_SPOT.z,
        facing: ORDER_SPOT.facing,
        moving: false,
      });
    }
  });

  it('then goes to its waiting place and stays there, sitting if it is a seat', () => {
    expect(customerPose(customer(), ORDERED + 1).moving).toBe(true);
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

  it('says that it waits for the ingredients when the order is held, once it has settled', () => {
    const held = customer({ status: 'held' });
    expect(customerPose(held, ARRIVES + 10).bubble).toBeNull(); // still ordering
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
    expect(customerPose(customer(), T0 + 77.5)).toEqual(customerPose(customer(), T0 + 77.5));
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
    expect(middle.x).toBeCloseTo((spot.x + PICKUP_SPOT.x) / 2);
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
    const early = customer({ status: 'done', doneAt: ARRIVES + 30 }); // still at the cashier
    const justBefore = customerPose(early, early.doneAt! - 0.001);
    const justAfter = customerPose(early, early.doneAt! + 0.001);
    expect(justAfter.x).toBeCloseTo(justBefore.x, 1);
    expect(justAfter.z).toBeCloseTo(justBefore.z, 1);
    expect(justAfter.moving).toBe(true);

    const midWalk = customer({ status: 'done', doneAt: ORDERED + 40 }); // on the way to the waiting place
    const a = customerPose(midWalk, midWalk.doneAt! - 0.001);
    const b = customerPose(midWalk, midWalk.doneAt! + 0.001);
    expect(b.x).toBeCloseTo(a.x, 1);
    expect(b.z).toBeCloseTo(a.z, 1);
  });

  it('is at the counter when the food is done while it is still on its way in', () => {
    const fast = customer({ status: 'done', doneAt: T0 + 20 });
    const pose = customerPose(fast, T0 + 20 + 1);
    expect(pose.bubble).toBe('ready');
    expect(pose.moving).toBe(true);
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
        customer({ orderId: index + 1, createdAt: T0 + index }),
      ]),
    );

  it('draws the customers that are there, and not the ones that have not come or have gone', () => {
    const table = {
      1: customer({ orderId: 1, createdAt: T0 }),
      2: customer({ orderId: 2, createdAt: T0 + 10_000 }), // not yet
      3: customer({ orderId: 3, status: 'done', createdAt: T0 - 5000, doneAt: T0 - 4000 }), // gone long ago
    };
    expect(visibleCustomers(table, T0 + 100).shown.map((entry) => entry.customer.orderId)).toEqual([
      1,
    ]);
  });

  it('draws at most the limit, and counts the others', () => {
    const { shown, hidden } = visibleCustomers(crowd(30), T0 + 1000);
    expect(shown).toHaveLength(MAX_VISIBLE_CUSTOMERS);
    expect(hidden).toBe(30 - MAX_VISIBLE_CUSTOMERS);
  });

  it('keeps the customers that have waited longest, and counts the newest arrivals instead', () => {
    const { shown } = visibleCustomers(crowd(30), T0 + 1000);
    const ids = shown.map((entry) => entry.customer.orderId).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: MAX_VISIBLE_CUSTOMERS }, (_, index) => index + 1));
  });

  it('always draws the customers that are leaving, even when the cafe is full', () => {
    const table = {
      ...crowd(30),
      31: customer({ orderId: 31, status: 'done', createdAt: T0 + 500, doneAt: T0 + 900 }),
    };
    const { shown } = visibleCustomers(table, T0 + 1000);
    expect(shown.some((entry) => entry.customer.orderId === 31)).toBe(true);
    expect(shown).toHaveLength(MAX_VISIBLE_CUSTOMERS);
  });

  it('draws a customer with a complaint even when many that waited longer fill the cafe', () => {
    const table = {
      ...crowd(30),
      31: customer({ orderId: 31, createdAt: T0 + 100, complaint: 'open' as const }),
    };
    const { shown } = visibleCustomers(table, T0 + 1000);
    expect(shown.some((entry) => entry.customer.orderId === 31)).toBe(true);
  });

  it('leaves out the regulars: they are for stage 5', () => {
    const table = { 1: customer({ orderId: 1, source: 'regular' }) };
    expect(visibleCustomers(table, T0 + 100)).toEqual({ shown: [], hidden: 0 });
  });
});
