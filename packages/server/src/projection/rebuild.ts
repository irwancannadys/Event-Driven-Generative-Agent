import type { Db } from '../db/database';
import { listEvents } from '../events/store';
import { applyEvent } from './apply';

/**
 * Rebuilds the projection tables from the event log (decision 011). Replay starts at the last
 * `world_initialized`, which clears the projections first, and applies every later event with the same
 * `applyEvent` the live path uses. It runs in one transaction: if any event fails, nothing changes.
 * Returns how many events were applied.
 */
export function rebuildProjections(db: Db): number {
  const lastWorld = db
    .prepare("SELECT MAX(id) FROM events WHERE type = 'world_initialized'")
    .pluck()
    .get() as number | null;
  if (lastWorld === null) {
    throw new Error('Cannot rebuild projections: the log has no world_initialized event');
  }
  const events = listEvents(db, { afterId: lastWorld - 1 });
  db.transaction(() => {
    for (const event of events) applyEvent(db, event);
  })();
  return events.length;
}
