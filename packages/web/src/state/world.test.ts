import { describe, expect, it } from 'vitest';
import type { ServerMessage, StoredEvent } from '@cafe/core';
import { RECENT_DONE_WINDOW_SEC } from '@cafe/core';
import {
  LOG_LIMIT,
  applyClock,
  applyEvent,
  applyMessage,
  applySnapshot,
  freezeClock,
  virtualNow,
} from './world';

import { TIME, agent, apply, event, snapshot, start } from './test-fixtures';

describe('applySnapshot', () => {
  it('turns the snapshot into state: agents, stock, order counts, reports and the log', () => {
    const state = applySnapshot(
      snapshot({
        agents: [
          {
            ...agent('stock_admin', 'boss_desk'),
            state: 'walking',
            from_station: 'stock_shelf',
            task: {
              id: 9,
              kind: 'goto',
              label: null,
              station: 'boss_desk',
              started_at_sim: 100,
              ends_at_sim: 350,
            },
          },
          {
            ...agent('cook', 'kitchen'),
            state: 'working',
            task: {
              id: 3,
              kind: 'work',
              label: 'cooking',
              station: null,
              started_at_sim: 200,
              ends_at_sim: 500,
            },
          },
        ],
        orders: { placed: 2, held: 1, cooking: 1, done: 5 },
        reports: [
          {
            id: 4,
            type: 'restock',
            status: 'submitted',
            title: 'Usul belanja: Susu',
            body: 'Isi sampai penuh',
            subject: {},
            created_at_sim: 120,
            submitted_at_sim: 400,
            decided_at_sim: null,
          },
        ],
      }),
      5000,
    );
    expect(state.clock).toEqual({ time: TIME, atMs: 5000 });
    expect(state.lastEventId).toBe(10);
    expect(state.agents.stock_admin).toEqual({
      id: 'stock_admin',
      state: 'walking',
      station: 'boss_desk',
      from: 'stock_shelf',
      label: null,
      taskId: 9,
      startedAt: 100,
      endsAt: 350,
    });
    expect(state.agents.cook).toMatchObject({ state: 'working', label: 'cooking', from: null });
    expect(state.orders).toEqual({ placed: 2, held: 1, cooking: 1, done: 5 });
    expect(state.stock.susu?.qty).toBe(2500);
    expect(state.reports).toEqual([
      {
        id: 4,
        type: 'restock',
        status: 'submitted',
        title: 'Usul belanja: Susu',
        body: 'Isi sampai penuh',
        createdAt: 120,
        submittedAt: 400,
      },
    ]);
  });
});

