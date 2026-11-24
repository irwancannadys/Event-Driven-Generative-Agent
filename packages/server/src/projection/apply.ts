import { AGENT_HOME_STATION, AGENT_IDS, type EventType, type StoredEvent } from '@cafe/core';
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
  'customer_arrived',
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
      const { order_id, source, regular_id, table_id, customer_id, items } = event.payload;
      db.prepare(
        `INSERT INTO orders (id, status, source, regular_id, table_id, customer_id, created_at_sim)
         VALUES (?, 'placed', ?, ?, ?, ?, ?)`,
      ).run(
        order_id,
        source,
        regular_id ?? null,
        table_id ?? null,
        customer_id ?? null,
        event.sim_time,
      );
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

    case 'order_resumed':
      return moveOrder(db, event.payload.order_id, 'held', 'placed');

    case 'agent_task_assigned': {
      const { agent_id, task_id, kind, station, label, duration_sim_sec, ref } = event.payload;
      const params = { ...(station && { station }), ...(label && { label }), ...(ref && { ref }) };
      db.prepare(
        `INSERT INTO agent_tasks (id, agent_id, kind, params_json, status, duration_sim_sec)
         VALUES (?, ?, ?, ?, 'queued', ?)`,
      ).run(task_id, agent_id, kind, JSON.stringify(params), duration_sim_sec);
      // The cook is given the order the moment the cashier has written it down. An order that was held
      // and is cooked again later keeps the first moment.
      if (label === 'cooking' && ref?.type === 'order') {
        db.prepare(
          'UPDATE orders SET recorded_at_sim = COALESCE(recorded_at_sim, ?) WHERE id = ?',
        ).run(event.sim_time, Number(ref.id));
      }
      return;
    }

    case 'agent_state_changed': {
      const { agent_id, state, station, task_id, eta_sim_time } = event.payload;
      const active = db
        .prepare("SELECT COUNT(*) FROM agent_tasks WHERE agent_id = ? AND status = 'active'")
        .pluck()
        .get(agent_id) as number;
      if ((state === 'walking' || state === 'working') && task_id === undefined) {
        throw new Error(`agent_state_changed: ${agent_id} is ${state} without a task`);
      }
      if (state === 'idle' && active > 0) {
        throw new Error(`agent_state_changed: ${agent_id} cannot be idle with an active task`);
      }
      if (task_id !== undefined) {
        if (eta_sim_time === undefined) {
          throw new Error(`agent_state_changed: task ${task_id} starts without an eta`);
        }
        if (active > 0) {
          throw new Error(`agent_state_changed: ${agent_id} already has an active task`);
        }
        const started = db
          .prepare(
            `UPDATE agent_tasks SET status = 'active', started_at_sim = ?, ends_at_sim = ?
             WHERE id = ? AND agent_id = ? AND status = 'queued'`,
          )
          .run(event.sim_time, eta_sim_time, task_id, agent_id);
        if (started.changes !== 1) {
          throw new Error(
            `agent_state_changed: task ${task_id} of ${agent_id} is not waiting in the queue`,
          );
        }
      }
      const moved = db
        .prepare('UPDATE agents SET state = ?, station = ? WHERE id = ?')
        .run(state, station, agent_id);
      if (moved.changes !== 1) throw new Error(`agent_state_changed: unknown agent "${agent_id}"`);
      return;
    }

    case 'agent_task_finished': {
      const { agent_id, task_id } = event.payload;
      const done = db
        .prepare(
          `UPDATE agent_tasks SET status = 'done'
           WHERE id = ? AND agent_id = ? AND status IN ('queued', 'active')`,
        )
        .run(task_id, agent_id);
      if (done.changes !== 1) {
        throw new Error(
          `agent_task_finished: task ${task_id} of ${agent_id} is not queued or active`,
        );
      }
      return;
    }

    case 'restock_proposed': {
      const { report, items, urgency, rationale } = event.payload;
      db.prepare(
        `INSERT INTO reports (id, type, title, body, status, subject_json, created_at_sim)
         VALUES (?, 'restock', ?, ?, 'drafted', ?, ?)`,
      ).run(
        report.report_id,
        report.title,
        report.body,
        JSON.stringify({ items, urgency, rationale }),
        event.sim_time,
      );
      return;
    }

    case 'report_submitted': {
      const info = db
        .prepare(
          `UPDATE reports SET status = 'submitted', submitted_at_sim = ?
           WHERE id = ? AND status = 'drafted'`,
        )
        .run(event.sim_time, event.payload.report_id);
      if (info.changes !== 1)
        throw reportError('report_submitted', db, event.payload.report_id, 'drafted');
      return;
    }

    case 'report_decided': {
      const info = db
        .prepare(
          `UPDATE reports SET status = ?, decided_at_sim = ?
           WHERE id = ? AND status = 'submitted'`,
        )
        .run(event.payload.decision, event.sim_time, event.payload.report_id);
      if (info.changes !== 1)
        throw reportError('report_decided', db, event.payload.report_id, 'submitted');
      return;
    }

    case 'restock_ordered': {
      const { restock_id, report_id, items, supplier, eta_sim_time } = event.payload;
      const status = db.prepare('SELECT status FROM reports WHERE id = ?').pluck().get(report_id);
      if (status !== 'approved') {
        throw new Error(
          `restock_ordered: report ${report_id} is not approved (status: ${status ?? 'not found'})`,
        );
      }
      db.prepare(
        `INSERT INTO restock_orders (id, report_id, items_json, supplier, status, ordered_at_sim, eta_sim)
         VALUES (?, ?, ?, ?, 'ordered', ?, ?)`,
      ).run(restock_id, report_id, JSON.stringify(items), supplier, event.sim_time, eta_sim_time);
      return;
    }

    case 'restock_failed': {
      const { restock_id } = event.payload;
      const supplier = db
        .prepare('SELECT supplier FROM restock_orders WHERE id = ?')
        .pluck()
        .get(restock_id);
      if (supplier !== 'out') {
        throw new Error(
          `restock_failed: restock ${restock_id} did not have a supplier that is out (supplier: ${supplier ?? 'not found'})`,
        );
      }
      const info = db
        .prepare("UPDATE restock_orders SET status = 'failed' WHERE id = ? AND status = 'ordered'")
        .run(restock_id);
      if (info.changes !== 1)
        throw new Error(`restock_failed: restock ${restock_id} is not waiting for delivery`);
      return;
    }

    case 'restock_arrived': {
      const { restock_id, items } = event.payload;
      const ordered = db
        .prepare("SELECT items_json FROM restock_orders WHERE id = ? AND status = 'ordered'")
        .pluck()
        .get(restock_id) as string | undefined;
      if (ordered === undefined)
        throw new Error(`restock_arrived: restock ${restock_id} is not waiting for delivery`);
      if (JSON.stringify(sortItems(JSON.parse(ordered))) !== JSON.stringify(sortItems(items))) {
        throw new Error(
          `restock_arrived: the delivery does not match the order of restock ${restock_id}`,
        );
      }
      db.prepare(
        "UPDATE restock_orders SET status = 'arrived', arrived_at_sim = ? WHERE id = ?",
      ).run(event.sim_time, restock_id);
      // Stock goes up. A flag is cleared again once the stock is back above its threshold.
      const refill = db.prepare(
        `UPDATE stock SET
           qty = qty + @qty,
           low_flagged = CASE WHEN qty + @qty > (SELECT min_qty FROM ingredients WHERE id = ingredient_id)
                              THEN 0 ELSE low_flagged END,
           out_flagged = CASE WHEN qty + @qty > 0 THEN 0 ELSE out_flagged END
         WHERE ingredient_id = @ingredient_id`,
      );
      for (const item of items) {
        if (refill.run({ qty: item.qty, ingredient_id: item.ingredient_id }).changes !== 1) {
          throw new Error(`restock_arrived: no stock row for ingredient "${item.ingredient_id}"`);
        }
      }
      return;
    }

    case 'complaint_triaged': {
      const { complaint_id, category, severity, suggested_compensation, report } = event.payload;
      if (report) {
        db.prepare(
          `INSERT INTO reports (id, type, title, body, status, subject_json, created_at_sim)
           VALUES (?, 'complaint', ?, ?, 'drafted', ?, ?)`,
        ).run(
          report.report_id,
          report.title,
          report.body,
          JSON.stringify({ complaint_id }),
          event.sim_time,
        );
      }
      const info = db
        .prepare(
          `UPDATE complaints SET status = 'triaged', category = ?, severity = ?,
             suggested_compensation = ?, report_id = ?
           WHERE id = ? AND status = 'received'`,
        )
        .run(category, severity, suggested_compensation, report?.report_id ?? null, complaint_id);
      if (info.changes !== 1)
        throw new Error(`complaint_triaged: complaint ${complaint_id} is not waiting for triage`);
      return;
    }

    case 'complaint_replied': {
      const { complaint_id, compensation } = event.payload;
      const info = db
        .prepare(
          `UPDATE complaints SET status = 'replied', final_compensation = ?, replied_at_sim = ?
           WHERE id = ? AND status = 'triaged'`,
        )
        .run(compensation, event.sim_time, complaint_id);
      if (info.changes !== 1)
        throw new Error(`complaint_replied: complaint ${complaint_id} is not triaged`);
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
  const insertAgent = db.prepare(
    'INSERT INTO agents (id, role, station, state) VALUES (?, ?, ?, ?)',
  );
  for (const id of AGENT_IDS) insertAgent.run(id, id, AGENT_HOME_STATION[id], 'idle');
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

function sortItems<T extends { ingredient_id: string; qty: number }>(items: readonly T[]) {
  return items
    .map(({ ingredient_id, qty }) => ({ ingredient_id, qty }))
    .sort((a, b) => (a.ingredient_id < b.ingredient_id ? -1 : 1));
}

function reportError(eventType: string, db: Db, reportId: number, expected: string): Error {
  const status = db.prepare('SELECT status FROM reports WHERE id = ?').pluck().get(reportId);
  return new Error(
    `${eventType}: report ${reportId} is not ${expected} (status: ${status ?? 'not found'})`,
  );
}
