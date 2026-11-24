import { describe, expect, it } from 'vitest';
import { SECONDS_PER_DAY, WALK_IN_SEC, makeScenario, type StoredEvent } from '@cafe/core';
import { openSeededMemoryDb } from '../packages/server/src/db/memory';
import { EventBus } from '../packages/server/src/events/bus';
import { bootSimulation } from '../packages/server/src/sim/simulation';
import { AutoBoss } from '../packages/server/src/test-support/auto-boss';
import { decideLikeTheTestBoss } from '../packages/server/src/test-support/play-day';
import { buildSnapshot } from '../packages/server/src/ws/snapshot';
import {
  arrivalPose,
  customerPose,
  visibleCustomers,
  MAX_VISIBLE_CUSTOMERS,
} from '../packages/web/src/scene/customer';
import { isBlocked } from '../packages/web/src/scene/navigation';
import { agentPose } from '../packages/web/src/scene/pose';
import { DOOR, orderSpot, standingPoint } from '../packages/web/src/scene/registry';
import { applyEvent, applySnapshot, type CustomerState } from '../packages/web/src/state/world';

// An audit of what the page would show during a whole day: the poses of the characters and the customers
// are worked out every few virtual seconds from the state that the events build, and compared with what
// the log says. Anything odd is collected, and the test fails with the first few.

const STEP = 7;
const MAX_STAFF_SPEED = 0.2; // units per virtual second; the domain walks at about 0.05, a little more on some routes
const MAX_CUSTOMER_SPEED = 0.2;

const near = (a: { x: number; z: number }, b: { x: number; z: number }, within = 1e-6) =>
  Math.hypot(a.x - b.x, a.z - b.z) <= within;

