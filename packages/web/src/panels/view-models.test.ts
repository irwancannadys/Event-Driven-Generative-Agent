import { describe, expect, it } from 'vitest';
import { agent, apply, event, snapshot, stockRow, TIME } from '../state/test-fixtures';
import { applyClock, applySnapshot, type WorldState } from '../state/world';
import {
  adminView,
  agentRows,
  agentsSummary,
  bossDeskView,
  complaintsView,
  formatNumber,
  logRows,
  ordersView,
  namesOf,
  statusView,
  stockRows,
  stockSummary,
} from './view-models';

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
      {
        id: 'cashier',
        name: 'Kasir',
        where: 'Kasir',
        doing: 'idle',
        until: null,
        initials: 'K',
        busy: false,
        statusLabel: 'Idle',
        detail: 'Kasir',
      },
      {
        id: 'cook',
        name: 'Koki',
        where: 'Dapur',
        doing: 'bekerja: memasak',
        until: '08:35',
        initials: 'Ko',
        busy: true,
        statusLabel: 'Memasak',
        detail: 'Dapur \u00b7 sampai 08:35',
      },
      {
        id: 'stock_admin',
        name: 'Admin Stok',
        where: 'Meja Bos',
        doing: 'berjalan ke Meja Bos',
        until: '08:24',
        initials: 'AS',
        busy: true,
        statusLabel: 'Berjalan',
        detail: 'ke Meja Bos \u00b7 sampai 08:24',
      },
    ]);
    expect(agentsSummary(state)).toEqual({ busy: 2, total: 3 });
  });
});

describe('a character that thinks (the model is working on it)', () => {
  const thinking = (state: WorldState) =>
    apply(
      state,
      event(
        'agent_state_changed',
        { agent_id: 'stock_admin', state: 'thinking', station: 'stock_shelf' },
        30_200,
        { actor: 'stock_admin' },
      ),
    );

  it('is busy, says Mikir... in the pill and on the label, and has no end time to wait for', () => {
    const state = thinking(world({ agents: [agent('stock_admin', 'stock_shelf')] }));
    expect(agentRows(state)).toEqual([
      {
        id: 'stock_admin',
        name: 'Admin Stok',
        where: 'Rak Stok',
        doing: 'mikir...',
        until: null,
        initials: 'AS',
        busy: true,
        statusLabel: 'Mikir...',
        detail: 'Rak Stok',
      },
    ]);
    expect(agentsSummary(state)).toEqual({ busy: 1, total: 1 });
  });

  it('is free again when the decision has been made', () => {
    const state = apply(
      thinking(world({ agents: [agent('stock_admin', 'stock_shelf')] })),
      event(
        'agent_state_changed',
        { agent_id: 'stock_admin', state: 'idle', station: 'stock_shelf' },
        30_900,
        {
          actor: 'stock_admin',
        },
      ),
    );
    expect(agentRows(state)[0]).toMatchObject({ busy: false, statusLabel: 'Idle', doing: 'idle' });
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
          urgency: 'Urgensi: normal',
          items: [],
          lines: ['Susu: pesan 5000 ml.'], // not in the form of a line of stock, so it stays a line
        },
      ],
      onTheWay: [
        {
          id: 2,
          typeLabel: 'komplain',
          title: 'Laporan 2',
          body: ['Komplain.'],
          urgency: null,
          items: [],
          lines: ['Komplain.'],
        },
      ],
    });
  });

  it('is empty when there is nothing to decide', () => {
    expect(bossDeskView(world())).toEqual({ waiting: [], onTheWay: [] });
  });
});