describe('applyEvent', () => {
  it('moves the position in the log and keeps the event for the log panel', () => {
    const created = event('order_created', { order_id: 1, source: 'walk_in', items: [] });
    const state = apply(start(), created);
    expect(state.lastEventId).toBe(created.id);
    expect(state.log.at(-1)).toBe(created);
  });

  it('skips an event that is already in the state, so a snapshot and the events may overlap', () => {
    const base = start();
    const old = {
      ...event('order_created', { order_id: 1, source: 'walk_in', items: [] }),
      id: 10,
    };
    expect(applyEvent(base, old as StoredEvent)).toBe(base);
    const once = apply(base, event('order_created', { order_id: 2, source: 'walk_in', items: [] }));
    const again = applyEvent(once, { ...once.log.at(-1) } as StoredEvent);
    expect(again.orders.placed).toBe(1);
  });

  it('keeps only the newest events in the log', () => {
    let state = start();
    for (let index = 0; index < LOG_LIMIT + 20; index += 1) {
      state = apply(state, event('day_opened', { day: index }));
    }
    expect(state.log).toHaveLength(LOG_LIMIT);
    expect(state.log.at(-1)?.id).toBe(state.lastEventId);
  });

  it('counts orders as they move: placed, held, cooking, done, and back from held', () => {
    let state = start();
    state = apply(state, event('order_created', { order_id: 1, source: 'walk_in', items: [] }));
    state = apply(state, event('order_created', { order_id: 2, source: 'walk_in', items: [] }));
    expect(state.orders).toEqual({ placed: 2, held: 0, cooking: 0, done: 0 });
    state = apply(state, event('cooking_started', { order_id: 1, duration_sim_sec: 100 }));
    state = apply(state, event('order_held', { order_id: 2, missing: [] }));
    expect(state.orders).toEqual({ placed: 0, held: 1, cooking: 1, done: 0 });
    state = apply(state, event('cooking_done', { order_id: 1 }));
    state = apply(state, event('order_resumed', { order_id: 2 }));
    expect(state.orders).toEqual({ placed: 1, held: 0, cooking: 0, done: 1 });
  });

  it('follows the stock: decreases, flags, and deliveries that clear a flag only past the limit', () => {
    let state = start();
    state = apply(
      state,
      event('stock_decreased', { ingredient_id: 'susu', qty: 1500, new_qty: 1000, order_id: 1 }),
    );
    state = apply(state, event('stock_low', { ingredient_id: 'susu', qty: 1000, min_qty: 1000 }));
    expect(state.stock.susu).toMatchObject({ qty: 1000, low: true, out: false });

    // 100 + 500 is still not above the limit of 1000: the flags stay (nasi is flagged low and out below)
    state = apply(state, event('stock_out', { ingredient_id: 'nasi' }));
    state = apply(
      state,
      event('restock_arrived', { restock_id: 1, items: [{ ingredient_id: 'nasi', qty: 500 }] }),
    );
    expect(state.stock.nasi).toMatchObject({ qty: 600, low: true, out: false });
    state = apply(
      state,
      event('restock_arrived', {
        restock_id: 2,
        items: [
          { ingredient_id: 'nasi', qty: 7000 },
          { ingredient_id: 'susu', qty: 5000 },
        ],
      }),
    );
    expect(state.stock.nasi).toMatchObject({ qty: 7600, low: false, out: false });
    expect(state.stock.susu).toMatchObject({ qty: 6000, low: false });
  });

  it('ignores stock events for an ingredient it does not know', () => {
    const base = start();
    const next = apply(base, event('stock_low', { ingredient_id: 'ghost', qty: 1, min_qty: 2 }));
    expect(next.stock).toBe(base.stock);
  });

  describe('agents', () => {
    const state = (type: 'idle' | 'walking' | 'working', extra: Record<string, unknown>) =>
      event('agent_state_changed', { agent_id: 'stock_admin', state: type, ...extra }, 31_000);

    it('walks from where the agent was to the station in the event, until the ETA', () => {
      const next = apply(
        start(),
        state('walking', { station: 'boss_desk', task_id: 5, eta_sim_time: 31_250 }),
      );
      expect(next.agents.stock_admin).toEqual({
        id: 'stock_admin',
        state: 'walking',
        station: 'boss_desk',
        from: 'stock_shelf',
        label: null,
        taskId: 5,
        startedAt: 31_000,
        endsAt: 31_250,
      });
    });

    it('starts the next walk from the station the last walk went to', () => {
      let next = apply(
        start(),
        state('walking', { station: 'boss_desk', task_id: 5, eta_sim_time: 31_250 }),
      );
      next = apply(
        next,
        state('walking', { station: 'stock_shelf', task_id: 6, eta_sim_time: 31_500 }),
      );
      expect(next.agents.stock_admin).toMatchObject({ station: 'stock_shelf', from: 'boss_desk' });
    });

    it('works at the station it is at, with the label of the task', () => {
      const next = apply(
        start(),
        state('working', {
          station: 'stock_shelf',
          task_id: 5,
          label: 'checking_stock',
          eta_sim_time: 31_090,
        }),
      );
      expect(next.agents.stock_admin).toMatchObject({
        state: 'working',
        station: 'stock_shelf',
        from: null,
        label: 'checking_stock',
        startedAt: 31_000,
        endsAt: 31_090,
      });
    });

    it('is idle with nothing left of the task', () => {
      let next = apply(
        start(),
        state('working', {
          station: 'stock_shelf',
          task_id: 5,
          label: 'checking_stock',
          eta_sim_time: 31_090,
        }),
      );
      next = apply(next, state('idle', { station: 'stock_shelf' }));
      expect(next.agents.stock_admin).toEqual({
        id: 'stock_admin',
        state: 'idle',
        station: 'stock_shelf',
        from: null,
        label: null,
        taskId: null,
        startedAt: null,
        endsAt: null,
      });
    });
  });

  describe('reports', () => {
    const proposed = (id: number) =>
      event(
        'restock_proposed',
        {
          report: { report_id: id, title: 'Usul belanja: Susu', body: 'Isi.' },
          items: [],
          urgency: 'normal',
          rationale: 'x',
        },
        31_000,
      );

    it('follows a report from the proposal to the boss desk and off it when the boss decided', () => {
      let state = apply(start(), proposed(1));
      expect(state.reports).toEqual([
        {
          id: 1,
          type: 'restock',
          status: 'drafted',
          title: 'Usul belanja: Susu',
          body: 'Isi.',
          createdAt: 31_000,
          submittedAt: null,
        },
      ]);
      state = apply(state, event('report_submitted', { report_id: 1 }, 31_300));
      expect(state.reports[0]).toMatchObject({ status: 'submitted', submittedAt: 31_300 });
      state = apply(state, event('report_decided', { report_id: 1, decision: 'approved' }));
      expect(state.reports).toEqual([]);
    });

    it('takes a complaint report from the triage, and no card when the cashier needs no boss', () => {
      const triage = (extra: Record<string, unknown>) =>
        event('complaint_triaged', {
          complaint_id: 1,
          category: 'slow_service',
          severity: 2,
          draft_reply: 'x',
          suggested_compensation: 'discount_10',
          needs_boss_decision: true,
          ...extra,
        });
      const withReport = apply(
        start(),
        triage({ report: { report_id: 7, title: 'Komplain', body: 'b' } }),
      );
      expect(withReport.reports).toMatchObject([{ id: 7, type: 'complaint', status: 'drafted' }]);
      const without = apply(start(), triage({ needs_boss_decision: false }));
      expect(without.reports).toEqual([]);
    });

    it('does nothing for a report it does not know', () => {
      const state = apply(start(), event('report_submitted', { report_id: 99 }));
      expect(state.reports).toEqual([]);
    });
  });
});

