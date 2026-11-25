import { describe, expect, it } from 'vitest';
import {
  RECENT_COMPLAINT_WINDOW_SEC,
  RECENT_DONE_WINDOW_SEC,
  SECONDS_PER_DAY,
  dayOf,
  formatClock,
  DEFAULT_FAKE_SCRIPT,
  FakeLLM,
  makeScenario,
  type Scenario,
  type TimeView,
} from '@cafe/core';
import { openSeededMemoryDb } from '../packages/server/src/db/memory';
import { EventBus } from '../packages/server/src/events/bus';
import { bootSimulation } from '../packages/server/src/sim/simulation';
import { AutoBoss, type AutoBossOptions } from '../packages/server/src/test-support/auto-boss';
import { DeferredLLM, flushPromises } from '../packages/server/src/test-support/deferred-llm';
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
        { qty: row.qty, min_qty: row.min_qty, low: row.low, out: row.out },
      ]),
    ),
    orders: state.orders,
    reports: state.reports,
    // A page keeps a customer a while after it left, the snapshot only those of the last twenty minutes:
    // what is older than that is nobody's business.
    customers: Object.values(state.customers).filter(
      (customer) => customer.doneAt === null || customer.doneAt >= now - RECENT_DONE_WINDOW_SEC,
    ),
    arrivals: state.arrivals,
    // the same for a complaint that was answered long ago
    complaints: Object.values(state.complaints).filter(
      (complaint) =>
        complaint.repliedAt === null || complaint.repliedAt >= now - RECENT_COMPLAINT_WINDOW_SEC,
    ),
    memories: state.memories,
    review: state.review,
    newestEvents: state.log.slice(-50).map((event) => event.id),
  };
}

/** Follows a whole day with two pages and compares them with the server at every cut, and counts what it saw. */
async function followDay(
  scenario: Scenario,
  bossDecides: AutoBossOptions['decide'],
  options: { days?: number; llm?: boolean; slowModel?: boolean } = {},
) {
  {
    const days = options.days ?? 1;
    const db = openSeededMemoryDb();
    const bus = new EventBus();
    // A slow model answers like the scripted one, but only some minutes after it was asked (decision 037).
    const scripted = new FakeLLM(DEFAULT_FAKE_SCRIPT);
    const slow = new DeferredLLM();
    const sim = bootSimulation({
      db,
      bus,
      scenario,
      ...(options.llm && { llm: scripted }),
      ...(options.slowModel && { llm: slow }),
    });
    const SLOW_ANSWER_AFTER_SEC = 300;
    let askedSeenAt: number | undefined;
    const boss = new AutoBoss(sim, { decide: bossDecides });

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
      waitingForBoss: 0,
      answered: 0,
      walkingIn: 0,
      recorded: 0,
      reviewed: 0,
      noted: 0,
      reflected: 0,
      policyChanged: 0,
      thinking: 0,
    };
    const STEP = 47; // a prime number of seconds: the cuts fall everywhere, also in the middle of walks
    for (let cut = sim.clock.now() + STEP; cut <= days * SECONDS_PER_DAY; cut += STEP) {
      boss.advanceTo(cut);
      if (options.slowModel) {
        await flushPromises(); // a question goes out right after its step
        const asked = slow.oldest;
        if (asked && askedSeenAt === undefined) askedSeenAt = sim.clock.now();
        if (
          asked &&
          askedSeenAt !== undefined &&
          sim.clock.now() - askedSeenAt >= SLOW_ANSWER_AFTER_SEC
        ) {
          slow.answer(scripted.completeNow(asked).output);
          await sim.thinker?.idle();
          askedSeenAt = undefined;
        }
      }
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
      if (agents.some((agent) => agent.state === 'thinking')) seen.thinking += 1;
      if (agents.some((agent) => agent.state === 'walking')) seen.walking += 1;
      if (agents.some((agent) => agent.state === 'working')) seen.working += 1;
      if (truth.reports.some((report) => report.status === 'submitted')) seen.onDesk += 1;
      if (truth.orders.held > 0) seen.held += 1;
      if (truth.orders.cooking > 0) seen.cooking += 1;
      const customers = Object.values(truth.customers);
      if (customers.length > 0) seen.customers += 1;
      if (customers.some((customer) => customer.doneAt !== null)) seen.leaving += 1;
      if (customers.some((customer) => customer.complaint === 'open')) seen.upset += 1;
      if (Object.keys(truth.arrivals).length > 0) seen.walkingIn += 1;
      if (customers.some((customer) => customer.recordedAt !== null)) seen.recorded += 1;
      if (truth.review !== null) seen.reviewed += 1;
      if (truth.memories.length > 0) seen.noted += 1;
      if (truth.memories.some((note) => note.kind === 'reflection')) seen.reflected += 1;
      if (Object.values(truth.stock).some((row) => row.min_qty !== row.base_min_qty)) {
        seen.policyChanged += 1;
      }
      const complaints = Object.values(truth.complaints);
      if (complaints.some((complaint) => complaint.status === 'triaged')) seen.waitingForBoss += 1;
      if (complaints.some((complaint) => complaint.status === 'replied')) seen.answered += 1;
    }

    return seen;
  }
}

