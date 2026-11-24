import { TASK_DURATION_SEC, WALK_IN_SEC, WALK_SEC_PER_UNIT } from '@cafe/core';
import type { CustomerState } from '../state/world';
import { findPath, pathLength, pointAlong } from './navigation';
import { DOOR, orderSpot, pickupSpot, waitingSpot, type Spot } from './registry';

// What a customer does and where it is, worked out from what happened to it and the virtual time
// (decisions 027, 029 and 032). A customer comes in at the door (`customer_arrived`) and walks to the
// cashier, exactly as long as the domain says (`WALK_IN_SEC`), so that it stands at the counter when its
// order is placed. It stays there until the cashier has written the order down, goes to its waiting place,
// fetches the food when it is done and goes home. Nothing is remembered between calls: after a jump in
// time, or a refresh, the answer is right again.

/**
 * How long a customer takes for one layout unit once it is inside: as long as the staff (decision 031), so
 * that nobody on the floor moves faster than the rest.
 */
export const CUSTOMER_SEC_PER_UNIT = WALK_SEC_PER_UNIT;
/** How long it stands at the kitchen counter, taking the food. */
export const PICKUP_HOLD_SEC = 40;
/** The most customers drawn at once (one for every place to wait); the rest are only counted (decision 029). */
export const MAX_VISIBLE_CUSTOMERS = 20;

export type Bubble = 'upset' | 'held' | 'ready';

export interface CustomerPose {
  /** False before the customer has come in and after it has gone out of the door. */
  visible: boolean;
  x: number;
  z: number;
  /** `rotation.y`. */
  facing: number;
  moving: boolean;
  /** How far it has walked along the leg it is on, in layout units (the legs swing by it). */
  walked: number;
  /** Sitting at a table while it waits for the food. */
  seated: boolean;
  /** Has the food in its hand. */
  carrying: boolean;
  /** What to show above its head. */
  bubble: Bubble | null;
}

interface Point {
  x: number;
  z: number;
}

/** A walk from one place to another, or (when the two are the same) a stay. */
interface Stage {
  from: Point;
  to: Point;
  /** The way from one to the other, round the furniture and through the doors. */
  path: Point[];
  start: number;
  end: number;
  /** The way the customer faces when it stays. */
  facing: number;
}

const walk = (from: Point, to: Point, start: number, facing: number): Stage => {
  const path = findPath(from, to);
  return { from, to, path, start, end: start + pathLength(path) * CUSTOMER_SEC_PER_UNIT, facing };
};

/** A walk that takes exactly from `start` to `end`, whatever its length: the domain says how long. */
const walkOver = (from: Point, to: Point, start: number, end: number, facing: number): Stage => ({
  from,
  to,
  path: findPath(from, to),
  start,
  end,
  facing,
});

const stay = (at: Point, start: number, end: number, facing: number): Stage => ({
  from: at,
  to: at,
  path: [at],
  start,
  end,
  facing,
});

/**
 * What the scene remembers a customer by (its look, the place it stands at the counter): the customer that
 * came in at the door, or, for an order made by hand, a negative number made from the order.
 */
export const customerKey = (customer: CustomerState): number =>
  customer.customerId ?? -customer.orderId;

/** When a customer shows: at the door `WALK_IN_SEC` before its order, or at the counter for a hand-made order. */
const appearsAt = (customer: CustomerState): number =>
  customer.customerId === null ? customer.createdAt : customer.createdAt - WALK_IN_SEC;

/**
 * When the cashier has written the order down and the customer leaves the counter, `Infinity` while she
 * has not. A world from before the page knew about it (`recordedAt` missing) gets the time she takes.
 */
function leavesCounterAt(customer: CustomerState): number {
  if (customer.recordedAt !== null) return customer.recordedAt;
  return customer.status === 'placed'
    ? Number.POSITIVE_INFINITY
    : customer.createdAt + TASK_DURATION_SEC.recording_order;
}