describe('applyMessage', () => {
  const message = (m: ServerMessage) => m;

  it('replaces the whole state with a snapshot, whatever came before', () => {
    const before = apply(
      start(),
      event('order_created', { order_id: 1, source: 'walk_in', items: [] }),
    );
    const next = applyMessage(
      before,
      message({ kind: 'snapshot', snapshot: snapshot({ last_event_id: 99 }) }),
      2000,
    );
    expect(next?.lastEventId).toBe(99);
    expect(next?.orders.placed).toBe(0);
    expect(next?.clock.atMs).toBe(2000);
  });

  it('has nothing to apply events or a clock to before the first snapshot', () => {
    expect(
      applyMessage(
        undefined,
        message({ kind: 'events', events: [event('day_opened', { day: 0 })] }),
        0,
      ),
    ).toBeUndefined();
    expect(applyMessage(undefined, message({ kind: 'clock', time: TIME }), 0)).toBeUndefined();
  });

  it('applies a batch of events in order, and the clock', () => {
    const batch = [
      event('order_created', { order_id: 1, source: 'walk_in', items: [] }),
      event('cooking_started', { order_id: 1, duration_sim_sec: 60 }),
    ];
    let next = applyMessage(start(), message({ kind: 'events', events: batch }), 0);
    expect(next?.orders).toEqual({ placed: 0, held: 0, cooking: 1, done: 0 });
    next = applyMessage(next, message({ kind: 'clock', time: { ...TIME, speed: 600 } }), 3000);
    expect(next?.clock).toEqual({ time: { ...TIME, speed: 600 }, atMs: 3000 });
  });
});

