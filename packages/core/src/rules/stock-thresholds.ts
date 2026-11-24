export interface ThresholdInput {
  /** Stock right after a decrease. */
  qtyAfter: number;
  minQty: number;
  /** Whether `stock_low` / `stock_out` was already emitted since the last restock. */
  lowFlagged: boolean;
  outFlagged: boolean;
}

export interface ThresholdSignals {
  low: boolean;
  out: boolean;
}

/**
 * Which stock events to emit after a decrease. Idempotent: once a signal was emitted (its flag is set)
 * it does not repeat until a restock clears the flag. Both can fire together when stock drops from
 * above the minimum straight to zero.
 */
export function thresholdSignals(input: ThresholdInput): ThresholdSignals {
  return {
    low: input.qtyAfter <= input.minQty && !input.lowFlagged,
    out: input.qtyAfter <= 0 && !input.outFlagged,
  };
}
