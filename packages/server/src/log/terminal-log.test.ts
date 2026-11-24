import { describe, expect, it } from 'vitest';
import type { Event, StoredEvent } from '@cafe/core';
import { ev } from '../test-support/events';
import { formatEvent } from './terminal-log';

function stored(event: Event, id = 1): StoredEvent {
  return { ...event, id } as StoredEvent;
}

/** The documented layout: clock, [label] (11 wide), type (21 wide), details. */
function line(clock: string, label: string, type: string, details: string): string {
  return `${clock}  ${`[${label}]`.padEnd(11)}  ${type.padEnd(21)}  ${details}`;
}

describe('formatEvent', () => {
  it('prints one aligned line per event', () => {
    expect(formatEvent(stored(ev.orderCreated(1)))).toBe(
      '08:00  [Trigger]    order_created          order_id=1 source=walk_in items=kopi_susu×1',
    );
  });

  it('shows the label that belongs to the origin', () => {
    expect(formatEvent(stored(ev.stockDecreased(1, 'susu', 150, 2350)))).toBe(
      line(
        '08:00',
        'Aturan',
        'stock_decreased',
        'ingredient_id=susu qty=150 new_qty=2350 order_id=1',
      ),
    );
    const decided: Event = {
      type: 'report_decided',
      sim_time: 30600,
      actor: 'boss',
      origin: 'boss',
      payload: { report_id: 1, decision: 'approved' },
    };
    expect(formatEvent(stored(decided))).toBe(
      line('08:30', 'Bos', 'report_decided', 'report_id=1 decision=approved'),
    );
    const prepared: Event = {
      type: 'table_prepared',
      sim_time: 30000,
      actor: 'waiter',
      origin: 'llm',
      payload: { table_id: 1 },
    };
    expect(formatEvent(stored(prepared))).toBe(
      line('08:20', 'Inisiatif', 'table_prepared', 'table_id=1'),
    );
  });

  it('spells out shortages in a held order', () => {
    expect(
      formatEvent(stored(ev.orderHeld(3, [{ ingredient_id: 'nasi', needed: 200, available: 0 }]))),
    ).toBe(line('08:00', 'Aturan', 'order_held', 'order_id=3 missing=nasi(need 200, have 0)'));
  });

  it('keeps the world_initialized line short', () => {
    const world: Event = {
      type: 'world_initialized',
      sim_time: 0,
      actor: 'system',
      origin: 'system',
      payload: {
        seed: 42,
        initial_stock: Object.fromEntries(
          ['kopi', 'susu', 'gula', 'teh', 'nasi', 'telur', 'roti', 'mie'].map((id) => [id, 1000]),
        ),
        initial_visits: { pak_budi: 3 },
      },
    };
    expect(formatEvent(stored(world))).toBe(
      line(
        '00:00',
        'Aturan',
        'world_initialized',
        'seed=42 initial_stock={8 entries} initial_visits={"pak_budi":3}',
      ),
    );
  });

  it('hides the plumbing events', () => {
    const state: Event = {
      type: 'agent_state_changed',
      sim_time: 28800,
      actor: 'cook',
      origin: 'rule',
      payload: { agent_id: 'cook', state: 'idle', station: 'kitchen' },
    };
    expect(formatEvent(stored(state))).toBeNull();
  });

  it('shows a virtual time as a clock, and cuts a long text', () => {
    expect(
      formatEvent(
        stored(ev.restockOrdered(1, 1, [{ ingredient_id: 'susu', qty: 5000 }], 'late', 30600)),
      ),
    ).toBe(
      line(
        '08:00',
        'Trigger',
        'restock_ordered',
        'restock_id=1 report_id=1 items=susu×5000 supplier=late eta_sim_time=08:30',
      ),
    );
    const long =
      'Mohon maaf atas keterlambatan pesanan ini, terima kasih atas kesabaran Anda semua.';
    expect(formatEvent(stored(ev.complaintReplied(1, 'none', 28800)))).toContain(
      'reply_text=Mohon',
    );
    const reply = formatEvent(
      stored({
        ...ev.complaintReplied(1),
        payload: { complaint_id: 1, compensation: 'none', reply_text: long },
      } as Event),
    );
    expect(reply).toContain('reply_text=Mohon maaf atas keterlambatan pesanan ini, terima…');
    expect(reply).not.toContain('semua');
  });

  it('lifts the report out of a proposal and out of a triage', () => {
    expect(formatEvent(stored(ev.restockProposed(4)))).toBe(
      line(
        '08:00',
        'Aturan',
        'restock_proposed',
        'report_id=4 title=Usul belanja: Susu items=susu×5050 urgency=normal rationale=Susu tinggal 950 ml (batas 1000). Usul: isi sampa…',
      ),
    );
    const withReport = formatEvent(
      stored(ev.complaintTriaged(2, { report: { report_id: 7, title: 'Komplain', body: 'x' } })),
    );
    expect(withReport).toContain('needs_boss_decision=true report_id=7');
    expect(withReport).not.toContain('{3 entries}');
    expect(formatEvent(stored(ev.complaintTriaged(2)))).not.toContain('report_id');
  });

  it('spells out what the character decided', () => {
    const decided: Event = {
      type: 'agent_decided',
      sim_time: 28800,
      actor: 'cashier',
      origin: 'rule',
      payload: {
        agent_id: 'cashier',
        purpose: 'complaint_triage',
        think_event_id: 5,
        decision: {
          category: 'slow_service',
          severity: 2,
          draft_reply: 'Mohon maaf.',
          suggested_compensation: 'discount_10',
          needs_boss_decision: true,
        },
      },
    };
    expect(formatEvent(stored(decided))).toBe(
      line(
        '08:00',
        'Aturan',
        'agent_decided',
        'agent_id=cashier purpose=complaint_triage think_event_id=5 decision=[category=slow_service severity=2 draft_reply=Mohon maaf. suggested_compensation=discount_10 needs_boss_decision=true]',
      ),
    );
  });
});