describe('virtualNow', () => {
  it('runs on from the last clock at the speed of the clock', () => {
    const clock = applyClock(start(), { ...TIME, speed: 60 }, 1000).clock;
    expect(virtualNow(clock, 1000)).toBe(30_000);
    expect(virtualNow(clock, 1500)).toBe(30_030); // half a real second is 30 virtual seconds
    expect(virtualNow(applyClock(start(), { ...TIME, speed: 600 }, 1000).clock, 1250)).toBe(30_150);
  });

  it('stands still while paused', () => {
    const clock = applyClock(start(), { ...TIME, paused: true }, 1000).clock;
    expect(virtualNow(clock, 9000)).toBe(30_000);
  });
});

describe('freezeClock', () => {
  it('stops the clock at the time it had, so nothing runs on without the server', () => {
    const running = applyClock(start(), { ...TIME, sim_time: 30_000, speed: 60 }, 1000);
    const frozen = freezeClock(running, 3000); // two real seconds later: 120 virtual seconds
    expect(frozen.clock.time.paused).toBe(true);
    expect(virtualNow(frozen.clock, 3000)).toBe(30_120);
    expect(virtualNow(frozen.clock, 99_000)).toBe(30_120);
  });

  it('leaves a clock that is paused already as it is', () => {
    const paused = applyClock(start(), { ...TIME, paused: true }, 1000);
    expect(freezeClock(paused, 5000)).toBe(paused);
  });

  it('is replaced by the snapshot of the reconnect, which has the running clock again', () => {
    const frozen = freezeClock(start(), 4000);
    const next = applyMessage(frozen, { kind: 'snapshot', snapshot: snapshot() }, 5000);
    expect(next?.clock.time.paused).toBe(false);
  });
});

