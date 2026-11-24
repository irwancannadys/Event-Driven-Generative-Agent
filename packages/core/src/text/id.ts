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

/** One line of a proposal that comes from a forecast: `expected` is the demand foreseen until the delivery. */
export interface ForecastLine extends RestockLine {
  expected: number;
}

/** What the stock admin says about a day, for her summary and her notes. */
export interface ReviewFacts {
  day: number;
  orders: number;
  done: number;
  held: number;
  complaints: number;
  /** The ingredients that gave the most trouble, worst first. */
  worst: { name: string; unit: string; held: number; stockout_minutes: number }[];
}

export interface PolicyChangeText {
  name: string;
  unit: string;
  from: number;
  to: number;
}

export interface OutcomeText extends PolicyChangeText {
  verdict: 'helped' | 'no_help' | 'unclear';
  held_before: number;
  held_after: number;
  stockout_minutes_before: number;
  stockout_minutes_after: number;
}

export interface TextSet {
  restockTitle(lines: readonly RestockLine[]): string;
  restockBody(lines: readonly RestockLine[], urgency: 'low' | 'normal' | 'high'): string;
  restockRationale(lines: readonly RestockLine[]): string;
  forecastRationale(lines: readonly ForecastLine[]): string;
  reviewSummary(facts: ReviewFacts): string;
  reviewRationale(change: PolicyChangeText | null, held: number): string;
  policyTitle(change: PolicyChangeText): string;
  policyBody(change: PolicyChangeText, rationale: string): string;
  observationText(facts: ReviewFacts): string;
  reflectionText(outcome: OutcomeText): string;
  rejectedText(change: PolicyChangeText): string;
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

  forecastRationale: (lines) =>
    `Perkiraan pemakaian sebelum pengiriman berikutnya: ${lines
      .map((line) => `${line.name} ${line.expected} ${line.unit} (stok ${line.qty})`)
      .join('; ')}. Usul: pesan sebelum habis.`,

  reviewSummary: (facts) =>
    `Hari ${facts.day}: ${facts.orders} pesanan, ${facts.done} selesai, ${facts.held} kali ditahan, ${facts.complaints} komplain.${
      facts.worst.length > 0
        ? ` Paling bermasalah: ${facts.worst
            .map(
              (item) =>
                `${item.name} (${item.held}x menahan pesanan${item.stockout_minutes > 0 ? `, habis ${item.stockout_minutes} menit` : ''})`,
            )
            .join('; ')}.`
        : ' Tidak ada bahan yang bermasalah.'
    }`,

  reviewRationale: (change, held) =>
    change
      ? `Stok ${change.name} sering tipis (${held} pesanan tertahan): naikkan batas minimum supaya belanja lebih awal.`
      : 'Tidak ada yang perlu diubah.',

  policyTitle: (change) =>
    `Usul kebijakan: batas minimum ${change.name} ${change.from} jadi ${change.to} ${change.unit}`,

  policyBody: (change, rationale) =>
    [
      `Batas minimum ${change.name}: ${change.from} ${change.unit} jadi ${change.to} ${change.unit}.`,
      rationale,
      'Setujui untuk mengubah batas, Tolak untuk membiarkannya.',
    ].join('\n'),

  observationText: (facts) =>
    `Hari ${facts.day}: ${facts.orders} pesanan, ${facts.held} kali ditahan, ${facts.complaints} komplain.${
      facts.worst.length > 0
        ? ` ${facts.worst
            .map((item) =>
              item.stockout_minutes > 0
                ? `${item.name} habis ${item.stockout_minutes} menit`
                : `${item.name} menahan ${item.held} pesanan`,
            )
            .join(', ')}.`
        : ''
    }`,

  reflectionText: (outcome) => {
    const change = `Batas ${outcome.name} dinaikkan dari ${outcome.from} ke ${outcome.to} ${outcome.unit}`;
    const numbers = `pesanan tertahan ${outcome.held_before} jadi ${outcome.held_after}, habis ${outcome.stockout_minutes_before} jadi ${outcome.stockout_minutes_after} menit`;
    switch (outcome.verdict) {
      case 'helped':
        return `${change}: membantu (${numbers}).`;
      case 'no_help':
        return `${change}: tidak membantu (${numbers}). Jangan diulang.`;
      default:
        return `${change}: belum bisa dinilai (${numbers}).`;
    }
  },

  rejectedText: (change) =>
    `Bos menolak usul menaikkan batas ${change.name} dari ${change.from} ke ${change.to} ${change.unit}. Jangan diulang.`,

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
