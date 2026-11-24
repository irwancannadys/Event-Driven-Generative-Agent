import type { Event, SimClock, StoredEvent } from '@cafe/core';
import type { Db } from '../db/database';
import { appendEvent } from '../events/store';

export interface Context {
  db: Db;
  clock: SimClock;
  /** Called with the events of a use case after its transaction committed (persist-then-publish). */
  publish?: (events: StoredEvent[]) => void;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event without its time: the clock fills `sim_time` in. */
export type EventDraft = DistributiveOmit<Event, 'sim_time'>;

/** A rule of the cafe was broken by the request (unknown menu item, wrong order status, ...). */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

/**
 * Runs a use case in one transaction. Everything written through `emit` (event plus projection) commits
 * together or not at all. Only after the commit are the new events handed to `publish`, so a listener
 * never sees an event that was rolled back (decision 005). A listener that throws cannot undo work that
 * is already saved, so its error is reported and swallowed.
 */
export function transact<T>(
  ctx: Context,
  work: (emit: (draft: EventDraft) => StoredEvent) => T,
): T {
  const written: StoredEvent[] = [];
  const emit = (draft: EventDraft): StoredEvent => {
    const stored = appendEvent(ctx.db, { ...draft, sim_time: ctx.clock.now() } as Event);
    written.push(stored);
    return stored;
  };
  const result = ctx.db.transaction(() => work(emit))();
  if (ctx.publish && written.length > 0) {
    try {
      ctx.publish(written);
    } catch (error) {
      console.error('publish failed after commit:', error);
    }
  }
  return result;
}

/** Next id for an entity table, allocated inside the transaction that creates it (decision 012). */
export function nextId(db: Db, table: 'orders' | 'complaints'): number {
  return (db.prepare(`SELECT COALESCE(MAX(id), 0) + 1 FROM ${table}`).pluck().get() as number) ?? 1;
}
