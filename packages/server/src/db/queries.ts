import {
  AGENT_IDS,
  type AgentId,
  type OrderItem,
  type RecipeLine,
  type StationId,
} from '@cafe/core';
import type { Db } from './database';

// Read-only queries shared by the use cases and the HTTP API.

export interface MenuItemRow {
  id: string;
  name: string;
  price: number;
  cook_time_sec: number;
}

export interface StockRow {
  ingredient_id: string;
  name: string;
  unit: 'g' | 'ml' | 'pcs';
  qty: number;
  min_qty: number;
  capacity_qty: number;
  low_flagged: boolean;
  out_flagged: boolean;
}

export function readMenu(db: Db): MenuItemRow[] {
  return db
    .prepare('SELECT id, name, price, cook_time_sec FROM menu_items ORDER BY id')
    .all() as MenuItemRow[];
}

export function readRecipe(db: Db): RecipeLine[] {
  return db
    .prepare(
      `SELECT menu_item_id, ingredient_id, qty_per_portion
       FROM recipe_items ORDER BY menu_item_id, ingredient_id`,
    )
    .all() as RecipeLine[];
}

/** Current stock per ingredient (empty until the world is initialized). */
export function readStock(db: Db): StockRow[] {
  const rows = db
    .prepare(
      `SELECT s.ingredient_id, i.name, i.unit, s.qty, i.min_qty, i.capacity_qty,
              s.low_flagged, s.out_flagged
       FROM stock s JOIN ingredients i ON i.id = s.ingredient_id
       ORDER BY s.ingredient_id`,
    )
    .all() as (Omit<StockRow, 'low_flagged' | 'out_flagged'> & {
    low_flagged: number;
    out_flagged: number;
  })[];
  return rows.map((row) => ({
    ...row,
    low_flagged: row.low_flagged === 1,
    out_flagged: row.out_flagged === 1,
  }));
}

export interface OrderRow {
  id: number;
  status: 'placed' | 'held' | 'cooking' | 'done';
}

export function readOrder(db: Db, orderId: number): OrderRow | undefined {
  return db.prepare('SELECT id, status FROM orders WHERE id = ?').get(orderId) as
    OrderRow | undefined;
}

export function readOrderItems(db: Db, orderId: number): OrderItem[] {
  return db
    .prepare('SELECT menu_item_id, qty FROM order_items WHERE order_id = ? ORDER BY menu_item_id')
    .all(orderId) as OrderItem[];
}

/** The seed of the world: the one in the last `world_initialized` of the log (decision 020). */
export function readWorldSeed(db: Db): number {
  const payload = db
    .prepare(
      "SELECT payload_json FROM events WHERE type = 'world_initialized' ORDER BY id DESC LIMIT 1",
    )
    .pluck()
    .get() as string | undefined;
  if (payload === undefined) throw new Error('the log has no world_initialized event');
  return (JSON.parse(payload) as { seed: number }).seed;
}

export type ReportStatus = 'drafted' | 'submitted' | 'approved' | 'rejected';

export interface ReportRow {
  id: number;
  type: 'restock' | 'complaint';
  status: ReportStatus;
  title: string;
  body: string;
  /** Parsed `subject_json`: the items of a restock report, or the complaint a report is about. */
  subject: Record<string, unknown>;
  created_at_sim: number;
  submitted_at_sim: number | null;
  decided_at_sim: number | null;
}

const REPORT_COLUMNS = `id, type, status, title, body, subject_json, created_at_sim,
  submitted_at_sim, decided_at_sim`;

type RawReport = Omit<ReportRow, 'subject'> & { subject_json: string };

function toReportRow({ subject_json, ...rest }: RawReport): ReportRow {
  return { ...rest, subject: JSON.parse(subject_json) as Record<string, unknown> };
}

export function readReport(db: Db, reportId: number): ReportRow | undefined {
  const row = db.prepare(`SELECT ${REPORT_COLUMNS} FROM reports WHERE id = ?`).get(reportId) as
    RawReport | undefined;
  return row && toReportRow(row);
}

/** Reports in the order they were written, optionally only those with one status. */
export function readReports(db: Db, status?: ReportStatus): ReportRow[] {
  const rows = (
    status === undefined
      ? db.prepare(`SELECT ${REPORT_COLUMNS} FROM reports ORDER BY id`).all()
      : db.prepare(`SELECT ${REPORT_COLUMNS} FROM reports WHERE status = ? ORDER BY id`).all(status)
  ) as RawReport[];
  return rows.map(toReportRow);
}

export interface ComplaintRow {
  id: number;
  order_id: number;
  cause: 'slow_service' | 'wrong_order' | 'quality';
  status: 'received' | 'triaged' | 'replied';
  suggested_compensation: 'none' | 'discount_10' | 'free_item' | null;
  report_id: number | null;
  /** When the order of this complaint was placed. */
  order_created_at_sim: number;
}

