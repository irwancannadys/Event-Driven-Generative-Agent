import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, type StoredEvent } from '@cafe/core';
import { describeEvent, formatSpan, humanize } from './index';

function event(
  type: string,
  payload: Record<string, unknown>,
  extra: Partial<StoredEvent> = {},
): StoredEvent {
  return {
    id: 1,
    type,
    sim_time: 30_600,
    actor: 'system',
    origin: 'rule',
    payload,
    ...extra,
  } as StoredEvent;
}

const items = [{ ingredient_id: 'susu', qty: 5000 }];
const report = { report_id: 3, title: 'Usul belanja: Susu', body: 'Isi.' };
const triage = {
  category: 'slow_service',
  severity: 2,
  draft_reply: 'x',
  suggested_compensation: 'discount_10',
  needs_boss_decision: true,
};

// One example per event type that has a sentence of its own, with what that sentence must say.
const SENTENCES: [StoredEvent, string][] = [
  [event('world_initialized', { seed: 42 }), 'Dunia baru dimulai (seed 42)'],
  [event('day_opened', { day: 0 }), 'Kafe buka (hari 0)'],
  [event('day_closed', { day: 1 }), 'Kafe tutup (hari 1)'],
  [event('sim_time_advanced', { from: 28_800, to: 30_600 }), 'Bos memajukan waktu 30 menit'],
  [
    event('regular_expected', { regular_id: 'pak_budi', table_id: 1, expected_at: 30_600 }),
    'Pak Budi diperkirakan datang pukul 08:30 di meja 1',
  ],
  [event('customer_arrived', { customer_id: 48_300 }), 'Pelanggan masuk ke kafe'],
  [
    event('order_created', { order_id: 7, items: [{ menu_item_id: 'kopi_susu', qty: 2 }] }),
    'Pesanan #7 masuk: kopi susu ×2',
  ],
  [
    event('order_held', { order_id: 7, missing: [{ ingredient_id: 'susu' }] }),
    'Pesanan #7 ditahan, bahan kurang: susu',
  ],
  [event('order_resumed', { order_id: 7 }), 'Pesanan #7 dilanjutkan, bahan sudah ada'],
  [
    event('cooking_started', { order_id: 7, duration_sim_sec: 360 }),
    'Koki mulai memasak pesanan #7 (6 menit)',
  ],
  [event('cooking_done', { order_id: 7 }), 'Pesanan #7 selesai dimasak'],
  [
    event('stock_decreased', { ingredient_id: 'susu', qty: 150, new_qty: 2350 }),
    'Stok susu berkurang 150, sisa 2350',
  ],
  [
    event('stock_low', { ingredient_id: 'susu', qty: 1000, min_qty: 1000 }),
    'Stok susu menipis: 1000 (batas 1000)',
  ],
  [event('stock_out', { ingredient_id: 'nasi' }), 'Stok nasi habis'],
  [
    event('restock_proposed', { report, items, urgency: 'normal' }),
    'Admin Stok mengusulkan belanja: Usul belanja: Susu (urgensi normal)',
  ],
  [
    event('daily_review_created', {
      day: 1,
      summary: 'Susu paling bermasalah.',
      metrics: {
        orders: 75,
        done: 70,
        held: 9,
        complaints: 4,
        held_by_ingredient: {},
        stockout_sec: {},
      },
    }),
    'Admin Stok menulis review hari 1: Susu paling bermasalah.',
  ],
  [
    event('policy_proposed', {
      report: { report_id: 4, title: 'Usul kebijakan: batas minimum Susu', body: 'x' },
      change: { ingredient_id: 'susu', from: 1000, to: 1500 },
      rationale: 'Susu sering menahan pesanan.',
    }),
    'Admin Stok mengusulkan kebijakan: Usul kebijakan: batas minimum Susu',
  ],
  [
    event('policy_changed', { ingredient_id: 'susu', from: 1000, to: 1500, report_id: 4 }),
    'Batas minimum susu diubah dari 1000 ke 1500',
  ],
  [
    event('memory_created', {
      agent_id: 'stock_admin',
      kind: 'reflection',
      text: 'Naik ke 1500 membantu.',
    }),
    'Admin Stok mencatat: Naik ke 1500 membantu.',
  ],
  [
    event('report_submitted', { report_id: 3 }, { actor: 'cashier' }),
    'Kasir menyerahkan laporan #3 ke meja bos',
  ],
  [event('report_decided', { report_id: 3, decision: 'approved' }), 'Bos menyetujui laporan #3'],
  [event('report_decided', { report_id: 3, decision: 'rejected' }), 'Bos menolak laporan #3'],
  [
    event('restock_ordered', { restock_id: 1, items, supplier: 'late', eta_sim_time: 37_800 }),
    'Belanja #1 dipesan: susu 5000 (pemasok telat, tiba pukul 10:30)',
  ],
  [event('restock_arrived', { restock_id: 1, items }), 'Belanja #1 tiba: susu 5000'],
  [event('restock_failed', { restock_id: 1 }), 'Belanja #1 gagal: pemasok kosong'],
  [
    event('complaint_received', { complaint_id: 2, order_id: 7, cause: 'slow_service' }),
    'Pelanggan komplain soal pesanan #7 (layanan lambat)',
  ],
  [
    event('complaint_triaged', { complaint_id: 2, ...triage }),
    'Kasir menilai komplain #2: tingkat 2, usul diskon 10%, perlu keputusan bos',
  ],
  [
    event('complaint_replied', { complaint_id: 2, compensation: 'none' }),
    'Kasir membalas komplain #2 (tanpa kompensasi)',
  ],
  [
    event('agent_think_requested', { agent_id: 'cashier', purpose: 'complaint_triage' }),
    'Kasir mulai berpikir: menilai komplain',
  ],
  [
    event('agent_decided', { agent_id: 'stock_admin', purpose: 'stock_proposal' }),
    'Admin Stok memutuskan: usulan belanja',
  ],
  [
    event('agent_task_assigned', { agent_id: 'cook', kind: 'work', label: 'cooking' }),
    'Koki dapat tugas: memasak',
  ],
  [
    event('agent_task_assigned', { agent_id: 'cook', kind: 'goto', station: 'boss_desk' }),
    'Koki dapat tugas: jalan ke Meja Bos',
  ],
  [
    event('agent_state_changed', {
      agent_id: 'cook',
      state: 'working',
      station: 'kitchen',
      label: 'cooking',
    }),
    'Koki bekerja: memasak',
  ],
  [
    event('agent_state_changed', {
      agent_id: 'stock_admin',
      state: 'walking',
      station: 'boss_desk',
    }),
    'Admin Stok berjalan di Meja Bos',
  ],
  [event('agent_task_finished', { agent_id: 'cook' }), 'Koki selesai satu tugas'],
];

