import { describe, expect, it } from 'vitest';
import type { StockLevel } from '@cafe/core';
import type { AgentOverviewRow, OrderListRow, ReportRow } from '../db/queries';
import { formatDashboard, type DashboardView } from './format-dashboard';

const agents: AgentOverviewRow[] = [
  {
    id: 'cashier',
    role: 'cashier',
    station: 'cashier',
    state: 'working',
    task: {
      id: 7,
      kind: 'work',
      label: 'recording_order',
      station: null,
      started_at_sim: 45_000,
      ends_at_sim: 45_045,
    },
    queued: 2,
  },
  { id: 'cook', role: 'cook', station: 'kitchen', state: 'idle', task: null, queued: 0 },
  {
    id: 'stock_admin',
    role: 'stock_admin',
    station: 'stock_shelf',
    state: 'walking',
    task: {
      id: 9,
      kind: 'goto',
      label: null,
      station: 'boss_desk',
      started_at_sim: 45_000,
      ends_at_sim: 45_300,
    },
    queued: 1,
  },
  { id: 'waiter', role: 'waiter', station: 'table_2', state: 'idle', task: null, queued: 0 },
];

const order = (
  id: number,
  status: OrderListRow['status'],
  extra: Partial<OrderListRow> = {},
): OrderListRow => ({
  id,
  status,
  source: 'walk_in',
  created_at_sim: 44_100,
  done_at_sim: null,
  items: [{ menu_item_id: 'kopi_susu', qty: 2 }],
  ...extra,
});

const stock: StockLevel[] = [
  {
    ingredient_id: 'susu',
    name: 'Susu',
    unit: 'ml',
    qty: 1000,
    min_qty: 1000,
    capacity_qty: 6000,
    low: true,
    out: false,
  },
  {
    ingredient_id: 'nasi',
    name: 'Nasi',
    unit: 'g',
    qty: 0,
    min_qty: 1000,
    capacity_qty: 8000,
    low: true,
    out: true,
  },
  {
    ingredient_id: 'kopi',
    name: 'Kopi',
    unit: 'g',
    qty: 900,
    min_qty: 200,
    capacity_qty: 1200,
    low: false,
    out: false,
  },
];

const report: ReportRow = {
  id: 3,
  type: 'restock',
  status: 'submitted',
  title: 'Usul belanja: Susu',
  body: 'Susu tinggal 1000 ml (batas 1000).\nUsul: isi sampai penuh.',
  subject: {},
  created_at_sim: 44_000,
  submitted_at_sim: 44_500,
  decided_at_sim: null,
};

const view: DashboardView = {
  apiUrl: 'http://127.0.0.1:3000',
  time: { sim_time: 45_000, clock: '12:30', day: 0, speed: 60, paused: false },
  agents,
  stock,
  orders: {
    placed: [order(42, 'placed')],
    cooking: [order(41, 'cooking')],
    held: [order(40, 'held', { items: [{ menu_item_id: 'nasi_goreng', qty: 1 }] })],
    done: [order(39, 'done', { done_at_sim: 44_900 })],
  },
  reports: [report],
};

describe('formatDashboard', () => {
  it('draws the whole board', () => {
    expect(formatDashboard(view)).toBe(
      [
        '=== Kafe Virtual ===  hari 0, 12:30  ·  kecepatan 60x',
        '────────────────────────────────────────────────────────────────────────',
        'KARAKTER',
        '  Kasir           Kasir      bekerja: mencatat pesanan (sampai 12:30), antre 2',
        '  Koki            Dapur      menganggur',
        '  Admin Stok      Rak Stok   berjalan ke Meja Bos (sampai 12:35), antre 1',
        '  Rina (pelayan)  Meja 2     menganggur',
        '',
        'PESANAN',
        '  menunggu 1 · dimasak 1 · ditahan (bahan kurang) 1',
        '    #41 12:15 kopi_susu×2  [dimasak]',
        '    #40 12:15 nasi_goreng×1  [ditahan (bahan kurang)]',
        '    #42 12:15 kopi_susu×2  [menunggu]',
        '  selesai terakhir:',
        '    #39 12:15 kopi_susu×2 (selesai 12:28)',
        '',
        'STOK',
        '  Susu       1000 / 6000 ml      [RENDAH]',
        '  Nasi       0 / 8000 g          [HABIS]',
        '  Kopi       900 / 1200 g',
        '',
        'MEJA BOS  (1 laporan menunggu keputusan lu)',
        '  #3 [belanja] Usul belanja: Susu',
        '     Susu tinggal 1000 ml (batas 1000).',
        '     Usul: isi sampai penuh.',
        `     setujui: curl -s -X POST http://127.0.0.1:3000/reports/3/decision -H 'content-type: application/json' -d '{"decision":"approved"}'`,
        `     tolak  : curl -s -X POST http://127.0.0.1:3000/reports/3/decision -H 'content-type: application/json' -d '{"decision":"rejected"}'`,
        '────────────────────────────────────────────────────────────────────────',
      ].join('\n'),
    );
  });

  it('is the same board for the same view', () => {
    expect(formatDashboard(view)).toBe(formatDashboard(structuredClone(view)));
  });

  it('says so when the clock is paused', () => {
    const paused = { ...view, time: { ...view.time, paused: true } };
    expect(formatDashboard(paused).split('\n')[0]).toBe(
      '=== Kafe Virtual ===  hari 0, 12:30  ·  JEDA',
    );
  });

  it('says so when nothing waits on the boss desk', () => {
    const board = formatDashboard({ ...view, reports: [] });
    expect(board).toContain('MEJA BOS\n  (tidak ada laporan yang menunggu)');
    expect(board).not.toContain('curl');
  });

  it('shows at most six open orders and counts the rest', () => {
    const many = Array.from({ length: 9 }, (_, index) => order(100 + index, 'placed'));
    const board = formatDashboard({
      ...view,
      orders: { placed: many, cooking: [], held: [], done: [] },
    });
    expect(board.match(/\[menunggu\]/g)).toHaveLength(6);
    expect(board).toContain('... dan 3 lagi');
    expect(board).not.toContain('selesai terakhir');
  });

  it('falls back to the plain word for a task it has no text for', () => {
    const odd: AgentOverviewRow[] = [
      {
        id: 'cook',
        role: 'cook',
        station: 'kitchen',
        state: 'working',
        task: {
          id: 1,
          kind: 'work',
          label: null,
          station: null,
          started_at_sim: null,
          ends_at_sim: null,
        },
        queued: 0,
      },
    ];
    expect(formatDashboard({ ...view, agents: odd })).toContain(
      'Koki            Dapur      bekerja: bekerja',
    );
  });
});