function play(crowdPct: number) {
  const db = openSeededMemoryDb();
  const bus = new EventBus();
  const sim = bootSimulation({ db, bus, scenario: makeScenario(42, { crowdPct }) });
  const boss = new AutoBoss(sim, { decide: decideLikeTheTestBoss });
  const time = () => ({ sim_time: sim.clock.now(), clock: '', day: 0, speed: 60, paused: false });
  let state = applySnapshot(buildSnapshot(sim.ctx, time()), 0);
  const events: StoredEvent[] = [];
  // which order a task of the cashier is about, so that the audit can tell whom she is writing down
  const orderOfTask = new Map<number, number>();
  bus.subscribe((batch) => {
    for (const event of batch) {
      events.push(event);
      if (
        event.type === 'agent_task_assigned' &&
        event.payload.label === 'recording_order' &&
        event.payload.ref?.type === 'order'
      )
        orderOfTask.set(event.payload.task_id, Number(event.payload.ref.id));
    }
    state = batch.reduce(applyEvent, state);
  });

  const problems: string[] = [];
  let overlaps = 0;
  let samples = 0;
  let recordingSamples = 0;
  let queueSamples = 0;
  const note = (message: string) => {
    if (problems.length < 400) problems.push(message);
  };
  const lastStaff = new Map<string, { x: number; z: number; t: number }>();
  const lastCustomer = new Map<number, { x: number; z: number; t: number }>();
  let maxShown = 0;
  const firstSeen = new Map<number, number>();
  const sawReady = new Set<number>();
  const sawUpset = new Set<number>();

  for (let t = sim.clock.now() + STEP; t <= SECONDS_PER_DAY; t += STEP) {
    boss.advanceTo(t);
    const now = sim.clock.now();
    samples += 1;

    for (const agent of Object.values(state.agents)) {
      const pose = agentPose(agent, now);
      if (isBlocked(pose) && pose.status === 'walking')
        note(
          `${agent.id} walks inside furniture at ${now} (${pose.x.toFixed(1)},${pose.z.toFixed(1)})`,
        );
      if (agent.state !== 'walking') {
        const spot = standingPoint(agent.station, agent.id);
        if (Math.hypot(pose.x - spot.x, pose.z - spot.z) > 1e-6)
          note(`${agent.id} ${agent.state} but not at ${agent.station} at ${now}`);
      }
      const before = lastStaff.get(agent.id);
      if (before) {
        const speed = Math.hypot(pose.x - before.x, pose.z - before.z) / (now - before.t);
        if (speed > MAX_STAFF_SPEED)
          note(
            `${agent.id} jumps ${(speed * (now - before.t)).toFixed(2)} units in ${now - before.t}s at ${now}`,
          );
      }
      lastStaff.set(agent.id, { x: pose.x, z: pose.z, t: now });
    }

    const { shown, hidden } = visibleCustomers(state.customers, state.arrivals, now);
    maxShown = Math.max(maxShown, shown.length);
    const byKey = new Map(shown.map((entry) => [entry.key, entry]));
    for (const { key, customer, pose } of shown) {
      const who = customer ? `customer ${customer.orderId}` : `customer ${key} (walking in)`;
      if (isBlocked(pose) && pose.moving)
        note(`${who} walks inside furniture at ${now} (${pose.x.toFixed(1)},${pose.z.toFixed(1)})`);
      const before = lastCustomer.get(key);
      if (before && now - before.t <= STEP * 3) {
        const speed = Math.hypot(pose.x - before.x, pose.z - before.z) / (now - before.t);
        if (speed > MAX_CUSTOMER_SPEED)
          note(
            `${who} jumps ${(speed * (now - before.t)).toFixed(2)} units in ${now - before.t}s at ${now}`,
          );
      }
      lastCustomer.set(key, { x: pose.x, z: pose.z, t: now });
      if (!firstSeen.has(key)) firstSeen.set(key, now);
      if (pose.bubble === 'ready' && customer) sawReady.add(customer.orderId);
      if (pose.bubble === 'upset' && customer) sawUpset.add(customer.orderId);
    }
    if (shown.length > MAX_VISIBLE_CUSTOMERS) note(`more customers than the limit at ${now}`);

    // The cashier and the customer in front of her (decision 032): she writes down the order of the one that
    // stands at her counter, and she is never idle while somebody there waits to be written down.
    const cashier = state.agents.cashier;
    if (cashier.state === 'working' && cashier.label === 'recording_order' && cashier.taskId) {
      recordingSamples += 1;
      const orderId = orderOfTask.get(cashier.taskId);
      const customer = Object.values(state.customers).find((entry) => entry.orderId === orderId);
      const entry = customer && byKey.get(customer.customerId ?? -customer.orderId);
      if (!customer || !entry)
        note(`the cashier writes down order ${orderId} at ${now} but nobody stands there`);
      else if (entry.pose.moving || !near(entry.pose, orderSpot(entry.key)))
        note(
          `the cashier writes down order ${orderId} at ${now} but its customer is not at the counter`,
        );
    }
    const waiting = Object.values(state.customers).filter(
      (customer) =>
        customer.source === 'walk_in' &&
        customer.status === 'placed' &&
        customer.recordedAt === null,
    );
    if (waiting.length > 0) {
      queueSamples += 1;
      if (cashier.state === 'idle')
        note(
          `the cashier is idle at ${now} while order ${waiting[0]?.orderId} waits at her counter`,
        );
      for (const customer of waiting) {
        const entry = byKey.get(customer.customerId ?? -customer.orderId);
        if (entry && (entry.pose.moving || !near(entry.pose, orderSpot(entry.key))))
          note(
            `order ${customer.orderId} is not written down at ${now} but its customer left the counter`,
          );
      }
    }
    // nobody stands inside somebody else
    const standing = shown.filter((entry) => !entry.pose.moving);
    for (let a = 0; a < standing.length; a += 1) {
      for (let b = a + 1; b < standing.length; b += 1) {
        const first = (standing[a] as (typeof standing)[number]).pose;
        const second = (standing[b] as (typeof standing)[number]).pose;
        if (Math.hypot(first.x - second.x, first.z - second.z) < 0.3) overlaps += 1;
      }
    }
    for (const entry of standing) {
      for (const agent of Object.values(state.agents)) {
        if (agent.state === 'walking') continue; // staff on the move go round the people they meet
        const staff = agentPose(agent, now);
        if (Math.hypot(entry.pose.x - staff.x, entry.pose.z - staff.z) < 0.3)
          note(`customer ${entry.key} stands inside ${agent.id} at ${now}`);
      }
    }
    void hidden;
  }

  // What the log says, against what the page did
  const arrived = new Map(
    events
      .filter((event) => event.type === 'customer_arrived')
      .map((event) => [(event.payload as { customer_id: number }).customer_id, event.sim_time]),
  );
  const created = events.filter(
    (event) =>
      event.type === 'order_created' && (event.payload as { source: string }).source === 'walk_in',
  );
  const finishedAt = new Map<number, number>(); // order -> when the cashier finished writing it down
  for (const event of events) {
    if (event.type !== 'agent_task_finished') continue;
    const order = orderOfTask.get(event.payload.task_id);
    if (order !== undefined) finishedAt.set(order, event.sim_time);
  }
  for (const event of created) {
    const { order_id: orderId, customer_id: customerId } = event.payload as {
      order_id: number;
      customer_id?: number;
    };
    if (customerId === undefined) {
      note(`order ${orderId} has no customer`);
      continue;
    }
    const arrivedAt = arrived.get(customerId);
    if (arrivedAt === undefined || event.sim_time - arrivedAt !== WALK_IN_SEC)
      note(`order ${orderId} is not placed ${WALK_IN_SEC}s after its customer came in`);
    // at the door when it comes in
    const atDoor = arrivalPose(customerId, arrivedAt ?? 0, (arrivedAt ?? 0) + 1);
    if (!atDoor.visible || Math.hypot(atDoor.x - DOOR.x, atDoor.z - DOOR.z) > 0.5)
      note(`customer ${customerId} does not come in at the door`);
    // at the counter when the order is placed, and gone from there when the cashier has finished
    const customer: CustomerState = {
      orderId,
      customerId,
      source: 'walk_in',
      status: 'placed',
      createdAt: event.sim_time,
      recordedAt: finishedAt.get(orderId) ?? null,
      doneAt: null,
      complaint: 'none',
    };
    const placed = customerPose(customer, event.sim_time);
    if (placed.moving || !near(placed, orderSpot(customerId)))
      note(`customer ${customerId} is not at the counter when order ${orderId} is placed`);
    const finished = finishedAt.get(orderId);
    if (finished !== undefined) {
      const still = customerPose(customer, finished - 1);
      const gone = customerPose(customer, finished + 0.5); // (a waiting place next to the counter is a short walk)
      if (still.moving || !gone.moving)
        note(
          `customer ${customerId} does not leave the counter when order ${orderId} is written down`,
        );
    }
  }
  const done = events.filter((event) => event.type === 'cooking_done');
  for (const event of done) {
    const orderId = (event.payload as { order_id: number }).order_id;
    if (
      !sawReady.has(orderId) &&
      created.some((c) => (c.payload as { order_id: number }).order_id === orderId) &&
      !hiddenByLimit(orderId)
    )
      note(`order ${orderId} was done but its customer never showed "ready"`);
  }
  const complaints = events.filter((event) => event.type === 'complaint_received');
  for (const event of complaints) {
    const orderId = (event.payload as { order_id: number }).order_id;
    if (!sawUpset.has(orderId) && !hiddenByLimit(orderId)) {
      const complaintId = (event.payload as { complaint_id: number }).complaint_id;
      const replied = events.find(
        (other) =>
          other.type === 'complaint_replied' &&
          (other.payload as { complaint_id: number }).complaint_id === complaintId,
      );
      note(
        `complaint about order ${orderId} never showed on its customer (complaint ${event.sim_time}, replied ${replied?.sim_time})`,
      );
    }
  }
  function hiddenByLimit(orderId: number): boolean {
    const customerId = (
      created.find((c) => (c.payload as { order_id: number }).order_id === orderId)?.payload as {
        customer_id?: number;
      }
    ).customer_id;
    return customerId === undefined || !lastCustomer.has(customerId);
  }

  return {
    problems,
    overlaps,
    samples,
    maxShown,
    recordingSamples,
    queueSamples,
    orders: created.length,
    complaints: complaints.length,
    events,
  };
}