/** Events of stage 5 (Rina): until their stage they show as their type. */
const WITHOUT_SENTENCE = [
  'regular_arrived',
  'regular_greeted',
  'regular_left',
  'table_prepared',
  'table_tidied',
  'reflection_created',
];

describe('describeEvent', () => {
  it.each(SENTENCES)('says it in Indonesian: %#', (given, expected) => {
    expect(describeEvent(given)).toBe(expected);
  });

  it('covers every event type of the catalog: a sentence, or a deliberate wait for its stage', () => {
    const covered = new Set([...SENTENCES.map(([given]) => given.type), ...WITHOUT_SENTENCE]);
    expect([...covered].sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('shows the type of an event that has no sentence yet', () => {
    expect(describeEvent(event('table_tidied', { table_id: 1 }))).toBe('table_tidied');
  });

  it('uses the names of the ingredients when it is given them', () => {
    const names = { ingredient: (id: string) => (id === 'susu' ? 'Susu' : id) };
    expect(describeEvent(event('stock_out', { ingredient_id: 'susu' }), names)).toBe(
      'Stok Susu habis',
    );
  });
});

describe('small helpers', () => {
  it('makes ids readable', () => {
    expect(humanize('kopi_susu')).toBe('kopi susu');
  });

  it('writes a span of time in minutes, and in hours from an hour on', () => {
    expect([formatSpan(1800), formatSpan(3600), formatSpan(5000), formatSpan(7200)]).toEqual([
      '30 menit',
      '1 jam',
      '1 jam 23 menit',
      '2 jam',
    ]);
  });
});