export function readComplaint(db: Db, complaintId: number): ComplaintRow | undefined {
  return db
    .prepare(
      `SELECT c.id, c.order_id, c.cause, c.status, c.suggested_compensation, c.report_id,
              o.created_at_sim AS order_created_at_sim
       FROM complaints c JOIN orders o ON o.id = c.order_id WHERE c.id = ?`,
    )
    .get(complaintId) as ComplaintRow | undefined;
}

export interface OrderListRow {
  id: number;
  status: OrderRow['status'];
  source: 'walk_in' | 'regular';
  created_at_sim: number;
  done_at_sim: number | null;
  items: OrderItem[];
}

/** The newest `limit` orders (oldest first), optionally only those with one status. */
export function readOrders(
  db: Db,
  options: { status?: OrderRow['status']; limit: number },
): OrderListRow[] {
  const where = options.status === undefined ? '' : 'WHERE status = ?';
  const rows = db
    .prepare(
      `SELECT id, status, source, created_at_sim, done_at_sim FROM orders ${where}
       ORDER BY id DESC LIMIT ?`,
    )
    .all(...(options.status === undefined ? [] : [options.status]), options.limit) as Omit<
    OrderListRow,
    'items'
  >[];
  return rows.reverse().map((row) => ({ ...row, items: readOrderItems(db, row.id) }));
}

export interface AgentOverviewRow {
  id: AgentId;
  role: string;
  station: StationId;
  state: 'idle' | 'walking' | 'working' | 'thinking';
  /** The task that is running, if any. */
  task: {
    id: number;
    kind: 'goto' | 'work';
    label: string | null;
    station: StationId | null;
    started_at_sim: number | null;
    ends_at_sim: number | null;
  } | null;
  /** How many tasks wait behind the running one. */
  queued: number;
}

export function readAgentOverview(db: Db): AgentOverviewRow[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.role, a.station, a.state,
              t.id AS task_id, t.kind AS task_kind, t.params_json, t.started_at_sim, t.ends_at_sim,
              (SELECT COUNT(*) FROM agent_tasks q
                WHERE q.agent_id = a.id AND q.status = 'queued') AS queued
       FROM agents a
       LEFT JOIN agent_tasks t ON t.agent_id = a.id AND t.status = 'active'`,
    )
    .all() as {
    id: AgentId;
    role: string;
    station: StationId;
    state: AgentOverviewRow['state'];
    task_id: number | null;
    task_kind: 'goto' | 'work' | null;
    params_json: string | null;
    started_at_sim: number | null;
    ends_at_sim: number | null;
    queued: number;
  }[];
  const overview = rows.map((row): AgentOverviewRow => {
    const params =
      row.params_json === null
        ? {}
        : (JSON.parse(row.params_json) as { label?: string; station?: StationId });
    return {
      id: row.id,
      role: row.role,
      station: row.station,
      state: row.state,
      task:
        row.task_id === null || row.task_kind === null
          ? null
          : {
              id: row.task_id,
              kind: row.task_kind,
              label: params.label ?? null,
              station: params.station ?? null,
              started_at_sim: row.started_at_sim,
              ends_at_sim: row.ends_at_sim,
            },
      queued: row.queued,
    };
  });
  return overview.sort((a, b) => AGENT_IDS.indexOf(a.id) - AGENT_IDS.indexOf(b.id));
}

/** How many orders there are in each status (statuses without orders count 0). */
export function readOrderCounts(db: Db): Record<OrderRow['status'], number> {
  const counts = { placed: 0, held: 0, cooking: 0, done: 0 };
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all() as {
    status: OrderRow['status'];
    n: number;
  }[];
  for (const row of rows) counts[row.status] = row.n;
  return counts;
}

export interface RecentOrderRow {
  id: number;
  status: OrderRow['status'];
  source: 'walk_in' | 'regular';
  created_at_sim: number;
  done_at_sim: number | null;
}

/**
 * The orders that are not done, and those done at `doneSince` or later, oldest first. At most `limit`,
 * the newest ones, so that a world with a huge backlog cannot make the snapshot huge.
 */
export function readRecentOrders(db: Db, doneSince: number, limit: number): RecentOrderRow[] {
  const rows = db
    .prepare(
      `SELECT id, status, source, created_at_sim, done_at_sim FROM orders
       WHERE status <> 'done' OR done_at_sim >= ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(doneSince, limit) as RecentOrderRow[];
  return rows.reverse();
}

/** Complaints that have not been answered yet. */
export function readOpenComplaints(db: Db): { complaint_id: number; order_id: number }[] {
  return db
    .prepare(
      "SELECT id AS complaint_id, order_id FROM complaints WHERE status <> 'replied' ORDER BY id",
    )
    .all() as { complaint_id: number; order_id: number }[];
}
