import { describe, expect, it } from 'vitest';
import { EVENT_META, EVENT_TYPES, eventSchema, type EventType } from './index';

interface Raw {
  type: string;
  sim_time: number;
  actor: string;
  origin: string;
  payload: Record<string, unknown>;
}

function ev(
  type: string,
  actor: string,
  origin: string,
  payload: Record<string, unknown>,
  sim_time = 28800,
): Raw {
  return { type, sim_time, actor, origin, payload };
}

const report = { report_id: 1, title: 'Usul belanja susu', body: 'Susu tinggal 400 ml.' };
const items = [{ ingredient_id: 'susu', qty: 2000 }];
const triage = {
  category: 'slow_service',
  severity: 2,
  draft_reply: 'Maaf atas keterlambatannya.',
  suggested_compensation: 'discount_10',
  needs_boss_decision: true,
};

// One valid example per event type. The Record type makes TypeScript fail if a type is missing.
const FIXTURES: Record<EventType, Raw> = {
  world_initialized: ev(
    'world_initialized',
    'system',
    'system',
    { seed: 42, initial_stock: { susu: 2500 }, initial_visits: { pak_budi: 3 } },
    0,
  ),
  day_opened: ev('day_opened', 'system', 'scheduler', { day: 0 }),
  day_closed: ev('day_closed', 'system', 'scheduler', { day: 0 }, 72000),
  sim_time_advanced: ev('sim_time_advanced', 'boss', 'boss', { from: 28800, to: 30600 }),
  customer_arrived: ev('customer_arrived', 'world', 'generator', { customer_id: 48100 }),
  order_created: ev('order_created', 'world', 'generator', {
    order_id: 1,
    source: 'walk_in',
    customer_id: 48100,
    items: [{ menu_item_id: 'kopi_susu', qty: 1 }],
  }),
  order_held: ev('order_held', 'cook', 'rule', {
    order_id: 2,
    missing: [{ ingredient_id: 'susu', needed: 150, available: 100 }],
  }),
  order_resumed: ev('order_resumed', 'system', 'rule', { order_id: 2 }),
  cooking_started: ev('cooking_started', 'cook', 'rule', { order_id: 1, duration_sim_sec: 180 }),
  stock_decreased: ev('stock_decreased', 'cook', 'rule', {
    ingredient_id: 'susu',
    qty: 150,
    new_qty: 2350,
    order_id: 1,
  }),
  cooking_done: ev('cooking_done', 'cook', 'rule', { order_id: 1 }),
  stock_low: ev('stock_low', 'system', 'rule', { ingredient_id: 'susu', qty: 900, min_qty: 1000 }),
  stock_out: ev('stock_out', 'system', 'rule', { ingredient_id: 'teh' }),
  restock_proposed: ev('restock_proposed', 'stock_admin', 'llm', {
    report,
    items,
    urgency: 'normal',
    rationale: 'Susu hampir habis sebelum jam makan siang.',
  }),
  report_submitted: ev('report_submitted', 'stock_admin', 'rule', { report_id: 1 }),
  report_decided: ev('report_decided', 'boss', 'boss', { report_id: 1, decision: 'approved' }),
  restock_ordered: ev('restock_ordered', 'stock_admin', 'generator', {
    restock_id: 1,
    report_id: 1,
    items,
    supplier: 'late',
    eta_sim_time: 36000,
  }),
  restock_arrived: ev('restock_arrived', 'world', 'generator', { restock_id: 1, items }),
  restock_failed: ev('restock_failed', 'world', 'generator', {
    restock_id: 2,
    reason: 'supplier_out',
  }),
  complaint_received: ev('complaint_received', 'world', 'generator', {
    complaint_id: 1,
    order_id: 1,
    cause: 'slow_service',
  }),
  complaint_triaged: ev('complaint_triaged', 'cashier', 'llm', {
    complaint_id: 1,
    ...triage,
    report: { report_id: 2, title: 'Komplain pelanggan', body: 'Pesanan telat 15 menit.' },
  }),
  complaint_replied: ev('complaint_replied', 'cashier', 'rule', {
    complaint_id: 1,
    compensation: 'discount_10',
    reply_text: 'Maaf, diskon 10% untuk pesanan berikutnya.',
  }),
  regular_expected: ev('regular_expected', 'system', 'scheduler', {
    regular_id: 'pak_budi',
    table_id: 1,
    expected_at: 30600,
  }),
  regular_arrived: ev('regular_arrived', 'world', 'scheduler', {
    regular_id: 'pak_budi',
    table_id: 1,
  }),
  regular_greeted: ev('regular_greeted', 'waiter', 'rule', {
    regular_id: 'pak_budi',
    text: 'Selamat datang lagi, Pak Budi! Kopi susu kurang gula seperti biasa?',
  }),
  regular_left: ev('regular_left', 'world', 'rule', { regular_id: 'pak_budi', table_id: 1 }),
  table_prepared: ev('table_prepared', 'waiter', 'llm', { table_id: 1, regular_id: 'pak_budi' }),
  table_tidied: ev('table_tidied', 'waiter', 'fallback', { table_id: 2 }),
  reflection_created: ev('reflection_created', 'waiter', 'rule', {
    regular_id: 'pak_budi',
    text: 'Pelanggan tetap, biasanya datang sekitar 08:30 dan pesan kopi susu.',
  }),
  agent_think_requested: ev('agent_think_requested', 'stock_admin', 'rule', {
    agent_id: 'stock_admin',
    purpose: 'stock_proposal',
    subject: { ingredient_ids: ['susu'] },
  }),
  agent_decided: ev('agent_decided', 'waiter', 'llm', {
    agent_id: 'waiter',
    purpose: 'waiter_initiative',
    think_event_id: 10,
    llm_call_id: 3,
    decision: {
      action: 'prepare_table',
      table_id: 1,
      regular_id: 'pak_budi',
      reason: 'Pak Budi biasanya datang sekitar 08:30.',
    },
  }),
  agent_task_assigned: ev('agent_task_assigned', 'cook', 'rule', {
    agent_id: 'cook',
    task_id: 1,
    kind: 'work',
    label: 'cooking',
    duration_sim_sec: 180,
    ref: { type: 'order', id: 1 },
  }),
  agent_task_finished: ev('agent_task_finished', 'cook', 'rule', { agent_id: 'cook', task_id: 1 }),
  agent_state_changed: ev('agent_state_changed', 'cook', 'rule', {
    agent_id: 'cook',
    state: 'working',
    station: 'kitchen',
    task_id: 1,
    label: 'cooking',
    eta_sim_time: 28980,
  }),
};