describe('complaintsView', () => {
  const complaint = (id: number, overrides = {}) => ({
    complaint_id: id,
    order_id: id + 20,
    cause: 'slow_service' as const,
    status: 'received' as const,
    received_at_sim: 30_000,
    replied_at_sim: null,
    compensation: null,
    ...overrides,
  });
  const NOW = 30_000 + 25 * 60;
  const stateWith = (complaints: ReturnType<typeof complaint>[]) =>
    world({ time: { ...TIME, sim_time: NOW }, complaints });

  it('says there is nothing when nobody complained', () => {
    expect(complaintsView(stateWith([]), 1000)).toEqual({ open: 0, answered: 0, rows: [] });
  });

  it('lists the complaints that wait for an answer first, oldest first, and how long they have waited', () => {
    const state = stateWith([
      complaint(1, {
        status: 'replied',
        replied_at_sim: 30_300,
        compensation: 'none',
        received_at_sim: 29_900,
      }),
      complaint(2, { status: 'triaged', compensation: 'discount_10' }),
      complaint(3, { received_at_sim: 30_600 }),
    ]);
    const view = complaintsView(state, 1000);
    expect(view.rows.map((row) => row.id)).toEqual([2, 3, 1]);
    expect([view.open, view.answered]).toEqual([2, 1]);
    expect(view.rows[0]).toEqual({
      id: 2,
      title: 'Pesanan #22 \u00b7 layanan lambat',
      order: 'Pesanan #22',
      cause: 'Layanan lambat',
      status: 'triaged',
      statusLabel: 'menunggu keputusan bos',
      span: 'sudah menunggu 25 menit',
      offer: 'usul: diskon 10%',
    });
    expect(view.rows[1]).toMatchObject({ statusLabel: 'dicatat kasir', offer: '' });
    expect(view.rows[2]).toMatchObject({
      statusLabel: 'dibalas',
      span: 'dibalas dalam 7 menit',
      offer: 'tanpa kompensasi',
    });
  });

  it('keeps the clock running on the waiting time, between the messages of the server', () => {
    const state = stateWith([complaint(1)]);
    expect(complaintsView(state, 1000).rows[0]?.span).toBe('sudah menunggu 25 menit');
    expect(complaintsView(state, 61_000).rows[0]?.span).toBe('sudah menunggu 1 jam 25 menit'); // a minute later at 60x
  });

  it('shows the newest answered complaints when there are more than fit, and never hides one that waits', () => {
    const answered = Array.from({ length: 10 }, (_, index) =>
      complaint(index + 1, { status: 'replied', replied_at_sim: 30_100, compensation: 'none' }),
    );
    const view = complaintsView(stateWith([...answered, complaint(11)]), 1000, 4);
    expect(view.rows.map((row) => row.id)).toEqual([11, 10, 9, 8]);
    expect(view.answered).toBe(10);
  });
});

describe('the figures of the cards', () => {
  it('writes thousands with a dot, as people write them here', () => {
    expect([0, 950, 1000, 4000, 12_345, 1_234_567].map(formatNumber)).toEqual([
      '0',
      '950',
      '1.000',
      '4.000',
      '12.345',
      '1.234.567',
    ]);
  });

  it('shares the bar of the orders out over the ones that are not done, and does not divide by nothing', () => {
    const view = ordersView(world({ orders: { placed: 51, cooking: 1, held: 2, done: 163 } }));
    expect(view).toMatchObject({ placed: 51, cooking: 1, held: 2, done: 163 });
    expect(view.bar).toEqual({ placed: 94.4, cooking: 1.9, held: 3.7 });
    expect(ordersView(world({ orders: { placed: 0, cooking: 0, held: 0, done: 4 } })).bar).toEqual({
      placed: 0,
      cooking: 0,
      held: 0,
    });
  });

  it('counts the ingredients that are out and the ones that are low, and the out ones are not low as well', () => {
    const state = world({
      stock: [
        { ...stockRow('mie', 0, 1000), low: true, out: true },
        { ...stockRow('nasi', 400, 1000), low: true },
        { ...stockRow('teh', 95, 100), low: true },
        { ...stockRow('gula', 610, 300), low: false },
      ],
    });
    expect(stockSummary(state)).toEqual({ out: 1, low: 2 });
  });
});

