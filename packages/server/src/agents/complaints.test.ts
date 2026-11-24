import { describe, expect, it } from 'vitest';
import { makeScenario, walkDurationSec, type StoredEvent } from '@cafe/core';
import type { Db } from '../db/database';
import { listEvents } from '../events/store';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import { FIRST_BOOT_START, bootSimulation, type Simulation } from '../sim/simulation';
import { createTestDb } from '../test-support/world';
import { transact } from '../usecases/context';
import { createOrder } from '../usecases/orders';
import { readAgent } from './engine';

const START = FIRST_BOOT_START;
const TO_BOSS = walkDurationSec('cashier', 'boss_desk'); // 132 s, and the same way back
const NOTE = 60;
const SUBMIT = 60;
const REPLY = 60;

/**
 * A customer ordered ten plates of nasi goreng (80 minutes of cooking), so the order is still not served
 * when the customer complains. Everyone who waited complains (chance 100%) once the wait is long enough.
 */
function world(complaintWaitSec: number) {
  const db = createTestDb();
  const scenario = makeScenario(42, { crowdPct: 0, complaintChancePct: 100, complaintWaitSec });
  const sim = bootSimulation({ db, scenario });
  const order_id = createOrder(sim.ctx, {
    items: [{ menu_item_id: 'nasi_goreng', qty: 10 }],
  }).order_id;
  return { db, sim, scenario, order_id };
}

const runTo = (sim: Simulation, seconds: number) =>
  sim.clock.advance(START + seconds - sim.clock.now());

function decide(sim: Simulation, report_id: number, decision: 'approved' | 'rejected'): void {
  transact(sim.ctx, (emit) =>
    emit({
      type: 'report_decided',
      actor: 'boss',
      origin: 'boss',
      payload: { report_id, decision },
    }),
  );
}

const of = (db: Db, ...types: string[]): StoredEvent[] =>
  listEvents(db).filter((event) => types.includes(event.type));
const at = (event: StoredEvent | undefined) => (event ? event.sim_time - START : undefined);

// With a wait limit of 2700 s the complaint arrives at the first minute check after 45 minutes of
// waiting, which is 2700 s after the order (a check falls on every full minute).
const COMPLAINT_AT_45 = 2700;

describe('a mild complaint (under 40 minutes): the cashier apologises by herself', () => {
  it('notes the complaint, and answers at once without troubling the boss', () => {
    const { db, sim, order_id } = world(1200);
    runTo(sim, 1200 + NOTE + 10);

    expect(at(of(db, 'complaint_received')[0])).toBe(1200);
    const triaged = of(db, 'complaint_triaged')[0] as StoredEvent;
    expect(at(triaged)).toBe(1200 + NOTE);
    expect(triaged.payload).toMatchObject({
      complaint_id: 1,
      category: 'slow_service',
      severity: 1,
      suggested_compensation: 'none',
      needs_boss_decision: false,
    });
    expect('report' in triaged.payload).toBe(false);
    const replied = of(db, 'complaint_replied')[0] as StoredEvent;
    expect(at(replied)).toBe(1200 + NOTE); // the same moment
    expect(replied.payload).toEqual({
      complaint_id: 1,
      compensation: 'none',
      reply_text: `Mohon maaf atas keterlambatan pesanan #${order_id}. Terima kasih atas kesabaran Anda.`,
    });
    expect(of(db, 'report_submitted')).toHaveLength(0);
    expect(db.prepare('SELECT status FROM complaints').pluck().get()).toBe('replied');
  });

  it('shows the cashier working on the note, and the decision as a think request and a decision', () => {
    const { db, sim } = world(1200);
    runTo(sim, 1200 + 30);
    expect(readAgent(db, 'cashier').state).toBe('working');
    runTo(sim, 1200 + NOTE);
    const think = of(db, 'agent_think_requested')[0] as StoredEvent;
    const decided = of(db, 'agent_decided')[0] as StoredEvent;
    expect(think.payload).toMatchObject({
      agent_id: 'cashier',
      purpose: 'complaint_triage',
      subject: { complaint_id: 1 },
    });
    expect(decided.payload).toMatchObject({
      purpose: 'complaint_triage',
      think_event_id: think.id,
    });
    expect(decided.origin).toBe('rule');
  });
});

