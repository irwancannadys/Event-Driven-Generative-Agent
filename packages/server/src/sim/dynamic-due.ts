import { priorityOf, type AgentId, type DynamicDueItem, type SimTime } from '@cafe/core';
import type { Db } from '../db/database';

interface TaskEndRow {
  id: number;
  agent_id: AgentId;
  ends_at_sim: number;
}

interface ArrivalRow {
  id: number;
  eta_sim: number;
}

/**
 * The dynamic items that fall due first in the window (after, upTo] (decision 023). They are read from
 * the projections: tasks that are active and deliveries that are on their way. An item whose time has
 * already passed (it should have been handled before a crash) is due right now, not in the past.
 * Returns the whole group that shares the earliest time, deliveries before task ends.
 */
export function nextDynamicDue(db: Db, after: SimTime, upTo: SimTime): DynamicDueItem[] {
  if (upTo <= after) return [];
  const tasks = db
    .prepare(
      `SELECT id, agent_id, ends_at_sim FROM agent_tasks
       WHERE status = 'active' AND ends_at_sim IS NOT NULL AND ends_at_sim <= ?
       ORDER BY ends_at_sim, id`,
    )
    .all(upTo) as TaskEndRow[];
  const arrivals = db
    .prepare(
      `SELECT id, eta_sim FROM restock_orders
       WHERE status = 'ordered' AND eta_sim IS NOT NULL AND eta_sim <= ?
       ORDER BY eta_sim, id`,
    )
    .all(upTo) as ArrivalRow[];

  const items: DynamicDueItem[] = [
    ...arrivals.map((row): DynamicDueItem => ({
      kind: 'restock_arrival',
      time: Math.max(row.eta_sim, after),
      restock_id: row.id,
    })),
    ...tasks.map((row): DynamicDueItem => ({
      kind: 'task_end',
      time: Math.max(row.ends_at_sim, after),
      agent_id: row.agent_id,
      task_id: row.id,
    })),
  ];
  if (items.length === 0) return [];
  const earliest = Math.min(...items.map((item) => item.time));
  return items
    .filter((item) => item.time === earliest)
    .sort((a, b) => priorityOf(a) - priorityOf(b));
}
