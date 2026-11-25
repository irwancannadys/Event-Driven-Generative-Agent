import {
  AGENT_HOME_STATION,
  RESTOCK_RETRY_SEC,
  TASK_DURATION_SEC,
  drawSupplier,
  etaFor,
  proposeRestock,
  restockReport,
  stockContext,
  type AgentId,
  type RestockCandidate,
  type StockContextLine,
  type StockLine,
} from '@cafe/core';
import { readReport, readStock, readWorldSeed, type ReportRow } from '../db/queries';
import { nextId, type Context, type Emit } from '../usecases/context';
import { decide, validationWorld, type Decided } from './decide';
import { enqueueGoto, enqueueWork, readOpenTasks } from './engine';

// The restock flow (decisions 022 and 024): a low stock sends the admin to check the shelf, she writes
// a "fill up to full" proposal, carries the report to the boss's desk and waits for the decision.
// Approved: she orders at the mock suppliers. Rejected: she waits an hour and looks again.

function hasOpenTask(ctx: Context, agentId: AgentId, label: string): boolean {
  return readOpenTasks(ctx.db, agentId).some((task) => task.label === label);
}

/** Something is low or out: the admin goes to check, unless a check is already on her list. */
export function scheduleStockCheck(ctx: Context, emit: Emit): void {
  if (hasOpenTask(ctx, 'stock_admin', 'checking_stock')) return;
  enqueueWork(ctx, emit, 'stock_admin', 'stock_shelf', {
    label: 'checking_stock',
    duration_sim_sec: TASK_DURATION_SEC.checking_stock,
  });
}

/** Ingredients that already have a proposal waiting, an approved one not yet ordered, or an order on its way. */
export function coveredIngredients(ctx: Context): Set<string> {
  const covered = new Set<string>();
  const addItems = (items: unknown) => {
    for (const item of (items ?? []) as StockLine[]) covered.add(item.ingredient_id);
  };
  const reports = ctx.db
    .prepare(
      `SELECT r.status, r.subject_json,
              EXISTS (SELECT 1 FROM restock_orders o WHERE o.report_id = r.id) AS ordered
       FROM reports r WHERE r.type = 'restock' AND r.status IN ('drafted', 'submitted', 'approved')`,
    )
    .all() as { status: string; subject_json: string; ordered: number }[];
  for (const report of reports) {
    if (report.status === 'approved' && report.ordered === 1) continue; // its orders are counted below
    addItems((JSON.parse(report.subject_json) as { items?: unknown }).items);
  }
  const orders = ctx.db
    .prepare("SELECT items_json FROM restock_orders WHERE status = 'ordered'")
    .pluck()
    .all() as string[];
  for (const json of orders) addItems(JSON.parse(json));
  return covered;
}

/** The stock of every ingredient as it is now, in the shape the restock rules want. */
export function candidatesNow(ctx: Context): RestockCandidate[] {
  return readStock(ctx.db).map((row) => ({
    ingredient_id: row.ingredient_id,
    name: row.name,
    unit: row.unit,
    qty: row.qty,
    min_qty: row.min_qty,
    capacity_qty: row.capacity_qty,
    low: row.low_flagged,
    out: row.out_flagged,
  }));
}

export type Proposal = {
  items: StockLine[];
  urgency: 'low' | 'normal' | 'high';
  rationale: string;
};

/** What the rule "fill up to full" would order now, or `null` when nothing is low (or all of it is covered). */
export function lowStockProposal(ctx: Context): Proposal | null {
  const proposal = proposeRestock(candidatesNow(ctx), coveredIngredients(ctx));
  return (
    proposal && { items: proposal.items, urgency: proposal.urgency, rationale: proposal.rationale }
  );
}

/**
 * The admin has checked the shelf. The rule "fill up to full" says what a proposal would be; she decides
 * (with the model, when there is one, and the rule when it fails), writes the report and carries it to the
 * boss. A model that answers at once decides in this very step; one that takes its time decides in a step of
 * its own (decision 037), and what she would order is then worked out again when the answer arrives.
 */
export function decideRestock(ctx: Context, emit: Emit): void {
  const candidates = candidatesNow(ctx);
  const proposal = lowStockProposal(ctx);
  if (!proposal) return;
  proposeToBoss(ctx, emit, {
    kind: 'low_stock',
    fallback: proposal,
    refresh: () => lowStockProposal(ctx),
    lines: candidates
      .filter((candidate) =>
        proposal.items.some((item) => item.ingredient_id === candidate.ingredient_id),
      )
      .map((candidate): StockContextLine => ({
        ingredient_id: candidate.ingredient_id,
        name: candidate.name,
        unit: candidate.unit,
        qty: candidate.qty,
        min_qty: candidate.min_qty,
        capacity_qty: candidate.capacity_qty,
        expected: null,
        shortfall: candidate.capacity_qty - candidate.qty,
      })),
  });
}

/**
 * The decision about what to order and the report for the boss, for a proposal of any kind: she decides,
 * writes `restock_proposed` from what was decided, and carries the report to the boss's desk. Used for
 * stock that is low and, before it is, for the forecast.
 */