describe('the page state equals the server snapshot', () => {
  it('at every moment of a whole day, for a page that was there from the start and for one that joined late', async () => {
    const seen = await followDay(makeScenario(42), decideLikeTheTestBoss);
    // The day must have had something to compare: walks, work, a report on the desk, held orders, customers
    // waiting, leaving and upset, and complaints that were answered.
    expect(seen.cuts).toBeGreaterThan(1200);
    expect(seen.walking).toBeGreaterThan(40);
    expect(seen.working).toBeGreaterThan(500);
    expect(seen.onDesk).toBeGreaterThan(50);
    expect(seen.held).toBeGreaterThan(30);
    expect(seen.cooking).toBeGreaterThan(400);
    expect(seen.customers).toBeGreaterThan(800);
    expect(seen.leaving).toBeGreaterThan(600);
    expect(seen.upset).toBeGreaterThan(3);
    expect(seen.answered).toBeGreaterThan(3);
    expect(seen.walkingIn).toBeGreaterThan(200); // customers on their way from the door to the counter
    expect(seen.recorded).toBeGreaterThan(800);
    expect(seen.reviewed).toBeGreaterThan(50); // the review after closing: the notes and the change of policy
    expect(seen.noted).toBeGreaterThan(50);
    expect(seen.policyChanged).toBeGreaterThan(10);
  });

  it('also over two days with a model that helps the stock admin: the review, the notes and what came of a change', async () => {
    const seen = await followDay(makeScenario(42), () => 'approved', { days: 2, llm: true });
    expect(seen.cuts).toBeGreaterThan(3000);
    expect(seen.reviewed).toBeGreaterThan(1500);
    expect(seen.policyChanged).toBeGreaterThan(1500);
    expect(seen.reflected).toBeGreaterThan(250); // the night of day 1 judges the change of day 0
  });

  it('also over two days with a model that takes its time: she thinks for minutes, the clock runs, and the answer is applied later', async () => {
    const seen = await followDay(makeScenario(42), () => 'approved', { days: 2, slowModel: true });
    expect(seen.cuts).toBeGreaterThan(3000);
    expect(seen.thinking).toBeGreaterThan(60); // each question is open for at least 300 s: six cuts or more
    expect(seen.reviewed).toBeGreaterThan(1000);
    expect(seen.policyChanged).toBeGreaterThan(500);
  }, 60_000);

  it('also on a day of long waits, when complaints go to the boss and wait there for his decision', async () => {
    const seen = await followDay(
      makeScenario(42, { crowdPct: 250, complaintChancePct: 100, complaintWaitSec: 2400 }),
      decideLikeTheTestBoss,
    );
    expect(seen.waitingForBoss).toBeGreaterThan(20);
    expect(seen.answered).toBeGreaterThan(20);
  });
});
