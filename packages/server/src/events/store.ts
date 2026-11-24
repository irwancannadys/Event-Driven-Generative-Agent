import { eventSchema, type Event, type StoredEvent } from '@cafe/core';
import type { Db } from '../db/database';
import { applyEvent } from '../projection/apply';

export class InvalidEventError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid event: ${issues.join('; ')}`);
    this.name = 'InvalidEventError';
    this.issues = issues;
  }
}

/**
 * Validates an event, appends it to the log and applies it to the projections.
 * Must run inside a transaction (decision 012): if validation or the projection fails, the caller's
 * transaction rolls back and nothing stays behind, neither the event nor a half-updated projection.
 */
export function appendEvent(db: Db, input: Event): StoredEvent {
  if (!db.inTransaction) {
    throw new Error('appendEvent must run inside a transaction');
  }
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidEventError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(event)'}: ${issue.message}`),
    );
  }
  const event = parsed.data;
  const info = db
    .prepare(
      `INSERT INTO events (type, sim_time, actor, origin, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(event.type, event.sim_time, event.actor, event.origin, JSON.stringify(event.payload));
  const stored: StoredEvent = { ...event, id: Number(info.lastInsertRowid) };
  applyEvent(db, stored);
  return stored;
}

interface EventRow {
  id: number;
  type: string;
  sim_time: number;
  actor: string;
  origin: string;
  payload_json: string;
}

/** Reads events back in log order. Each row is validated again against the event schema. */
export function listEvents(db: Db, options: { afterId?: number } = {}): StoredEvent[] {
  const rows = db
    .prepare(
      `SELECT id, type, sim_time, actor, origin, payload_json
       FROM events WHERE id > ? ORDER BY id`,
    )
    .all(options.afterId ?? 0) as EventRow[];
  return rows.map((row) => ({
    ...eventSchema.parse({
      type: row.type,
      sim_time: row.sim_time,
      actor: row.actor,
      origin: row.origin,
      payload: JSON.parse(row.payload_json),
    }),
    id: row.id,
  }));
}