/** In at the door, to the cashier, there until the order is written down, then to the waiting place. */
function stagesToWaiting(customer: CustomerState): {
  stages: Stage[];
  seated: boolean;
  waitingFrom: number;
} {
  const spot = waitingSpot(customer.orderId);
  const counter = orderSpot(customerKey(customer));
  const arrive =
    customer.customerId === null
      ? []
      : [
          walkOver(
            DOOR,
            counter,
            customer.createdAt - WALK_IN_SEC,
            customer.createdAt,
            counter.facing,
          ),
        ];
  const leaves = leavesCounterAt(customer);
  if (!Number.isFinite(leaves)) {
    return {
      stages: [
        ...arrive,
        stay(counter, customer.createdAt, Number.POSITIVE_INFINITY, counter.facing),
      ],
      seated: false,
      waitingFrom: leaves,
    };
  }
  const order = stay(
    counter,
    customer.createdAt,
    Math.max(customer.createdAt, leaves),
    counter.facing,
  );
  const toSpot = walk(counter, spot, order.end, spot.facing);
  return {
    stages: [
      ...arrive,
      order,
      toSpot,
      stay(spot, toSpot.end, Number.POSITIVE_INFINITY, spot.facing),
    ],
    seated: spot.seat,
    waitingFrom: order.end,
  };
}

function at(
  stages: Stage[],
  time: number,
): { x: number; z: number; facing: number; moving: boolean; walked: number } {
  const stage = stages.find((entry) => time < entry.end) ?? (stages.at(-1) as Stage);
  if (stage.path.length < 2 || pathLength(stage.path) === 0) {
    return { x: stage.from.x, z: stage.from.z, facing: stage.facing, moving: false, walked: 0 };
  }
  const progress = Math.max(0, Math.min(1, (time - stage.start) / (stage.end - stage.start)));
  const here = pointAlong(stage.path, progress);
  return {
    x: here.x,
    z: here.z,
    facing: here.heading,
    moving: progress < 1,
    walked: progress * pathLength(stage.path),
  };
}

const HIDDEN: CustomerPose = {
  visible: false,
  x: DOOR.x,
  z: DOOR.z,
  facing: DOOR.facing,
  moving: false,
  walked: 0,
  seated: false,
  carrying: false,
  bubble: null,
};

/** Where the food of a done order is picked up and when: the plan once the order is done. */
function afterDone(customer: CustomerState, from: Point, doneAt: number) {
  const hatch = pickupSpot(customer.orderId);
  const toPickup = walk(from, hatch, doneAt, hatch.facing);
  const take = stay(hatch, toPickup.end, toPickup.end + PICKUP_HOLD_SEC, hatch.facing);
  const leave = walk(hatch, DOOR, take.end, DOOR.facing);
  return { stages: [toPickup, take, leave], toPickup, take, leave, customer };
}

export function customerPose(customer: CustomerState, now: number): CustomerPose {
  if (now < appearsAt(customer)) return HIDDEN;
  const upset = customer.complaint === 'open';
  const before = stagesToWaiting(customer);

  if (customer.doneAt === null || now < customer.doneAt) {
    const place = at(before.stages, now);
    const waiting = now >= before.waitingFrom;
    return {
      visible: true,
      ...place,
      seated: before.seated && !place.moving && waiting,
      carrying: false,
      bubble: upset ? 'upset' : customer.status === 'held' && waiting ? 'held' : null,
    };
  }

  // The food is done: from wherever the customer was at that moment it fetches it, then goes home.
  const where = at(before.stages, customer.doneAt);
  const plan = afterDone(customer, where, customer.doneAt);
  if (now >= plan.leave.end) return HIDDEN;
  const place = at(plan.stages, now);
  const tookIt = now >= plan.take.start + PICKUP_HOLD_SEC / 2;
  return {
    visible: true,
    ...place,
    seated: false,
    carrying: tookIt,
    bubble: upset ? 'upset' : now < plan.take.end ? 'ready' : null,
  };
}

