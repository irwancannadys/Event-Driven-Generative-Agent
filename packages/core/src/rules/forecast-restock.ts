import type { StockLine } from '../schema-parts';
import { DEFAULT_TEXT, fit, type ForecastLine, type TextSet } from '../text';
import type { SimTime } from '../time';
import { forecastDemand, type DemandSample } from './demand';
import type { RestockCandidate, RestockProposal } from './restock';

// The rule for ordering before the stock runs out (decision 034): look at what the same hours asked of each
// ingredient on the last days, and order what is missing for the time until a delivery can arrive and the
// hours after it. It is what the stock admin does when no model answers, and what a model's answer is
// checked against.

/** After the delivery arrives the stock still has to last this long (the lunch rush after the morning order). */
export const FORECAST_COVER_SEC = 2 * 3600;

export interface ForecastCandidate extends RestockCandidate {
  lead_time_sec: number;
}

/** What the forecast says about one ingredient, for a proposal and for the context of a model. */
export interface ForecastReading {
  ingredient_id: string;
  expected: number;
  /** What is missing: the demand plus the minimum stock, less what is on the shelf. Zero or less: enough. */
  shortfall: number;
}

/** The forecast of every candidate, or `null` when there is no past to look at. */
export function readForecast(
  candidates: readonly ForecastCandidate[],
  samples: readonly DemandSample[],
  now: SimTime,
): ForecastReading[] | null {
  const readings: ForecastReading[] = [];
  for (const candidate of candidates) {
    const demand = forecastDemand(samples, now, candidate.lead_time_sec + FORECAST_COVER_SEC);
    if (demand === null) return null;
    const expected = demand[candidate.ingredient_id] ?? 0;
    readings.push({
      ingredient_id: candidate.ingredient_id,
      expected,
      shortfall: expected + candidate.min_qty - candidate.qty,
    });
  }
  return readings;
}

/**
 * One proposal for every ingredient whose forecast says the shelf will not last, and that is not covered by an
 * open proposal or a running order. Each line orders what is missing, no more than fits. Urgency is `high`
 * when the stock would be gone before the delivery could come. `null` when nothing is needed, and on the
 * first day (no past, no forecast).
 */
export function proposeForecastRestock(
  candidates: readonly ForecastCandidate[],
  covered: ReadonlySet<string>,
  samples: readonly DemandSample[],
  now: SimTime,
  text: TextSet = DEFAULT_TEXT,
): RestockProposal | null {
  const readings = readForecast(candidates, samples, now);
  if (readings === null) return null;
  const byId = new Map(readings.map((reading) => [reading.ingredient_id, reading]));

  const wanted = candidates
    .filter((candidate) => !covered.has(candidate.ingredient_id))
    .map((candidate) => {
      const reading = byId.get(candidate.ingredient_id) as ForecastReading;
      const room = candidate.capacity_qty - candidate.qty;
      return { candidate, reading, order_qty: Math.min(room, Math.max(0, reading.shortfall)) };
    })
    .filter((entry) => entry.order_qty > 0)
    .sort((a, b) =>
      a.candidate.ingredient_id < b.candidate.ingredient_id
        ? -1
        : a.candidate.ingredient_id > b.candidate.ingredient_id
          ? 1
          : 0,
    );
  if (wanted.length === 0) return null;

  const items: StockLine[] = wanted.map((entry) => ({
    ingredient_id: entry.candidate.ingredient_id,
    qty: entry.order_qty,
  }));
  const urgency = wanted.some((entry) => entry.reading.expected >= entry.candidate.qty)
    ? 'high'
    : 'normal';
  const lines: ForecastLine[] = wanted.map((entry) => ({
    name: entry.candidate.name,
    unit: entry.candidate.unit,
    qty: entry.candidate.qty,
    min_qty: entry.candidate.min_qty,
    capacity_qty: entry.candidate.capacity_qty,
    order_qty: entry.order_qty,
    out: entry.candidate.qty <= 0,
    expected: entry.reading.expected,
  }));
  return {
    items,
    urgency,
    rationale: fit(text.forecastRationale(lines), 200),
    report: { title: text.restockTitle(lines), body: text.restockBody(lines, urgency) },
  };
}