export function proposeToBoss(
  ctx: Context,
  emit: Emit,
  input: {
    kind: 'low_stock' | 'forecast';
    lines: readonly StockContextLine[];
    /** What the rule orders now. */
    fallback: Proposal;
    /** What the rule orders by the time a slow model has answered, `null` when nothing is needed any more. */
    refresh: () => Proposal | null;
  },
): void {
  decide(
    ctx,
    emit,
    {
      agent: 'stock_admin',
      purpose: 'stock_proposal',
      subject: { ingredient_ids: input.fallback.items.map((item) => item.ingredient_id) },
      built: stockContext({ kind: input.kind, now: ctx.clock.now(), lines: input.lines }),
      world: () => validationWorld(ctx, coveredIngredients(ctx)),
      fallback: input.fallback,
      refresh: input.refresh,
    },
    (decided, emitDecided) => emitProposal(ctx, emitDecided, decided),
  );
}

/** What follows from a decision about what to order: the report for the boss, and the trip to carry it. */
export function emitProposal(ctx: Context, emit: Emit, decided: Decided<'stock_proposal'>): void {
  const { items, urgency, rationale } = decided.decision;
  const report_id = nextId(ctx.db, 'reports');
  emit({
    type: 'restock_proposed',
    actor: 'stock_admin',
    origin: decided.origin,
    payload: {
      report: { report_id, ...restockReport(candidatesNow(ctx), items, urgency) },
      items,
      urgency,
      rationale,
    },
  });
  enqueueWork(ctx, emit, 'stock_admin', 'boss_desk', {
    label: 'submitting_report',
    duration_sim_sec: TASK_DURATION_SEC.submitting_report,
    ref: { type: 'report', id: report_id },
  });
}

/** The report is on the boss's desk. The agent who carried it goes back to her place. */
export function submitReport(ctx: Context, emit: Emit, agentId: AgentId, reportId: number): void {
  if (agentId !== 'cashier' && agentId !== 'stock_admin') return;
  emit({
    type: 'report_submitted',
    actor: agentId,
    origin: 'rule',
    payload: { report_id: reportId },
  });
  enqueueGoto(ctx, emit, agentId, AGENT_HOME_STATION[agentId]);
}

/** The boss decided on a restock report. */
export function onRestockReportDecided(
  ctx: Context,
  emit: Emit,
  report: ReportRow,
  decision: 'approved' | 'rejected',
): void {
  if (decision === 'approved') {
    enqueueWork(ctx, emit, 'stock_admin', 'stock_shelf', {
      label: 'placing_order',
      duration_sim_sec: TASK_DURATION_SEC.placing_order,
      ref: { type: 'report', id: report.id },
    });
    return;
  }
  // Rejected: wait a while, then look again (decision 024).
  enqueueWork(ctx, emit, 'stock_admin', 'stock_shelf', {
    label: 'waiting_retry',
    duration_sim_sec: RESTOCK_RETRY_SEC,
    ref: { type: 'report', id: report.id },
  });
}

interface SupplierRow {
  weight_on_time: number;
  weight_late: number;
  weight_out: number;
  late_multiplier_pct: number;
  lead_time_sec: number;
}

/**
 * The admin orders what the boss approved, one order per ingredient. The mock supplier of each one
 * answers on time, late or out of stock, drawn from the seed (decision 006). Out of stock is written
 * as a failed order, and the admin looks at the shelf again.
 */
export function placeRestockOrders(ctx: Context, emit: Emit, reportId: number): void {
  const report = readReport(ctx.db, reportId);
  if (!report || report.status !== 'approved') return;
  const items = [...((report.subject.items ?? []) as StockLine[])].sort((a, b) =>
    a.ingredient_id < b.ingredient_id ? -1 : 1,
  );
  const seed = ctx.scenario?.seed ?? readWorldSeed(ctx.db);
  const now = ctx.clock.now();
  let failed = false;

  for (const item of items) {
    const supplier = ctx.db
      .prepare(
        `SELECT s.weight_on_time, s.weight_late, s.weight_out, s.late_multiplier_pct, i.lead_time_sec
         FROM suppliers_mock s JOIN ingredients i ON i.id = s.ingredient_id
         WHERE s.ingredient_id = ?`,
      )
      .get(item.ingredient_id) as SupplierRow;
    const restock_id = nextId(ctx.db, 'restock_orders');
    const outcome = drawSupplier(seed, restock_id, supplier);
    emit({
      type: 'restock_ordered',
      actor: 'stock_admin',
      origin: 'generator',
      payload: {
        restock_id,
        report_id: reportId,
        items: [item],
        supplier: outcome,
        eta_sim_time: etaFor(now, supplier.lead_time_sec, outcome, supplier.late_multiplier_pct),
      },
    });
    if (outcome === 'out') {
      failed = true;
      emit({
        type: 'restock_failed',
        actor: 'world',
        origin: 'generator',
        payload: { restock_id, reason: 'supplier_out' },
      });
    }
  }
  if (failed) scheduleStockCheck(ctx, emit);
}