/** The problems grouped by kind, with how many there are and one example, so that a long list stays readable. */
function summarize(problems: string[]): string[] {
  const groups = new Map<string, { count: number; example: string }>();
  for (const problem of problems) {
    const kind = problem.replace(/\d+(\.\d+)?/g, '#').replace(/\(#,#\)/g, '');
    const group = groups.get(kind) ?? { count: 0, example: problem };
    group.count += 1;
    groups.set(kind, group);
  }
  return [...groups.values()].map((group) => `${group.count}x, e.g. ${group.example}`);
}

describe('the picture of a whole day agrees with the log', () => {
  for (const crowd of [100, 250]) {
    it(`at crowd ${crowd}%: nobody walks through furniture or jumps, everyone is where the log says`, () => {
      const result = play(crowd);
      expect(result.orders).toBeGreaterThan(40);
      expect(result.recordingSamples).toBeGreaterThan(30); // the cashier was seen at her work often enough
      expect(summarize(result.problems)).toEqual([]);
      expect(result.maxShown).toBeLessThanOrEqual(MAX_VISIBLE_CUSTOMERS);
      // Two customers on one spot: never on a normal day. In the stress case, with a backlog of hours and
      // many more customers than places, it may happen for a moment now and then.
      expect(result.overlaps).toBeLessThanOrEqual(crowd === 100 ? 0 : result.samples * 0.02);
    });
  }
});
