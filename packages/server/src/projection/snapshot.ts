import type { Db } from '../db/database';
import { PROJECTION_TABLES } from './apply';

export type ProjectionSnapshot = Record<string, unknown[]>;

// Deterministic row order per table, so two snapshots of the same state compare equal.
const ORDER_BY: Record<(typeof PROJECTION_TABLES)[number], string> = {
  complaints: 'id',
  restock_orders: 'id',
  reports: 'id',
  memories: 'id',
  agent_tasks: 'id',
  agents: 'id',
  order_items: 'order_id, menu_item_id',
  orders: 'id',
  regular_state: 'regular_id',
  cafe_tables: 'id',
  stock: 'ingredient_id',
};

/** All projection rows as plain data, e.g. to compare the live state with a rebuilt one. */
export function snapshotProjections(db: Db): ProjectionSnapshot {
  const snapshot: ProjectionSnapshot = {};
  for (const table of PROJECTION_TABLES) {
    snapshot[table] = db.prepare(`SELECT * FROM ${table} ORDER BY ${ORDER_BY[table]}`).all();
  }
  return snapshot;
}