describe('the report of the boss in rows', () => {
  const bossReport = (body: string) =>
    bossDeskView(
      world({
        reports: [
          {
            id: 8,
            type: 'restock',
            status: 'submitted',
            title: 'Usul belanja: Nasi, Telur',
            body,
            subject: {},
            created_at_sim: 0,
            submitted_at_sim: 0,
            decided_at_sim: null,
          },
        ],
      }),
    ).waiting[0];

  it('makes a row of every ingredient of a restock report, and a chip of its urgency', () => {
    const row = bossReport(
      'Urgensi: normal.\nNasi: pesan 7000 g (stok 1000 dari 8000).\nTelur: pesan 50 pcs (stok 10 dari 60).',
    );
    expect(row?.urgency).toBe('Urgensi: normal');
    expect(row?.items).toEqual([
      { name: 'Nasi', stock: 'Stok 1.000 / 8.000 g', order: '+7.000 g' },
      { name: 'Telur', stock: 'Stok 10 / 60 pcs', order: '+50 pcs' },
    ]);
    expect(row?.lines).toEqual([]);
  });

  it('keeps the lines of a report that is not a list of ingredients, such as a proposal of policy', () => {
    const row = bossReport(
      'Batas minimum Susu: 1000 ml jadi 2000 ml.\nSusu sering menahan pesanan.',
    );
    expect(row?.items).toEqual([]);
    expect(row?.urgency).toBeNull();
    expect(row?.lines).toEqual([
      'Batas minimum Susu: 1000 ml jadi 2000 ml.',
      'Susu sering menahan pesanan.',
    ]);
  });
});

describe('logRows: the time and the filter', () => {
  const state = () =>
    apply(
      world(),
      event('day_opened', { day: 0 }, 28_800, { origin: 'scheduler' }),
      event('stock_low', { ingredient_id: 'susu', qty: 900, min_qty: 1000 }, 28_830),
      event('stock_out', { ingredient_id: 'nasi' }, 28_850),
      event(
        'order_created',
        { order_id: 1, source: 'walk_in', items: [{ menu_item_id: 'kopi_susu', qty: 1 }] },
        29_000,
        { origin: 'generator' },
      ),
    );

  it('shows the time only on the first row of a minute', () => {
    const rows = logRows(state());
    expect(rows.map((row) => [row.clock, row.showTime])).toEqual([
      ['08:03', true],
      ['08:00', true], // the newest first: 28_850 and 28_830 are 08:00 too
      ['08:00', false],
      ['08:00', false],
    ]);
  });

  it('narrows the log to the events of one kind', () => {
    expect(logRows(state(), 60, 'trigger').map((row) => row.label)).toEqual(['trigger', 'trigger']);
    expect(logRows(state(), 60, 'trigger').map((row) => row.clock)).toEqual(['08:03', '08:00']);
    expect(logRows(state(), 60, 'rule').every((row) => row.label === 'rule')).toBe(true);
    expect(logRows(state(), 60, 'llm')).toEqual([]);
  });
});

describe('adminView', () => {
  it('has no review and no notes before the first night', () => {
    expect(adminView(world())).toEqual({ review: null, changes: [], notes: [] });
  });

  it('says who wrote the review, which minimums changed, and the newest notes first', () => {
    const state = world({
      stock: [
        { ...stockRow('susu', 800, 2000), name: 'Susu', base_min_qty: 1000 },
        { ...stockRow('kopi', 800, 300), name: 'Kopi' },
      ],
      latest_review: {
        day: 1,
        summary: 'Hari 1: 89 pesanan.',
        origin: 'fallback',
        created_at_sim: 150_000,
        metrics: {
          orders: 89,
          done: 89,
          held: 1,
          complaints: 2,
          held_by_ingredient: {},
          stockout_sec: {},
        },
      },
      memories: Array.from({ length: 6 }, (_, index) => ({
        kind: index % 2 === 0 ? ('observation' as const) : ('reflection' as const),
        ingredient_id: null,
        text: `catatan ${index + 1}`,
        created_at_sim: 70_000 + index * 60,
      })),
    });
    const view = adminView(state);
    expect(view.review).toEqual({
      day: 1,
      summary: 'Hari 1: 89 pesanan.',
      origin: 'Aturan (cadangan)',
      originKey: 'fallback',
    });
    expect(view.changes).toEqual([{ name: 'Susu', from: 1000, to: 2000, unit: 'g' }]);
    expect(view.notes.map((note) => note.text)).toEqual([
      'catatan 6',
      'catatan 5',
      'catatan 4',
      'catatan 3',
    ]);
    expect(view.notes[0]).toMatchObject({ kind: 'reflection', kindLabel: 'Refleksi' });
  });
});
