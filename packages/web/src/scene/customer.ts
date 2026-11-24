import { WALK_SEC_PER_UNIT } from '@cafe/core';
import type { CustomerState } from '../state/world';
import { DOOR, ORDER_SPOT, PICKUP_SPOT, waitingSpot, type Spot } from './registry';

// What a customer does and where it is, worked out from its order and the virtual time (decisions 027
// and 029). A customer comes in when the order comes in, goes to the cashier, waits where it is told
// for the food, fetches it when it is done and goes home. Walking takes as long per step as it does for
// the staff. Nothing is remembered between calls: after a jump in time, or a refresh, the answer is
// right again.

/** How long a customer stands at the cashier after arriving, while the order is written down. */
export const ORDER_HOLD_SEC = 60;
/** How long it stands at the kitchen counter, taking the food. */
export const PICKUP_HOLD_SEC = 40;
/** The most customers drawn at once; the rest are only counted (decision 029). */
export const MAX_VISIBLE_CUSTOMERS = 14;

export type Bubble = 'upset' | 'held' | 'ready';

export interface CustomerPose {
  /** False before the customer has come in and after it has gone out of the door. */
  visible: boolean;
  x: number;
  z: number;
  /** `rotation.y`. */
  facing: number;
  moving: boolean;
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
  start: number;
  end: number;
  /** The way the customer faces when it stays. */
  facing: number;
}

const walkSeconds = (from: Point, to: Point): number =>
  Math.hypot(from.x - to.x, from.z - to.z) * WALK_SEC_PER_UNIT;

const walk = (from: Point, to: Point, start: number, facing: number): Stage => ({
  from,
  to,
  start,
  end: start + walkSeconds(from, to),
  facing,
});

const stay = (at: Point, start: number, end: number, facing: number): Stage => ({
  from: at,
  to: at,
  start,
  end,
  facing,
});

/** In at the door, a minute at the cashier, then to the waiting place, where it stays. */
function stagesToWaiting(customer: CustomerState): {
  stages: Stage[];
  seated: boolean;
  waitingFrom: number;
} {
  const spot = waitingSpot(customer.orderId);
  const arrive = walk(DOOR, ORDER_SPOT, customer.createdAt, ORDER_SPOT.facing);
  const order = stay(ORDER_SPOT, arrive.end, arrive.end + ORDER_HOLD_SEC, ORDER_SPOT.facing);
  const toSpot = walk(ORDER_SPOT, spot, order.end, spot.facing);
  return {
    stages: [arrive, order, toSpot, stay(spot, toSpot.end, Number.POSITIVE_INFINITY, spot.facing)],
    seated: spot.seat,
    waitingFrom: order.end,
  };
}

function at(
  stages: Stage[],
  time: number,
): { x: number; z: number; facing: number; moving: boolean } {
  const stage = stages.find((entry) => time < entry.end) ?? (stages.at(-1) as Stage);
  const dx = stage.to.x - stage.from.x;
  const dz = stage.to.z - stage.from.z;
  if (dx === 0 && dz === 0)
    return { x: stage.from.x, z: stage.from.z, facing: stage.facing, moving: false };
  const progress = Math.max(0, Math.min(1, (time - stage.start) / (stage.end - stage.start)));
  return {
    x: stage.from.x + dx * progress,
    z: stage.from.z + dz * progress,
    facing: Math.atan2(dx, dz),
    moving: progress < 1,
  };
}

const HIDDEN: CustomerPose = {
  visible: false,
  x: DOOR.x,
  z: DOOR.z,
  facing: DOOR.facing,
  moving: false,
  seated: false,
  carrying: false,
  bubble: null,
};

/** Where the food of a done order is picked up and when: the plan once the order is done. */
function afterDone(customer: CustomerState, from: Point, doneAt: number) {
  const toPickup = walk(from, PICKUP_SPOT, doneAt, PICKUP_SPOT.facing);
  const take = stay(PICKUP_SPOT, toPickup.end, toPickup.end + PICKUP_HOLD_SEC, PICKUP_SPOT.facing);
  const leave = walk(PICKUP_SPOT, DOOR, take.end, DOOR.facing);
  return { stages: [toPickup, take, leave], toPickup, take, leave, customer };
}

export function customerPose(customer: CustomerState, now: number): CustomerPose {
  if (now < customer.createdAt) return HIDDEN;
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

export interface ShownCustomer {
  customer: CustomerState;
  pose: CustomerPose;
}

/** The customers to draw: the newest ones, at most the limit, and how many more there would be. */
export function visibleCustomers(
  customers: Record<number, CustomerState>,
  now: number,
): { shown: ShownCustomer[]; hidden: number } {
  const all: ShownCustomer[] = [];
  for (const customer of Object.values(customers)) {
    if (customer.source !== 'walk_in') continue; // the regulars of stage 5 are drawn with Rina
    const pose = customerPose(customer, now);
    if (pose.visible) all.push({ customer, pose });
  }
  all.sort(
    (a, b) =>
      b.customer.createdAt - a.customer.createdAt || b.customer.orderId - a.customer.orderId,
  );
  return {
    shown: all.slice(0, MAX_VISIBLE_CUSTOMERS),
    hidden: Math.max(0, all.length - MAX_VISIBLE_CUSTOMERS),
  };
}

export type { Spot };
