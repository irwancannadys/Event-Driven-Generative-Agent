import { describe, expect, it } from 'vitest';
import { agent, apply, event, snapshot, stockRow, TIME } from '../state/test-fixtures';
import { applyClock, applySnapshot, type WorldState } from '../state/world';
import { agentRows, bossDeskView, logRows, namesOf, statusView, stockRows } from './view-models';

const world = (overrides = {}): WorldState => applySnapshot(snapshot(overrides), 1000);

describe('statusView', () => {
  it('shows the virtual day and time of right now, which runs on between server messages', () => {
    const state = world({ time: { ...TIME, sim_time: 28_800, clock: '08:00', speed: 60 } });
    expect(statusView(state, 1000)).toEqual({ day: 0, clock: '08:00', speed: 60, paused: false });
    expect(statusView(state, 61_000)).toMatchObject({ clock: '09:00' }); // a real minute at 60x
    expect(
      statusView(applyClock(state, { ...TIME, sim_time: 90_000, speed: 60 }, 1000), 1000),
    ).toMatchObject({ day: 1, clock: '01:00' });
  });

  it('stands still while paused', () => {
    const state = world({ time: { ...TIME, sim_time: 28_800, paused: true } });
    expect(statusView(state, 999_999)).toMatchObject({ clock: '08:00', paused: true });
  });
});

describe('agentRows', () => {
  it('says where each character is and what they are doing, until when', () => {
    const state = world({
      agents: [
        agent('cashier', 'cashier'),
        {
          ...agent('cook', 'kitchen'),
          state: 'working',
          task: {
            id: 1,
            kind: 'work',
            label: 'cooking',
            station: null,
            started_at_sim: 30_000,
            ends_at_sim: 30_900,
          },
        },
        {
          ...agent('stock_admin', 'boss_desk'),
          state: 'walking',
          from_station: 'stock_shelf',
          task: {
            id: 2,
            kind: 'goto',
            label: null,
            station: 'boss_desk',
            started_at_sim: 30_000,
            ends_at_sim: 30_250,
          },
        },
      ],
    });
    expect(agentRows(state)).toEqual([
      { id: 'cashier', name: 'Kasir', where: 'Kasir', doing: 'menganggur', until: null },
      { id: 'cook', name: 'Koki', where: 'Dapur', doing: 'bekerja: memasak', until: '08:35' },
      {
        id: 'stock_admin',
        name: 'Admin Stok',
        where: 'Meja Bos',
        doing: 'berjalan ke Meja Bos',
        until: '08:24',
      },
    ]);
  });
});

describe('logRows', () => {
  it('lists the newest event first and leaves out the plumbing of the characters', () => {
    const state = apply(
      world(),
      event('day_opened', { day: 0 }, 28_800),
      event('agent_state_changed', { agent_id: 'cook', state: 'idle', station: 'kitchen' }, 28_900),
      event(
        'order_created',
        { order_id: 1, source: 'walk_in', items: [{ menu_item_id: 'kopi_susu', qty: 1 }] },
        29_000,
      ),
    );
    expect(logRows(state).map((row) => [row.clock, row.sentence])).toEqual([
      ['08:03', 'Pesanan #1 masuk: kopi susu ×1'],
      ['08:00', 'Kafe buka (hari 0)'],
    ]);
  });

  it('gives each row the label of where the event came from', () => {
    let state = world();
    const make = (origin: string, type: string, payload: Record<string, unknown>) => ({
      ...event(type, payload),
      origin,
    });
    state = apply(
      state,
      make('generator', 'order_created', { order_id: 1, items: [] }) as never,
      make('rule', 'cooking_started', { order_id: 1, duration_sim_sec: 60 }) as never,
      make('boss', 'report_decided', { report_id: 1, decision: 'approved' }) as never,
    );
    expect(logRows(state).map((row) => row.label)).toEqual(['boss', 'rule', 'trigger']);
  });

  it('keeps to the limit, and uses the names of the ingredients from the stock', () => {
    let state = world({ stock: [{ ...stockRow('susu', 1000, 1000), name: 'Susu' }] });
    for (let index = 0; index < 5; index += 1) {
      state = apply(state, event('stock_out', { ingredient_id: 'susu' }));
    }
    expect(logRows(state, 3)).toHaveLength(3);
    expect(logRows(state)[0]?.sentence).toBe('Stok Susu habis');
    expect(namesOf(state).ingredient('ghost')).toBe('ghost');
  });
});

describe('stockRows', () => {
  it('sorts by name, rounds how full a shelf is, and marks what is low or out', () => {
    const state = world({
      stock: [
        { ...stockRow('susu', 1000, 1000), name: 'Susu', capacity_qty: 6000, low: true },
        { ...stockRow('kopi', 1200, 200), name: 'Kopi', capacity_qty: 2000, low: false },
        { ...stockRow('nasi', 0, 1000), name: 'Nasi', capacity_qty: 8000, low: true, out: true },
      ],
    });
    expect(stockRows(state).map((row) => [row.name, row.percent, row.level])).toEqual([
      ['Kopi', 60, 'ok'],
      ['Nasi', 0, 'out'],
      ['Susu', 17, 'low'],
    ]);
  });

  it('never draws a bar longer than the shelf', () => {
    const state = world({ stock: [{ ...stockRow('susu', 9000, 1000), capacity_qty: 6000 }] });
    expect(stockRows(state)[0]?.percent).toBe(100);
  });
});

describe('bossDeskView', () => {
  const report = (
    id: number,
    status: 'drafted' | 'submitted',
    type: 'restock' | 'complaint',
    body: string,
  ) => ({
    id,
    type,
    status,
    title: `Laporan ${id}`,
    body,
    subject: {},
    created_at_sim: 30_000,
    submitted_at_sim: status === 'submitted' ? 30_300 : null,
    decided_at_sim: null,
  });

  it('puts the reports on the desk apart from the ones still on their way', () => {
    const state = world({
      reports: [
        report(1, 'submitted', 'restock', 'Urgensi: normal.\nSusu: pesan 5000 ml.'),
        report(2, 'drafted', 'complaint', 'Komplain.'),
      ],
    });
    expect(bossDeskView(state)).toEqual({
      waiting: [
        {
          id: 1,
          typeLabel: 'belanja',
          title: 'Laporan 1',
          body: ['Urgensi: normal.', 'Susu: pesan 5000 ml.'],
        },
      ],
      onTheWay: [{ id: 2, typeLabel: 'komplain', title: 'Laporan 2', body: ['Komplain.'] }],
    });
  });

  it('is empty when there is nothing to decide', () => {
    expect(bossDeskView(world())).toEqual({ waiting: [], onTheWay: [] });
  });
});