/**
 * A customer that came in at the door and is on its way to the cashier, before its order exists. It
 * arrives at the counter exactly when the order is placed, at the same spot where the customer of that
 * order will stand.
 */
export function arrivalPose(customerId: number, arrivedAt: number, now: number): CustomerPose {
  if (now < arrivedAt) return HIDDEN;
  const counter = orderSpot(customerId);
  const stages = [
    walkOver(DOOR, counter, arrivedAt, arrivedAt + WALK_IN_SEC, counter.facing),
    stay(counter, arrivedAt + WALK_IN_SEC, Number.POSITIVE_INFINITY, counter.facing),
  ];
  return {
    visible: true,
    ...at(stages, now),
    seated: false,
    carrying: false,
    bubble: null,
  };
}

/** When the food of a done order is taken off the counter, or `null` while the order is not done. */
export function pickupTime(customer: CustomerState): number | null {
  if (customer.doneAt === null) return null;
  const where = at(stagesToWaiting(customer).stages, customer.doneAt);
  return afterDone(customer, where, customer.doneAt).take.start + PICKUP_HOLD_SEC / 2;
}

/** How many dishes stand on the counter waiting for their customers: done, but not taken yet. */
export function dishesOnCounter(customers: Record<number, CustomerState>, now: number): number {
  let count = 0;
  for (const customer of Object.values(customers)) {
    if (customer.source !== 'walk_in' || customer.doneAt === null || now < customer.doneAt)
      continue;
    const taken = pickupTime(customer);
    if (taken !== null && now < taken) count += 1;
  }
  return count;
}

/** A person to draw: a customer with an order, or one that is still on its way to the cashier. */
export interface ShownCustomer {
  /** What the scene knows the person by: see `customerKey`. */
  key: number;
  /** `null` for a customer that has no order yet. */
  customer: CustomerState | null;
  pose: CustomerPose;
}

/**
 * The people to draw, at most the limit, and how many more there would be. The ones that are leaving are
 * always drawn, then the ones with a complaint, then the ones at or on their way to the cashier (the
 * cashier is working with them), then the ones that have waited longest (they are the next to be served);
 * the newest arrivals are counted until there is room.
 */
export function visibleCustomers(
  customers: Record<number, CustomerState>,
  arrivals: Record<number, number>,
  now: number,
): { shown: ShownCustomer[]; hidden: number } {
  const all: (ShownCustomer & { since: number })[] = [];
  const known = new Set<number>();
  for (const customer of Object.values(customers)) {
    if (customer.source !== 'walk_in') continue; // the regulars of stage 5 are drawn with Rina
    if (customer.customerId !== null) known.add(customer.customerId);
    const pose = customerPose(customer, now);
    if (pose.visible)
      all.push({ key: customerKey(customer), customer, pose, since: appearsAt(customer) });
  }
  for (const [id, arrivedAt] of Object.entries(arrivals)) {
    const customerId = Number(id);
    if (known.has(customerId)) continue;
    const pose = arrivalPose(customerId, arrivedAt, now);
    if (pose.visible) all.push({ key: customerId, customer: null, pose, since: arrivedAt });
  }
  const rank = (entry: ShownCustomer): number => {
    const { customer } = entry;
    if (customer === null) return 2;
    if (customer.doneAt !== null && now >= customer.doneAt) return 0;
    if (customer.complaint === 'open') return 1;
    return now < leavesCounterAt(customer) ? 2 : 3;
  };
  all.sort((a, b) => rank(a) - rank(b) || a.since - b.since || a.key - b.key);
  return {
    shown: all
      .slice(0, MAX_VISIBLE_CUSTOMERS)
      .map(({ key, customer, pose }) => ({ key, customer, pose })),
    hidden: Math.max(0, all.length - MAX_VISIBLE_CUSTOMERS),
  };
}

export type { Spot };
