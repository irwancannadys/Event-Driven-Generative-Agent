import type { StockLine } from '../schema-parts';
import { DEFAULT_TEXT, type RestockLine, type TextSet } from '../text';

export interface RestockCandidate {
  ingredient_id: string;
  name: string;
  unit: string;
  qty: number;
  min_qty: number;
  capacity_qty: number;
  /** `stock_low` was emitted and no restock has cleared it yet. */
  low: boolean;
  /** `stock_out` was emitted and no restock has cleared it yet. */
  out: boolean;
}

export interface RestockProposal {
  items: StockLine[];
  urgency: 'low' | 'normal' | 'high';
  /** At most 200 characters, as the LLM contract requires. */
  rationale: string;
  report: { title: string; body: string };
}

const MAX_RATIONALE = 200;

function fit(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * The rule "fill up to full" (decision 024): one proposal for every ingredient that is low or out and
 * not already covered by an open proposal or a running order. Each line orders `capacity - stock`.
 * Urgency is `high` when something ran out, otherwise `normal`. Returns `null` when nothing is needed.
 */
export function proposeRestock(
  candidates: readonly RestockCandidate[],
  covered: ReadonlySet<string>,
  text: TextSet = DEFAULT_TEXT,
): RestockProposal | null {
  const wanted = candidates
    .filter(
      (candidate) =>
        (candidate.low || candidate.out) &&
        !covered.has(candidate.ingredient_id) &&
        candidate.capacity_qty - candidate.qty > 0,
    )
    .sort((a, b) =>
      a.ingredient_id < b.ingredient_id ? -1 : a.ingredient_id > b.ingredient_id ? 1 : 0,
    );
  if (wanted.length === 0) return null;

  const items: StockLine[] = wanted.map((candidate) => ({
    ingredient_id: candidate.ingredient_id,
    qty: candidate.capacity_qty - candidate.qty,
  }));
  const urgency = wanted.some((candidate) => candidate.out) ? 'high' : 'normal';
  const lines: RestockLine[] = wanted.map((candidate) => ({
    name: candidate.name,
    unit: candidate.unit,
    qty: candidate.qty,
    min_qty: candidate.min_qty,
    capacity_qty: candidate.capacity_qty,
    order_qty: candidate.capacity_qty - candidate.qty,
    out: candidate.out || candidate.qty <= 0,
  }));

  return {
    items,
    urgency,
    rationale: fit(text.restockRationale(lines), MAX_RATIONALE),
    report: { title: text.restockTitle(lines), body: text.restockBody(lines, urgency) },
  };
}
