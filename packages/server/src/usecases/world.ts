import { INITIAL_STOCK, INITIAL_VISITS, type StoredEvent } from '@cafe/core';
import type { Db } from '../db/database';
import { transact, type Context } from './context';

/** Starts a new world from the seed data: writes `world_initialized`, which resets the projections. */
export function initializeWorld(ctx: Context, options: { seed: number }): StoredEvent {
  return transact(ctx, (emit) =>
    emit({
      type: 'world_initialized',
      actor: 'system',
      origin: 'system',
      payload: {
        seed: options.seed,
        initial_stock: INITIAL_STOCK,
        initial_visits: INITIAL_VISITS,
      },
    }),
  );
}

export function hasWorld(db: Db): boolean {
  return (
    db.prepare("SELECT 1 FROM events WHERE type = 'world_initialized' LIMIT 1").get() !== undefined
  );
}
