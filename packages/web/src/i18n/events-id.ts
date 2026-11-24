import {
  AGENT_NAME_ID,
  AGENT_STATE_NAME_ID,
  STATION_NAME_ID,
  SUPPLIER_NAME_ID,
  formatClock,
  taskName,
  type StoredEvent,
} from '@cafe/core';

// One sentence in Indonesian for every event, as shown in the event log of the page. The events
// themselves stay English (decision 015). An event without a sentence of its own falls back to its type.

export interface Names {
  /** The name of an ingredient for its id, e.g. `susu` -> `Susu`. */
  ingredient(id: string): string;
}

/** `kopi_susu` -> `kopi susu`: the page has no menu names, so ids are made readable. */
export function humanize(id: string): string {
  return id.replaceAll('_', ' ');
}

/** `pak_budi` -> `Pak Budi`. */
export function titleCase(id: string): string {
  return humanize(id).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const PLAIN_NAMES: Names = { ingredient: humanize };

const COMPENSATION = {
  none: 'tanpa kompensasi',
  discount_10: 'diskon 10%',
  free_item: 'item gratis',
};
const CAUSE = { slow_service: 'layanan lambat', wrong_order: 'pesanan salah', quality: 'kualitas' };
const PURPOSE = {
  stock_proposal: 'usulan belanja',
  complaint_triage: 'menilai komplain',
  waiter_initiative: 'inisiatif pelayan',
  greeting: 'sapaan',
  reflection: 'refleksi',
};

/** `5000` seconds -> `1 jam 23 menit`. */
export function formatSpan(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} menit`;
}

function lines(items: { ingredient_id: string; qty: number }[], names: Names): string {
  return items.map((item) => `${names.ingredient(item.ingredient_id)} ${item.qty}`).join(', ');
}

export function describeEventId(event: StoredEvent, names: Names = PLAIN_NAMES): string {
  switch (event.type) {
    case 'world_initialized':
      return `Dunia baru dimulai (seed ${event.payload.seed})`;
    case 'day_opened':
      return `Kafe buka (hari ${event.payload.day})`;
    case 'day_closed':
      return `Kafe tutup (hari ${event.payload.day})`;
    case 'sim_time_advanced':
      return `Bos memajukan waktu ${formatSpan(event.payload.to - event.payload.from)}`;

    case 'regular_expected':
      return `${titleCase(event.payload.regular_id)} diperkirakan datang pukul ${formatClock(event.payload.expected_at)} di meja ${event.payload.table_id}`;

    case 'order_created': {
      const items = event.payload.items
        .map((item) => `${humanize(item.menu_item_id)} ×${item.qty}`)
        .join(', ');
      return `Pesanan #${event.payload.order_id} masuk: ${items}`;
    }
    case 'order_held': {
      const missing = event.payload.missing
        .map((line) => names.ingredient(line.ingredient_id))
        .join(', ');
      return `Pesanan #${event.payload.order_id} ditahan, bahan kurang: ${missing}`;
    }
    case 'order_resumed':
      return `Pesanan #${event.payload.order_id} dilanjutkan, bahan sudah ada`;
    case 'cooking_started':
      return `Koki mulai memasak pesanan #${event.payload.order_id} (${formatSpan(event.payload.duration_sim_sec)})`;
    case 'cooking_done':
      return `Pesanan #${event.payload.order_id} selesai dimasak`;
    case 'stock_decreased':
      return `Stok ${names.ingredient(event.payload.ingredient_id)} berkurang ${event.payload.qty}, sisa ${event.payload.new_qty}`;
    case 'stock_low':
      return `Stok ${names.ingredient(event.payload.ingredient_id)} menipis: ${event.payload.qty} (batas ${event.payload.min_qty})`;
    case 'stock_out':
      return `Stok ${names.ingredient(event.payload.ingredient_id)} habis`;

    case 'restock_proposed':
      return `Admin Stok mengusulkan belanja: ${event.payload.report.title} (urgensi ${event.payload.urgency})`;
    case 'report_submitted':
      return `${AGENT_NAME_ID[event.actor as keyof typeof AGENT_NAME_ID] ?? event.actor} menyerahkan laporan #${event.payload.report_id} ke meja bos`;
    case 'report_decided':
      return `Bos ${event.payload.decision === 'approved' ? 'menyetujui' : 'menolak'} laporan #${event.payload.report_id}`;
    case 'restock_ordered': {
      const arrival =
        event.payload.eta_sim_time === null
          ? ''
          : `, tiba pukul ${formatClock(event.payload.eta_sim_time)}`;
      return `Belanja #${event.payload.restock_id} dipesan: ${lines(event.payload.items, names)} (pemasok ${SUPPLIER_NAME_ID[event.payload.supplier]}${arrival})`;
    }
    case 'restock_arrived':
      return `Belanja #${event.payload.restock_id} tiba: ${lines(event.payload.items, names)}`;
    case 'restock_failed':
      return `Belanja #${event.payload.restock_id} gagal: pemasok kosong`;

    case 'complaint_received':
      return `Pelanggan komplain soal pesanan #${event.payload.order_id} (${CAUSE[event.payload.cause]})`;
    case 'complaint_triaged': {
      const boss = event.payload.needs_boss_decision ? ', perlu keputusan bos' : '';
      return `Kasir menilai komplain #${event.payload.complaint_id}: tingkat ${event.payload.severity}, usul ${COMPENSATION[event.payload.suggested_compensation]}${boss}`;
    }
    case 'complaint_replied':
      return `Kasir membalas komplain #${event.payload.complaint_id} (${COMPENSATION[event.payload.compensation]})`;

    case 'agent_think_requested':
      return `${AGENT_NAME_ID[event.payload.agent_id]} mulai berpikir: ${PURPOSE[event.payload.purpose]}`;
    case 'agent_decided':
      return `${AGENT_NAME_ID[event.payload.agent_id]} memutuskan: ${PURPOSE[event.payload.purpose]}`;
    case 'agent_task_assigned':
      return event.payload.kind === 'goto'
        ? `${AGENT_NAME_ID[event.payload.agent_id]} dapat tugas: jalan ke ${STATION_NAME_ID[event.payload.station ?? 'cashier']}`
        : `${AGENT_NAME_ID[event.payload.agent_id]} dapat tugas: ${taskName(event.payload.label)}`;
    case 'agent_state_changed': {
      const who = AGENT_NAME_ID[event.payload.agent_id];
      const state = AGENT_STATE_NAME_ID[event.payload.state];
      return event.payload.state === 'working'
        ? `${who} ${state}: ${taskName(event.payload.label)}`
        : `${who} ${state} di ${STATION_NAME_ID[event.payload.station]}`;
    }
    case 'agent_task_finished':
      return `${AGENT_NAME_ID[event.payload.agent_id]} selesai satu tugas`;

    default:
      return event.type;
  }
}
