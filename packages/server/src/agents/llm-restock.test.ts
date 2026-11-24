import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAKE_SCRIPT,
  FakeLLM,
  makeScenario,
  type FakeLine,
  type StoredEvent,
} from '@cafe/core';
import type { Db } from '../db/database';
import { readStock } from '../db/queries';
import { listEvents } from '../events/store';
import { FIRST_BOOT_START, bootSimulation } from '../sim/simulation';
import { createTestDb } from '../test-support/world';
import { transact } from '../usecases/context';
import { createOrder } from '../usecases/orders';

// The story of restock.test.ts (ten cups of coffee: the milk reaches its minimum and the admin goes to
// check the shelf), with a model that helps her decide (decision 034). Her proposal is written 135 s after
// the order came in.

const DECIDED = 45 + 90;

function boot(script: readonly FakeLine[] | undefined) {
  const db = createTestDb();
  const fake = script ? new FakeLLM(script) : undefined;
  const sim = bootSimulation({
    db,
    scenario: makeScenario(42, { crowdPct: 0 }),
    ...(fake && { llm: fake }),
  });
  createOrder(sim.ctx, { items: [{ menu_item_id: 'kopi_susu', qty: 10 }] });
  sim.clock.advance(FIRST_BOOT_START + DECIDED + 5 - sim.clock.now());
  return { db, sim, fake };
}

const log = (db: Db, ...types: string[]): StoredEvent[] =>
  listEvents(db).filter((event) => types.includes(event.type));

describe('a proposal of stock with a model', () => {
  it('is decided by the model: the decision, the report and the proposal say so, and the call is kept', () => {
    const { db, fake } = boot(DEFAULT_FAKE_SCRIPT);
    const [decided] = log(db, 'agent_decided');
    expect(decided).toMatchObject({ actor: 'stock_admin', origin: 'llm' });
    expect(decided?.payload).toMatchObject({ purpose: 'stock_proposal', llm_call_id: 1 });
    const [proposed] = log(db, 'restock_proposed');
    expect(proposed?.origin).toBe('llm');
    expect(proposed?.payload).toMatchObject({ items: [{ ingredient_id: 'susu', qty: 5000 }] });
    expect(fake?.calls).toHaveLength(1);
    expect(fake?.calls[0]?.request.context).toContain('Susu: stok');
    expect(db.prepare('SELECT valid, model FROM llm_calls').get()).toEqual({
      valid: 1,
      model: 'fake',
    });
  });

  it('writes the report for the boss from what the model decided, not from what the rule would have', () => {
    const script: FakeLine[] = [
      {
        purpose: 'stock_proposal',
        answer: () => ({
          items: [{ ingredient_id: 'susu', qty: 2000 }],
          urgency: 'high',
          rationale: 'Susu perlu ditambah sedikit.',
        }),
      },
    ];
    const { db } = boot(script);
    const [proposed] = log(db, 'restock_proposed');
    expect(proposed?.payload).toMatchObject({
      urgency: 'high',
      rationale: 'Susu perlu ditambah sedikit.',
    });
    const report = (proposed?.payload as { report: { title: string; body: string } }).report;
    expect(report.body).toContain('pesan 2000 ml');
    expect(report.body).toContain('Urgensi: tinggi');
  });

  it('still proposes, with the rules, when every answer of the model is refused, and the cafe goes on', () => {
    const { db, sim } = boot([
      {
        purpose: 'stock_proposal',
        answer: () => ({
          items: [{ ingredient_id: 'durian', qty: 10 }],
          urgency: 'normal',
          rationale: 'x',
        }),
      },
    ]);
    const [decided] = log(db, 'agent_decided');
    expect(decided).toMatchObject({ origin: 'fallback' });
    expect(decided?.payload).toMatchObject({ fallback_reason: 'unknown_id', attempts: 3 });
    const [proposed] = log(db, 'restock_proposed');
    expect(proposed?.origin).toBe('fallback');
    expect(proposed?.payload).toMatchObject({ items: [{ ingredient_id: 'susu', qty: 5000 }] }); // the rule: fill up
    // the boss can still decide, and the admin orders at the supplier: nothing is stuck
    sim.clock.advance(1000);
    transact(sim.ctx, (emit) =>
      emit({
        type: 'report_decided',
        actor: 'boss',
        origin: 'boss',
        payload: { report_id: 1, decision: 'approved' },
      }),
    );
    sim.clock.advance(200);
    expect(log(db, 'restock_ordered').length).toBeGreaterThan(0);
    expect(readStock(db).find((row) => row.ingredient_id === 'susu')?.qty).toBeLessThanOrEqual(
      2500,
    );
  });

  it('is exactly as before when there is no model: the rules decide', () => {
    const { db } = boot(undefined);
    expect(log(db, 'agent_decided')[0]?.origin).toBe('rule');
    expect(log(db, 'restock_proposed')[0]?.origin).toBe('rule');
    expect(db.prepare('SELECT COUNT(*) FROM llm_calls').pluck().get()).toBe(0);
  });
});
