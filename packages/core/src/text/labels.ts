import { AGENT_IDS, STATION_IDS, type AgentId, type StationId } from '../ids';
import { TASK_LABELS, type TaskLabel } from '../agents/home';

// The words people see for the neutral keys of the domain (decision 015): who, where, doing what. The
// events keep the keys, the screens (the watch board now, the web of stage 4 later) look the words up
// here. Another language is another copy of this file.

export const AGENT_NAME_ID: Record<AgentId, string> = {
  cashier: 'Kasir',
  cook: 'Koki',
  stock_admin: 'Admin Stok',
  waiter: 'Rina (pelayan)',
};

export const STATION_NAME_ID: Record<StationId, string> = {
  cashier: 'Kasir',
  kitchen: 'Dapur',
  stock_shelf: 'Rak Stok',
  boss_desk: 'Meja Bos',
  table_1: 'Meja 1',
  table_2: 'Meja 2',
  table_3: 'Meja 3',
};

export const AGENT_STATE_NAME_ID = {
  idle: 'idle',
  walking: 'berjalan',
  working: 'bekerja',
  thinking: 'mikir...',
} as const;

export const TASK_NAME_ID: Record<TaskLabel, string> = {
  recording_order: 'mencatat pesanan',
  cooking: 'memasak',
  checking_stock: 'mengecek stok',
  forecasting: 'memperkirakan kebutuhan',
  reviewing_day: 'menulis review hari ini',
  submitting_report: 'menyerahkan laporan',
  placing_order: 'memesan ke pemasok',
  noting_complaint: 'mencatat komplain',
  replying_customer: 'membalas pelanggan',
  waiting_retry: 'menunggu sebelum cek ulang',
};

export const ORDER_STATUS_NAME_ID = {
  placed: 'menunggu',
  held: 'ditahan (bahan kurang)',
  cooking: 'dimasak',
  done: 'selesai',
} as const;

export const REPORT_TYPE_NAME_ID = {
  restock: 'belanja',
  complaint: 'komplain',
  policy: 'kebijakan',
} as const;

export const SUPPLIER_NAME_ID = {
  on_time: 'tepat waktu',
  late: 'telat',
  out: 'kosong',
} as const;

/** The words for a task label, or the key itself for a label this dictionary does not know yet. */
export function taskName(label: string | null | undefined): string {
  if (!label) return 'bekerja';
  return (TASK_NAME_ID as Record<string, string>)[label] ?? label;
}

// Exposed for the test that checks every key has a text.
export const LABEL_KEYS = { agents: AGENT_IDS, stations: STATION_IDS, tasks: TASK_LABELS } as const;