describe('customers', () => {
  const placed = (order_id: number, sim_time = 30_100) =>
    event('order_created', { order_id, source: 'walk_in', items: [] }, sim_time);

  it('comes from the orders of the snapshot, with the complaints that are still open', () => {
    const state = applySnapshot(
      snapshot({
        recent_orders: [
          {
            id: 4,
            status: 'cooking',
            source: 'walk_in',
            created_at_sim: 29_000,
            done_at_sim: null,
          },
          { id: 5, status: 'done', source: 'walk_in', created_at_sim: 29_100, done_at_sim: 29_900 },
        ],
        complaints: [
          {
            complaint_id: 2,
            order_id: 4,
            cause: 'slow_service',
            status: 'received',
            received_at_sim: 29_500,
            replied_at_sim: null,
            compensation: null,
          },
          {
            complaint_id: 1,
            order_id: 5,
            cause: 'quality',
            status: 'replied',
            received_at_sim: 29_200,
            replied_at_sim: 29_400,
            compensation: 'discount_10',
          },
        ],
      }),
      0,
    );
    expect(state.customers).toEqual({
      4: {
        orderId: 4,
        source: 'walk_in',
        status: 'cooking',
        createdAt: 29_000,
        doneAt: null,
        complaint: 'open',
      },
      5: {
        orderId: 5,
        source: 'walk_in',
        status: 'done',
        createdAt: 29_100,
        doneAt: 29_900,
        complaint: 'none',
      },
    });
    expect(state.complaints).toEqual({
      2: {
        id: 2,
        orderId: 4,
        cause: 'slow_service',
        status: 'received',
        receivedAt: 29_500,
        repliedAt: null,
        compensation: null,
      },
      1: {
        id: 1,
        orderId: 5,
        cause: 'quality',
        status: 'replied',
        receivedAt: 29_200,
        repliedAt: 29_400,
        compensation: 'discount_10',
      },
    });
    // a customer is upset only about a complaint that is not answered yet
    expect(state.customers[5]?.complaint).toBe('none');
  });

  it('gets a customer when an order comes in, and follows the order until it is done', () => {
    let state = apply(start(), placed(7, 30_100));
    expect(state.customers[7]).toEqual({
      orderId: 7,
      source: 'walk_in',
      status: 'placed',
      createdAt: 30_100,
      doneAt: null,
      complaint: 'none',
    });
    state = apply(state, event('cooking_started', { order_id: 7, duration_sim_sec: 100 }, 30_200));
    expect(state.customers[7]?.status).toBe('cooking');
    state = apply(state, event('cooking_done', { order_id: 7 }, 30_300));
    expect(state.customers[7]).toMatchObject({ status: 'done', doneAt: 30_300 });
  });

  it('waits when the order is held for want of ingredients, and goes on when it is resumed', () => {
    let state = apply(start(), placed(8));
    state = apply(state, event('order_held', { order_id: 8, missing: [] }));
    expect(state.customers[8]?.status).toBe('held');
    state = apply(state, event('order_resumed', { order_id: 8 }));
    expect(state.customers[8]?.status).toBe('placed');
  });

  it('is upset from a complaint until the cashier answers it', () => {
    let state = apply(start(), placed(9));
    state = apply(
      state,
      event('complaint_received', { complaint_id: 3, order_id: 9, cause: 'slow_service' }, 30_500),
    );
    expect(state.customers[9]?.complaint).toBe('open');
    expect(state.complaints[3]).toEqual({
      id: 3,
      orderId: 9,
      cause: 'slow_service',
      status: 'received',
      receivedAt: 30_500,
      repliedAt: null,
      compensation: null,
    });
    state = apply(
      state,
      event(
        'complaint_replied',
        { complaint_id: 3, compensation: 'none', reply_text: 'x' },
        30_560,
      ),
    );
    expect(state.customers[9]?.complaint).toBe('none');
    expect(state.complaints[3]).toMatchObject({
      status: 'replied',
      repliedAt: 30_560,
      compensation: 'none',
    });
  });

  it('shows the proposal of the cashier on a complaint that waits for the boss', () => {
    let state = apply(
      apply(start(), placed(9)),
      event('complaint_received', { complaint_id: 3, order_id: 9, cause: 'quality' }, 30_500),
    );
    state = apply(
      state,
      event(
        'complaint_triaged',
        {
          complaint_id: 3,
          category: 'quality',
          severity: 2,
          suggested_compensation: 'discount_10',
          draft_reply: 'maaf',
          needs_boss_decision: true,
        },
        30_560,
      ),
    );
    expect(state.complaints[3]).toMatchObject({ status: 'triaged', compensation: 'discount_10' });
    expect(state.customers[9]?.complaint).toBe('open'); // still not answered
  });

  it('ignores what is about an order or a complaint it does not know', () => {
    const base = start();
    expect(apply(base, event('cooking_done', { order_id: 99 })).customers).toEqual({});
    expect(
      apply(
        base,
        event('complaint_replied', { complaint_id: 99, compensation: 'none', reply_text: 'x' }),
      ).complaints,
    ).toEqual({});
  });

  it('forgets a customer that has been gone for long, and never one that is still waiting', () => {
    let state = apply(start(), placed(1, 30_000), placed(2, 30_000));
    state = apply(state, event('cooking_started', { order_id: 1, duration_sim_sec: 1 }, 30_001));
    state = apply(state, event('cooking_done', { order_id: 1 }, 30_100));
    expect(Object.keys(state.customers)).toEqual(['1', '2']);
    state = apply(state, event('day_opened', { day: 0 }, 30_100 + 2 * RECENT_DONE_WINDOW_SEC + 1));
    expect(Object.keys(state.customers)).toEqual(['2']); // order 2 is still waiting, however old
  });
});
