import type { SimTime } from '../time';
import { pickWeighted } from './rng';

export type SupplierOutcome = 'on_time' | 'late' | 'out';

export interface SupplierWeights {
  weight_on_time: number;
  weight_late: number;
  weight_out: number;
  late_multiplier_pct: number;
}

/** What the mock supplier does with a restock order, drawn from the weights in `suppliers_mock`. */
export function drawSupplier(
  seed: number,
  restockId: number,
  weights: SupplierWeights,
): SupplierOutcome {
  return pickWeighted<SupplierOutcome>(seed, `supplier:${restockId}`, [
    { value: 'on_time', weight: weights.weight_on_time },
    { value: 'late', weight: weights.weight_late },
    { value: 'out', weight: weights.weight_out },
  ]);
}

/** When the goods arrive, or `null` if the supplier is out of stock. A late supplier multiplies the lead time. */
export function etaFor(
  orderedAt: SimTime,
  leadTimeSec: number,
  outcome: SupplierOutcome,
  lateMultiplierPct: number,
): SimTime | null {
  if (outcome === 'out') return null;
  if (outcome === 'late') return orderedAt + Math.ceil((leadTimeSec * lateMultiplierPct) / 100);
  return orderedAt + leadTimeSec;
}