describe('a complaint that needs the boss', () => {
  it('carries a report to the boss desk, hands it in, and walks back', () => {
    const { db, sim } = world(COMPLAINT_AT_45);
    const triagedAt = COMPLAINT_AT_45 + NOTE;
    runTo(sim, triagedAt);
    const triaged = of(db, 'complaint_triaged')[0] as StoredEvent;
    expect(triaged.payload).toMatchObject({
      severity: 2,
      suggested_compensation: 'discount_10',
      needs_boss_decision: true,
      report: { report_id: 1, title: 'Komplain: layanan lambat (pesanan #1)' },
    });
    expect(of(db, 'complaint_replied')).toHaveLength(0);

    const submittedAt = triagedAt + TO_BOSS + SUBMIT;
    runTo(sim, submittedAt);
    expect(at(of(db, 'report_submitted')[0])).toBe(submittedAt);
    expect(of(db, 'report_submitted')[0]?.actor).toBe('cashier');
    runTo(sim, submittedAt + TO_BOSS);
    expect(readAgent(db, 'cashier')).toMatchObject({ state: 'idle', station: 'cashier' });
  });

  it('answers with the compensation after the boss approves', () => {
    const { db, sim, order_id } = world(COMPLAINT_AT_45);
    const submittedAt = COMPLAINT_AT_45 + NOTE + TO_BOSS + SUBMIT;
    runTo(sim, submittedAt + 5);
    decide(sim, 1, 'approved');
    runTo(sim, submittedAt + TO_BOSS + REPLY + 5);

    const replied = of(db, 'complaint_replied')[0] as StoredEvent;
    // She was walking back when the boss decided, so she answers once she is at her desk.
    expect(at(replied)).toBe(submittedAt + TO_BOSS + REPLY);
    expect(replied.payload).toEqual({
      complaint_id: 1,
      compensation: 'discount_10',
      reply_text: `Mohon maaf atas keterlambatan pesanan #${order_id}. Kami beri diskon 10% untuk pesanan berikutnya.`,
    });
    expect(db.prepare('SELECT status, final_compensation FROM complaints').get()).toEqual({
      status: 'replied',
      final_compensation: 'discount_10',
    });
  });

  it('answers without compensation after the boss rejects', () => {
    const { db, sim } = world(COMPLAINT_AT_45);
    const submittedAt = COMPLAINT_AT_45 + NOTE + TO_BOSS + SUBMIT;
    runTo(sim, submittedAt + 5);
    decide(sim, 1, 'rejected');
    runTo(sim, submittedAt + TO_BOSS + REPLY + 5);
    expect((of(db, 'complaint_replied')[0]?.payload as { compensation: string }).compensation).toBe(
      'none',
    );
    expect(db.prepare('SELECT final_compensation FROM complaints').pluck().get()).toBe('none');
  });

  it('offers a free item when the customer waited more than an hour', () => {
    const { db, sim } = world(3700);
    runTo(sim, 3720 + NOTE + 5);
    expect(of(db, 'complaint_triaged')[0]?.payload).toMatchObject({
      severity: 3,
      suggested_compensation: 'free_item',
      needs_boss_decision: true,
    });
    runTo(sim, 3720 + NOTE + TO_BOSS + SUBMIT + 5);
    decide(sim, 1, 'approved');
    runTo(sim, 3720 + NOTE + TO_BOSS + SUBMIT + TO_BOSS + REPLY + 5);
    expect((of(db, 'complaint_replied')[0]?.payload as { compensation: string }).compensation).toBe(
      'free_item',
    );
  });

  it('keeps waiting while the boss does not decide: the customer gets no answer yet', () => {
    const { db, sim } = world(COMPLAINT_AT_45);
    runTo(sim, COMPLAINT_AT_45 + 20000);
    expect(db.prepare('SELECT status FROM reports WHERE id = 1').pluck().get()).toBe('submitted');
    expect(db.prepare('SELECT status FROM complaints').pluck().get()).toBe('triaged');
    expect(of(db, 'complaint_replied')).toHaveLength(0);
    expect(readAgent(db, 'cashier').state).toBe('idle');
  });
});

describe('restarting in the middle of a complaint', () => {
  const DECIDE_AT = COMPLAINT_AT_45 + NOTE + TO_BOSS + SUBMIT + 30;
  const END = DECIDE_AT + 1500;

  function story(restartAt?: number) {
    const { db, sim: first, scenario } = world(COMPLAINT_AT_45);
    let sim = first;
    const restart = () => {
      sim = bootSimulation({ db, scenario });
      expect(sim.recovered).toBe(true);
    };
    if (restartAt !== undefined && restartAt < DECIDE_AT) {
      runTo(sim, restartAt);
      restart();
    }
    runTo(sim, DECIDE_AT);
    decide(sim, 1, 'approved');
    if (restartAt !== undefined && restartAt >= DECIDE_AT) {
      runTo(sim, restartAt);
      restart();
    }
    runTo(sim, END);
    return { db, log: listEvents(db) };
  }

  const straight = story();

  it('has a story worth checking: a complaint, a report, a decision and an answer', () => {
    const types = straight.log.map((event) => event.type);
    for (const type of [
      'complaint_received',
      'complaint_triaged',
      'report_submitted',
      'report_decided',
      'complaint_replied',
    ]) {
      expect(types, type).toContain(type);
    }
  });

  it.each([
    1,
    100,
    COMPLAINT_AT_45 - 1,
    COMPLAINT_AT_45,
    COMPLAINT_AT_45 + 30,
    COMPLAINT_AT_45 + NOTE,
    COMPLAINT_AT_45 + NOTE + 100,
    DECIDE_AT - 1,
    DECIDE_AT,
    DECIDE_AT + 40,
    DECIDE_AT + 250,
    END - 1,
  ])('gives the identical log when the server restarts at %i s', (restartAt) => {
    expect(story(restartAt).log).toEqual(straight.log);
  });

  it('builds the same state from the log as the live run has', () => {
    const live = snapshotProjections(straight.db);
    rebuildProjections(straight.db);
    expect(snapshotProjections(straight.db)).toEqual(live);
  });
});
