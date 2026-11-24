import type { EventType, StoredEvent } from '@cafe/core';
import type { Db } from '../db/database';

// Applies one event to the projection tables with plain SQL (decision 019). The same function runs
// when an event is first written and when the projections are rebuilt from the log, so the two cannot
// drift apart. Every handler also checks that the event agrees with the current state: an event that
// contradicts the projection is a bug and must fail loudly (the surrounding transaction then rolls back).

export class ProjectionNotImplementedError extends Error {
  constructor(type: string) {
    super(`No projection for event "${type}" yet`);
    this.name = 'ProjectionNotImplementedError';
  }
}

/** Events that are only recorded in the log and change no projection table (docs/schema.md). */
const LOG_ONLY: ReadonlySet<EventType> = new Set<EventType>([
  'day_opened',
  'day_closed',
  'sim_time_advanced',
  'regular_expected',
  'regular_greeted',
  'agent_think_requested',
  'agent_decided',
]);

// Children before parents, so foreign keys stay satisfied while clearing.
export const PROJECTION_TABLES = [
  'complaints',
  'restock_orders',
  'reports',
  'memories',
  'agent_tasks',
  'agents',
  'order_items',
  'orders',
  'regular_state',
  'cafe_tables',
  'stock',
] as const;

const TABLE_IDS = [1, 2, 3] as const;

export function applyEvent(db: Db, event: StoredEvent): void {
  switch (event.type) {
    case 'world_initialized':
      return initializeWorld(db, event.payload);

    case 'order_created': {
      const { order_id, source, regular_id, table_id, items } = event.payload;
      db.prepare(
        `INSERT INTO orders (id, status, source, regular_id, table_id, created_at_sim)
         VALUES (?, 'placed', ?, ?, ?, ?)`,
      ).run(order_id, source, regular_id ?? null, table_id ?? null, event.sim_time);
      const insertItem = db.prepare(
        'INSERT INTO order_items (order_id, menu_item_id, qty) VALUES (?, ?, ?)',
      );
      for (const item of items) insertItem.run(order_id, item.menu_item_id, item.qty);
      return;
    }

    case 'order_held':
      return moveOrder(db, event.payload.order_id, 'placed', 'held');

    case 'cooking_started':
      return moveOrder(db, event.payload.order_id, 'placed', 'cooking');

    case 'cooking_done': {
      moveOrder(db, event.payload.order_id, 'cooking', 'done');
      db.prepare('UPDATE orders SET done_at_sim = ? WHERE id = ?').run(
        event.sim_time,
        event.payload.order_id,
      );
      return;
    }

    case 'stock_decreased': {
      const { ingredient_id, qty, new_qty, order_id } = event.payload;
      const status = db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(order_id);
      if (status !== 'cooking') {
        throw new Error(`stock_decreased: order ${order_id} is not cooking (status: ${status})`);
      }
      const current = currentQty(db, ingredient_id);
      if (current - qty !== new_qty) {
        throw new Error(
          `stock_decreased: ${ingredient_id} has ${current}, minus ${qty} cannot be ${new_qty}`,
        );
      }
      db.prepare('UPDATE stock SET qty = ? WHERE ingredient_id = ?').run(new_qty, ingredient_id);
      return;
    }

    case 'stock_low': {
      const { ingredient_id, qty } = event.payload;
      assertQty(db, 'stock_low', ingredient_id, qty);
      setFlag(db, 'low_flagged', ingredient_id);
      return;
    }

    case 'stock_out': {
      const { ingredient_id } = event.payload;
      assertQty(db, 'stock_out', ingredient_id, 0);
      setFlag(db, 'out_flagged', ingredient_id);
      return;
    }

    case 'complaint_received': {
      const { complaint_id, order_id, cause } = event.payload;
      const existing = db
        .prepare('SELECT id FROM complaints WHERE order_id = ?')
        .pluck()
        .get(order_id);
      if (existing !== undefined) {
        throw new Error(`order ${order_id} already has complaint ${existing}`);
      }
      db.prepare(
        `INSERT INTO complaints (id, order_id, cause, status, received_at_sim)
         VALUES (?, ?, ?, 'received', ?)`,
      ).run(complaint_id, order_id, cause, event.sim_time);
      return;
    }

    default:
      if (LOG_ONLY.has(event.type)) return;
      throw new ProjectionNotImplementedError(event.type);
  }
}

function initializeWorld(
  db: Db,
  payload: { initial_stock: Record<string, number>; initial_visits: Record<string, number> },
): void {
  for (const table of PROJECTION_TABLES) db.exec(`DELETE FROM ${table}`);

  assertSameKeys(
    'initial_stock',
    Object.keys(payload.initial_stock),
    db.prepare('SELECT id FROM ingredients').pluck().all() as string[],
  );
  assertSameKeys(
    'initial_visits',
    Object.keys(payload.initial_visits),
    db.prepare('SELECT id FROM regulars').pluck().all() as string[],
  );

  const insertStock = db.prepare('INSERT INTO stock (ingredient_id, qty) VALUES (?, ?)');
  for (const ingredient_id of Object.keys(payload.initial_stock).sort()) {
    insertStock.run(ingredient_id, payload.initial_stock[ingredient_id]);
  }
  const insertVisits = db.prepare(
    'INSERT INTO regular_state (regular_id, visits, present) VALUES (?, ?, 0)',
  );
  for (const regular_id of Object.keys(payload.initial_visits).sort()) {
    insertVisits.run(regular_id, payload.initial_visits[regular_id]);
  }
  const insertTable = db.prepare("INSERT INTO cafe_tables (id, state) VALUES (?, 'empty')");
  for (const id of TABLE_IDS) insertTable.run(id);
}

/** Moves an order between statuses, and refuses a move that is not allowed from the current status. */
function moveOrder(db: Db, orderId: number, from: string, to: string): void {
  const info = db
    .prepare('UPDATE orders SET status = ? WHERE id = ? AND status = ?')
    .run(to, orderId, from);
  if (info.changes !== 1) {
    const status = db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(orderId);
    throw new Error(
      `order ${orderId}: cannot go from "${from}" to "${to}" (current status: ${status ?? 'not found'})`,
    );
  }
}

function currentQty(db: Db, ingredientId: string): number {
  const qty = db.prepare('SELECT qty FROM stock WHERE ingredient_id = ?').pluck().get(ingredientId);
  if (typeof qty !== 'number') throw new Error(`no stock row for ingredient "${ingredientId}"`);
  return qty;
}

function assertQty(db: Db, eventType: string, ingredientId: string, expected: number): void {
  const current = currentQty(db, ingredientId);
  if (current !== expected) {
    throw new Error(`${eventType}: ${ingredientId} has ${current}, the event says ${expected}`);
  }
}

/** A signal may only be emitted once until a restock clears its flag, so a repeat is an error. */
function setFlag(db: Db, column: 'low_flagged' | 'out_flagged', ingredientId: string): void {
  const info = db
    .prepare(`UPDATE stock SET ${column} = 1 WHERE ingredient_id = ? AND ${column} = 0`)
    .run(ingredientId);
  if (info.changes !== 1) {
    throw new Error(`${column} is already set for "${ingredientId}": the signal was emitted twice`);
  }
}

function assertSameKeys(label: string, given: string[], expected: string[]): void {
  const missing = expected.filter((key) => !given.includes(key));
  if (missing.length > 0) throw new Error(`${label} is missing: ${missing.join(', ')}`);
}
