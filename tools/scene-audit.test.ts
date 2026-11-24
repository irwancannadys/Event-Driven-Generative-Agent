import { describe, expect, it } from 'vitest';
import { SECONDS_PER_DAY, makeScenario, type StoredEvent } from '@cafe/core';
import { openSeededMemoryDb } from '../packages/server/src/db/memory';
import { EventBus } from '../packages/server/src/events/bus';
import { bootSimulation } from '../packages/server/src/sim/simulation';
import { AutoBoss } from '../packages/server/src/test-support/auto-boss';
import { decideLikeTheTestBoss } from '../packages/server/src/test-support/play-day';
import { buildSnapshot } from '../packages/server/src/ws/snapshot';
import {
  customerPose,
  visibleCustomers,
  MAX_VISIBLE_CUSTOMERS,
} from '../packages/web/src/scene/customer';
import { isBlocked } from '../packages/web/src/scene/navigation';
import { agentPose } from '../packages/web/src/scene/pose';
import { DOOR, orderSpot, standingPoint } from '../packages/web/src/scene/registry';
import { applyEvent, applySnapshot } from '../packages/web/src/state/world';

// An audit of what the page would show during a whole day: the poses of the characters and the customers
// are worked out every few virtual seconds from the state that the events build, and compared with what
// the log says. Anything odd is collected, and the test fails with the first few.

const STEP = 7;
const MAX_STAFF_SPEED = 0.2; // units per virtual second; the domain walks at about 0.05, a little more on some routes
const MAX_CUSTOMER_SPEED = 0.2;

function play(crowdPct: number) {
  const db = openSeededMemoryDb();
  const bus = new EventBus();
  const sim = bootSimulation({ db, bus, scenario: makeScenario(42, { crowdPct }) });
  const boss = new AutoBoss(sim, { decide: decideLikeTheTestBoss });
  const time = () => ({ sim_time: sim.clock.now(), clock: '', day: 0, speed: 60, paused: false });
  let state = applySnapshot(buildSnapshot(sim.ctx, time()), 0);
  const events: StoredEvent[] = [];
  bus.subscribe((batch) => {
    for (const event of batch) events.push(event);
    state = batch.reduce(applyEvent, state);
  });

  const problems: string[] = [];
  let overlaps = 0;
  let samples = 0;
  const note = (message: string) => {
    if (problems.length < 400) problems.push(message);
  };
  const lastStaff = new Map<string, { x: number; z: number; t: number }>();
  const lastCustomer = new Map<number, { x: number; z: number; t: number }>();
  let maxShown = 0;
  const firstAtCounter = new Map<number, number>();
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

    const { shown } = visibleCustomers(state.customers, now);
    maxShown = Math.max(maxShown, shown.length);
    for (const { customer, pose } of shown) {
      if (isBlocked(pose) && pose.moving)
        note(
          `customer ${customer.orderId} walks inside furniture at ${now} (${pose.x.toFixed(1)},${pose.z.toFixed(1)})`,
        );
      const before = lastCustomer.get(customer.orderId);
      if (before && now - before.t <= STEP * 3) {
        const speed = Math.hypot(pose.x - before.x, pose.z - before.z) / (now - before.t);
        if (speed > MAX_CUSTOMER_SPEED)
          note(
            `customer ${customer.orderId} jumps ${(speed * (now - before.t)).toFixed(2)} units in ${now - before.t}s at ${now}`,
          );
      }
      lastCustomer.set(customer.orderId, { x: pose.x, z: pose.z, t: now });
      if (
        !pose.moving &&
        Math.hypot(pose.x - orderSpot(customer.orderId).x, pose.z - orderSpot(customer.orderId).z) <
          0.01 &&
        !firstAtCounter.has(customer.orderId)
      )
        firstAtCounter.set(customer.orderId, now);
      if (pose.bubble === 'ready') sawReady.add(customer.orderId);
      if (pose.bubble === 'upset') sawUpset.add(customer.orderId);
    }
    if (shown.length > MAX_VISIBLE_CUSTOMERS) note(`more customers than the limit at ${now}`);
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
          note(`customer ${entry.customer.orderId} stands inside ${agent.id} at ${now}`);
      }
    }
  }

  // What the log says, against what the page did
  const created = events.filter(
    (event) =>
      event.type === 'order_created' && (event.payload as { source: string }).source === 'walk_in',
  );
  for (const event of created) {
    const orderId = (event.payload as { order_id: number }).order_id;
    const customer = {
      orderId,
      source: 'walk_in' as const,
      status: 'placed' as const,
      createdAt: event.sim_time,
      doneAt: null,
      complaint: 'none' as const,
    };
    const first = customerPose(customer, event.sim_time + 1);
    if (!first.visible || Math.hypot(first.x - DOOR.x, first.z - DOOR.z) > 0.5)
      note(`customer ${orderId} does not come in at the door when the order comes in`);
    const arrival = firstAtCounter.get(orderId);
    const recorded = event.sim_time + 45; // the cashier writes it down for 45 s
    if (arrival !== undefined && Math.abs(arrival - recorded) > 60)
      note(
        `customer ${orderId} reaches the cashier ${Math.round(arrival - event.sim_time)}s after ordering, the cashier is done after 45s`,
      );
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
      const times = events
        .filter(
          (other) =>
            'order_id' in other.payload &&
            (other.payload as { order_id: number }).order_id === orderId,
        )
        .map((other) => `${other.type}@${other.sim_time}`);
      note(
        `complaint about order ${orderId} never showed on its customer (complaint ${event.sim_time}, replied ${replied?.sim_time}; ${times.join(' ')})`,
      );
    }
  }
  function hiddenByLimit(orderId: number): boolean {
    return !lastCustomer.has(orderId); // never among the customers that were drawn: the limit kept it out
  }

  return {
    problems,
    overlaps,
    samples,
    maxShown,
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
      expect(summarize(result.problems)).toEqual([]);
      expect(result.maxShown).toBeLessThanOrEqual(MAX_VISIBLE_CUSTOMERS);
      // Two customers on one spot: never on a normal day. In the stress case, with a backlog of hours and
      // many more customers than places, it may happen for a moment now and then.
      expect(result.overlaps).toBeLessThanOrEqual(crowd === 100 ? 0 : result.samples * 0.02);
    });
  }
});
