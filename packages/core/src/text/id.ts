import type { Compensation } from '../schema-parts';

// Text templates. Whatever people read that comes from a template is written into the event payload
// as a final string (decision 015), so a replay never re-renders it. Indonesian is the default; the
// shape of `TextSet` is what another language has to provide.

export interface RestockLine {
  name: string;
  unit: string;
  qty: number;
  min_qty: number;
  capacity_qty: number;
  order_qty: number;
  out: boolean;
}

export interface TextSet {
  restockTitle(lines: readonly RestockLine[]): string;
  restockBody(lines: readonly RestockLine[], urgency: 'low' | 'normal' | 'high'): string;
  restockRationale(lines: readonly RestockLine[]): string;
  complaintTitle(cause: string, orderId: number): string;
  complaintBody(
    orderId: number,
    waitedMinutes: number,
    reply: string,
    compensation: Compensation,
  ): string;
  complaintReply(compensation: Compensation, orderId: number): string;
}

const URGENCY: Record<'low' | 'normal' | 'high', string> = {
  low: 'rendah',
  normal: 'normal',
  high: 'tinggi',
};

const CAUSE: Record<string, string> = {
  slow_service: 'layanan lambat',
  wrong_order: 'pesanan salah',
  quality: 'kualitas',
};

const COMPENSATION: Record<Compensation, string> = {
  none: 'tidak ada',
  discount_10: 'diskon 10% untuk pesanan berikutnya',
  free_item: 'satu item gratis',
};

function describe(line: RestockLine): string {
  return line.out
    ? `${line.name} habis`
    : `${line.name} tinggal ${line.qty} ${line.unit} (batas ${line.min_qty})`;
}

export const TEXT_ID: TextSet = {
  restockTitle: (lines) => `Usul belanja: ${lines.map((line) => line.name).join(', ')}`,

  restockBody: (lines, urgency) =>
    [
      `Urgensi: ${URGENCY[urgency]}.`,
      ...lines.map(
        (line) =>
          `${line.name}: pesan ${line.order_qty} ${line.unit} (stok ${line.qty} dari ${line.capacity_qty}).`,
      ),
    ].join('\n'),

  restockRationale: (lines) => `${lines.map(describe).join('; ')}. Usul: isi sampai penuh.`,

  complaintTitle: (cause, orderId) => `Komplain: ${CAUSE[cause] ?? cause} (pesanan #${orderId})`,

  complaintBody: (orderId, waitedMinutes, reply, compensation) =>
    `Pesanan #${orderId} menunggu ${waitedMinutes} menit. Usul balasan: ${reply} Kompensasi usulan: ${COMPENSATION[compensation]}.`,

  complaintReply: (compensation, orderId) => {
    switch (compensation) {
      case 'discount_10':
        return `Mohon maaf atas keterlambatan pesanan #${orderId}. Kami beri diskon 10% untuk pesanan berikutnya.`;
      case 'free_item':
        return `Mohon maaf atas keterlambatan pesanan #${orderId} yang cukup lama. Satu item gratis untuk Anda.`;
      default:
        return `Mohon maaf atas keterlambatan pesanan #${orderId}. Terima kasih atas kesabaran Anda.`;
    }
  },
};

export const DEFAULT_TEXT: TextSet = TEXT_ID;