/** Copy of a fixture with some fields replaced. */
function variant(
  type: EventType,
  changes: {
    actor?: string;
    origin?: string;
    sim_time?: number;
    payload?: Record<string, unknown>;
  },
): Raw {
  const base = FIXTURES[type];
  return {
    ...base,
    ...(changes.actor !== undefined && { actor: changes.actor }),
    ...(changes.origin !== undefined && { origin: changes.origin }),
    ...(changes.sim_time !== undefined && { sim_time: changes.sim_time }),
    payload: { ...base.payload, ...changes.payload },
  };
}

function issuePaths(raw: unknown): string[] {
  const result = eventSchema.safeParse(raw);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.'));
}

function expectRejected(raw: unknown, path?: string) {
  const paths = issuePaths(raw);
  expect(paths.length, 'expected the event to be rejected').toBeGreaterThan(0);
  if (path !== undefined) expect(paths).toContain(path);
}

describe('event catalog', () => {
  it('has 34 event types and a fixture for each', () => {
    expect(EVENT_TYPES).toHaveLength(34);
    expect(Object.keys(FIXTURES).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it.each(EVENT_TYPES)('accepts a valid %s', (type) => {
    const result = eventSchema.safeParse(FIXTURES[type]);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data?.type).toBe(type);
  });

  it('allows every origin and actor listed in EVENT_META', () => {
    for (const type of EVENT_TYPES) {
      for (const origin of EVENT_META[type].origins) {
        if (type === 'agent_decided' || type === 'agent_task_assigned') continue; // need extra fields
        const raw = variant(type, { origin });
        // fallback needs a reason on decisions; other event types do not
        expect(
          issuePaths(raw).filter((path) => path === 'origin'),
          `${type}/${origin}`,
        ).toEqual([]);
      }
    }
  });
});

describe('event validation', () => {
  it('rejects an unknown event type', () => {
    expectRejected(ev('order_teleported', 'system', 'rule', {}));
  });

  it('rejects a sim_time that is not a non-negative integer', () => {
    expectRejected(variant('day_opened', { sim_time: 28800.5 }), 'sim_time');
    expectRejected(variant('day_opened', { sim_time: -1 }), 'sim_time');
  });

  it('rejects an origin that is not allowed for the type', () => {
    expectRejected(variant('report_decided', { origin: 'rule' }), 'origin');
    expectRejected(variant('day_opened', { origin: 'boss' }), 'origin');
    expectRejected(variant('day_opened', { origin: 'magic' }), 'origin');
  });

  it('rejects an actor that is not allowed for the type', () => {
    expectRejected(variant('cooking_started', { actor: 'waiter' }), 'actor');
  });

  it('requires agent events to be performed by the agent they are about', () => {
    expectRejected(variant('agent_task_finished', { actor: 'waiter' }), 'actor');
    expectRejected(variant('agent_state_changed', { actor: 'cashier' }), 'actor');
  });

  it('requires regular details only for regular orders', () => {
    const regularOrder = {
      source: 'regular',
      items: [{ menu_item_id: 'kopi_susu', qty: 1 }],
    };
    expectRejected(variant('order_created', { payload: regularOrder }), 'payload.regular_id');
    expectRejected(variant('order_created', { payload: regularOrder }), 'payload.table_id');
    const complete = variant('order_created', {
      actor: 'waiter',
      origin: 'rule',
      payload: { ...regularOrder, regular_id: 'pak_budi', table_id: 1 },
    });
    expect(eventSchema.safeParse(complete).success).toBe(true);
  });

  it('rejects fractional, zero or negative quantities and empty lists', () => {
    expectRejected(variant('stock_decreased', { payload: { qty: 1.5 } }), 'payload.qty');
    expectRejected(variant('stock_decreased', { payload: { qty: 0 } }), 'payload.qty');
    expectRejected(variant('stock_decreased', { payload: { new_qty: -1 } }), 'payload.new_qty');
    expectRejected(variant('restock_arrived', { payload: { items: [] } }), 'payload.items');
    expectRejected(
      variant('restock_arrived', { payload: { items: [{ ingredient_id: 'susu', qty: -5 }] } }),
    );
    expectRejected(variant('order_created', { payload: { items: [] } }), 'payload.items');
  });

  it('rejects a table that does not exist', () => {
    expectRejected(variant('regular_arrived', { payload: { table_id: 4 } }), 'payload.table_id');
  });

  it('requires stock_low to be at or below the minimum', () => {
    expectRejected(variant('stock_low', { payload: { qty: 1500 } }), 'payload.qty');
  });

  it('requires sim_time_advanced to move forward', () => {
    expectRejected(
      variant('sim_time_advanced', { payload: { from: 30600, to: 30600 } }),
      'payload.to',
    );
  });

  it('ties the restock ETA to the supplier outcome', () => {
    expectRejected(
      variant('restock_ordered', { payload: { supplier: 'out', eta_sim_time: 36000 } }),
      'payload.eta_sim_time',
    );
    expectRejected(
      variant('restock_ordered', { payload: { supplier: 'late', eta_sim_time: null } }),
      'payload.eta_sim_time',
    );
    const outOfStock = variant('restock_ordered', {
      payload: { supplier: 'out', eta_sim_time: null },
    });
    expect(eventSchema.safeParse(outOfStock).success).toBe(true);
  });

  it('ties the complaint report to needs_boss_decision', () => {
    expectRejected(
      variant('complaint_triaged', { payload: { report: undefined } }),
      'payload.report',
    );
    expectRejected(
      variant('complaint_triaged', { payload: { needs_boss_decision: false } }),
      'payload.report',
    );
    const direct = variant('complaint_triaged', {
      payload: { needs_boss_decision: false, report: undefined },
    });
    expect(eventSchema.safeParse(direct).success).toBe(true);
  });

  it('requires a station for goto tasks', () => {
    expectRejected(
      variant('agent_task_assigned', { payload: { kind: 'goto', label: undefined } }),
      'payload.station',
    );
    const goto = variant('agent_task_assigned', {
      payload: { kind: 'goto', station: 'boss_desk', label: undefined, duration_sim_sec: 132 },
    });
    expect(eventSchema.safeParse(goto).success).toBe(true);
  });

  it('ties fallback_reason to the fallback origin', () => {
    expectRejected(variant('agent_decided', { origin: 'fallback' }), 'payload.fallback_reason');
    expectRejected(
      variant('agent_decided', { payload: { fallback_reason: 'timeout' } }),
      'payload.fallback_reason',
    );
    const fellBack = variant('agent_decided', {
      origin: 'fallback',
      payload: { fallback_reason: 'invalid_enum', llm_call_id: undefined, attempts: 3 },
    });
    expect(eventSchema.safeParse(fellBack).success).toBe(true);
  });

  it('checks the decision against the purpose of agent_decided', () => {
    expectRejected(
      variant('agent_decided', { payload: { purpose: 'greeting' } }),
      'payload.decision.text',
    );
    expectRejected(
      variant('agent_decided', {
        payload: { decision: { action: 'prepare_table', reason: 'tanpa meja' } },
      }),
      'payload.decision.table_id',
    );
    expectRejected(
      variant('agent_decided', { payload: { decision: { action: 'dance', reason: 'x' } } }),
    );
  });

  it('rejects texts that are too long', () => {
    expectRejected(
      variant('regular_greeted', { payload: { text: 'a'.repeat(201) } }),
      'payload.text',
    );
    expectRejected(
      variant('restock_proposed', { payload: { rationale: 'a'.repeat(201) } }),
      'payload.rationale',
    );
  });
});
