import {
  TASK_DURATION_SEC,
  demandSamples,
  proposeForecastRestock,
  readForecast,
  type ForecastCandidate,
  type OrderItem,
  type RestockProposal,
  type StockContextLine,
} from '@cafe/core';
import type { Db } from '../db/database';
import { readRecipe, readStock } from '../db/queries';
import type { Context, Emit } from '../usecases/context';
import { enqueueWork, readAgent, readOpenTasks } from './engine';
import { coveredIngredients, proposeToBoss, type Proposal } from './restock-flow';

// The stock admin looks ahead (decision 034): twice a day she compares what the same hours asked of each
// ingredient on the last days with what is on the shelf, and orders before the stock runs out. She looks only
// when she has nothing else to do, and only goes to the shelf when the rule says there is something to order:
// the model is not asked on a schedule, only when there is a decision to make.

/** What was asked of the ingredients since this world began, from the orders in the log. */
function demandHistory(db: Db) {
  const epoch = db
    .prepare("SELECT COALESCE(MAX(id), 0) FROM events WHERE type = 'world_initialized'")
    .pluck()
    .get() as number;
  const rows = db
    .prepare(
      "SELECT sim_time, payload_json FROM events WHERE type = 'order_created' AND id > ? ORDER BY id",
    )
    .all(epoch) as { sim_time: number; payload_json: string }[];
  return demandSamples(
    rows.map((row) => ({
      sim_time: row.sim_time,
      items: (JSON.parse(row.payload_json) as { items: OrderItem[] }).items,
    })),
    readRecipe(db),
  );
}

interface Forecast {
  proposal: RestockProposal;
  lines: StockContextLine[];
}

/** What the rule would order now, or `null` when nothing is needed (and on the first day there is no forecast). */
function forecastNow(ctx: Context): Forecast | null {
  const leadTimes = new Map(
    (
      ctx.db.prepare('SELECT id, lead_time_sec FROM ingredients').all() as {
        id: string;
        lead_time_sec: number;
      }[]
    ).map((row) => [row.id, row.lead_time_sec]),
  );
  const candidates: ForecastCandidate[] = readStock(ctx.db).map((row) => ({
    ingredient_id: row.ingredient_id,
    name: row.name,
    unit: row.unit,
    qty: row.qty,
    min_qty: row.min_qty,
    capacity_qty: row.capacity_qty,
    low: row.low_flagged,
    out: row.out_flagged,
    lead_time_sec: leadTimes.get(row.ingredient_id) as number,
  }));
  const covered = coveredIngredients(ctx);
  const samples = demandHistory(ctx.db);
  const now = ctx.clock.now();
  const proposal = proposeForecastRestock(candidates, covered, samples, now);
  if (!proposal) return null;

  const readings = new Map(
    (readForecast(candidates, samples, now) ?? []).map((reading) => [
      reading.ingredient_id,
      reading,
    ]),
  );
  const lines = candidates
    .filter((candidate) =>
      proposal.items.some((item) => item.ingredient_id === candidate.ingredient_id),
    )
    .map((candidate): StockContextLine => {
      const reading = readings.get(candidate.ingredient_id);
      return {
        ingredient_id: candidate.ingredient_id,
        name: candidate.name,
        unit: candidate.unit,
        qty: candidate.qty,
        min_qty: candidate.min_qty,
        capacity_qty: candidate.capacity_qty,
        expected: reading?.expected ?? 0,
        shortfall: reading?.shortfall ?? 0,
      };
    });
  return { proposal, lines };
}

const toProposal = (found: RestockProposal): Proposal => ({
  items: found.items,
  urgency: found.urgency,
  rationale: found.rationale,
});

/** What the forecast would have her order now, or `null` when nothing is needed. */
export function forecastProposal(ctx: Context): Proposal | null {
  const forecast = forecastNow(ctx);
  return forecast && toProposal(forecast.proposal);
}

/**
 * The hour to look ahead has come. She goes to the shelf to work it out when she is free and the forecast says
 * something must be ordered; otherwise nothing happens (no trip, no question for the model).
 */
export function scheduleForecast(ctx: Context, emit: Emit): void {
  if (readOpenTasks(ctx.db, 'stock_admin').length > 0) return; // busy: not now
  if (readAgent(ctx.db, 'stock_admin').state === 'thinking') return; // busy thinking
  if (!forecastNow(ctx)) return;
  enqueueWork(ctx, emit, 'stock_admin', 'stock_shelf', {
    label: 'forecasting',
    duration_sim_sec: TASK_DURATION_SEC.forecasting,
  });
}

/** She has worked it out at the shelf. She decides what to order, writes the report and carries it to the boss. */
export function decideForecast(ctx: Context, emit: Emit): void {
  const forecast = forecastNow(ctx);
  if (!forecast) return; // what she saw has been taken care of meanwhile
  proposeToBoss(ctx, emit, {
    kind: 'forecast',
    lines: forecast.lines,
    fallback: toProposal(forecast.proposal),
    refresh: () => forecastProposal(ctx),
  });
}
