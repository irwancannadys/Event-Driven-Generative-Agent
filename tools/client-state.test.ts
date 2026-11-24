import { describe, expect, it } from 'vitest';
import {
  RECENT_DONE_WINDOW_SEC,
  SECONDS_PER_DAY,
  dayOf,
  formatClock,
  makeScenario,
  type TimeView,
} from '@cafe/core';
import { openSeededMemoryDb } from '../packages/server/src/db/memory';
import { EventBus } from '../packages/server/src/events/bus';
import { bootSimulation } from '../packages/server/src/sim/simulation';
import { AutoBoss } from '../packages/server/src/test-support/auto-boss';
import { decideLikeTheTestBoss } from '../packages/server/src/test-support/play-day';
import { buildSnapshot } from '../packages/server/src/ws/snapshot';
import { applyEvent, applySnapshot, type WorldState } from '../packages/web/src/state/world';

// The page keeps its own state by applying events with its own copy of the rules (decision 026). This
// test plays a whole virtual day, with the characters and an automatic boss, and at hundreds of moments
// compares that state with what the server itself says (its snapshot). Two pages are followed:
// - one that has been there since the world started and applied every event,
// - one that opens at the previous moment, starts from the snapshot of that moment and applies the
//   events after it (this checks the seam between a snapshot and the stream, also for an agent that
//   is in the middle of a walk when the snapshot is taken).

/** The part of the state that must be the same. The clock is left out: it has its own messages. */
function comparable(state: WorldState, now: number) {
  return {
    lastEventId: state.lastEventId,
    agents: state.agents,
    stock: Object.fromEntries(
      Object.entries(state.stock).map(([id, row]) => [
        id,
        { qty: row.qty, low: row.low, out: row.out },
      ]),
    ),
    orders: state.orders,
    reports: state.reports,
    // A page keeps a customer a while after it left, the snapshot only those of the last twenty minutes:
    // what is older than that is nobody's business.
    customers: Object.values(state.customers).filter(
      (customer) => customer.doneAt === null || customer.doneAt >= now - RECENT_DONE_WINDOW_SEC,
    ),
    openComplaints: state.openComplaints,
    newestEvents: state.log.slice(-50).map((event) => event.id),
  };
}

describe('the page state equals the server snapshot', () => {
  it('at every moment of a whole day, for a page that was there from the start and for one that joined late', () => {
    const db = openSeededMemoryDb();
    const bus = new EventBus();
    const sim = bootSimulation({ db, bus, scenario: makeScenario(42) });
    const boss = new AutoBoss(sim, { decide: decideLikeTheTestBoss });

    const time = (): TimeView => ({
      sim_time: sim.clock.now(),
      clock: formatClock(sim.clock.now()),
      day: dayOf(sim.clock.now()),
      speed: 60,
      paused: false,
    });
    const snapshot = () => applySnapshot(buildSnapshot(sim.ctx, time()), 0);

    let fromStart = snapshot();
    let joinedLate = fromStart;
    bus.subscribe((events) => {
      fromStart = events.reduce(applyEvent, fromStart);
      joinedLate = events.reduce(applyEvent, joinedLate);
    });

    const seen = {
      cuts: 0,
      walking: 0,
      onDesk: 0,
      held: 0,
      cooking: 0,
      working: 0,
      leaving: 0,
      upset: 0,
      customers: 0,
    };
    const STEP = 47; // a prime number of seconds: the cuts fall everywhere, also in the middle of walks
    for (let cut = sim.clock.now() + STEP; cut <= SECONDS_PER_DAY; cut += STEP) {
      boss.advanceTo(cut);
      const truth = snapshot();
      const now = sim.clock.now();
      expect(comparable(fromStart, now), `from the start, at ${formatClock(cut)}`).toEqual(
        comparable(truth, now),
      );
      expect(comparable(joinedLate, now), `joined late, at ${formatClock(cut)}`).toEqual(
        comparable(truth, now),
      );
      joinedLate = truth; // a page that opens right now

      seen.cuts += 1;
      const agents = Object.values(truth.agents);
      if (agents.some((agent) => agent.state === 'walking')) seen.walking += 1;
      if (agents.some((agent) => agent.state === 'working')) seen.working += 1;
      if (truth.reports.some((report) => report.status === 'submitted')) seen.onDesk += 1;
      if (truth.orders.held > 0) seen.held += 1;
      if (truth.orders.cooking > 0) seen.cooking += 1;
      const customers = Object.values(truth.customers);
      if (customers.length > 0) seen.customers += 1;
      if (customers.some((customer) => customer.doneAt !== null)) seen.leaving += 1;
      if (customers.some((customer) => customer.complaint === 'open')) seen.upset += 1;
    }

    // The day must have had something to compare: walks, work, a report on the desk, held orders, customers
    // waiting, leaving and upset.
    expect(seen.cuts).toBeGreaterThan(1200);
    expect(seen.walking).toBeGreaterThan(40);
    expect(seen.working).toBeGreaterThan(500);
    expect(seen.onDesk).toBeGreaterThan(50);
    expect(seen.held).toBeGreaterThan(30);
    expect(seen.cooking).toBeGreaterThan(400);
    expect(seen.customers).toBeGreaterThan(800);
    expect(seen.leaving).toBeGreaterThan(600);
    expect(seen.upset).toBeGreaterThan(3);
  });
});
