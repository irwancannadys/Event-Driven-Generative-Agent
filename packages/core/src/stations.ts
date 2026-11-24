import type { StationId } from './ids';

// Distances between stations, in tenths of a layout unit. Computed once from the layout in
// docs/reference/README.md and rounded to 0.1. The domain keeps only these distances: coordinates
// themselves live in the frontend (decision 002). Walk times come from here (decision 003).
export const DISTANCE_TENTHS: Record<StationId, Record<StationId, number>> = {
  cashier: {
    cashier: 0,
    kitchen: 100,
    stock_shelf: 134,
    boss_desk: 66,
    table_1: 40,
    table_2: 59,
    table_3: 80,
  },
  kitchen: {
    cashier: 100,
    kitchen: 0,
    stock_shelf: 65,
    boss_desk: 124,
    table_1: 80,
    table_2: 59,
    table_3: 40,
  },
  stock_shelf: {
    cashier: 134,
    kitchen: 65,
    stock_shelf: 0,
    boss_desk: 124,
    table_1: 98,
    table_2: 76,
    table_3: 55,
  },
  boss_desk: {
    cashier: 66,
    kitchen: 124,
    stock_shelf: 124,
    boss_desk: 0,
    table_1: 47,
    table_2: 65,
    table_3: 86,
  },
  table_1: {
    cashier: 40,
    kitchen: 80,
    stock_shelf: 98,
    boss_desk: 47,
    table_1: 0,
    table_2: 24,
    table_3: 48,
  },
  table_2: {
    cashier: 59,
    kitchen: 59,
    stock_shelf: 76,
    boss_desk: 65,
    table_1: 24,
    table_2: 0,
    table_3: 24,
  },
  table_3: {
    cashier: 80,
    kitchen: 40,
    stock_shelf: 55,
    boss_desk: 86,
    table_1: 48,
    table_2: 24,
    table_3: 0,
  },
};

/**
 * Virtual seconds to walk one layout unit. The prototype walks 3 units per real second, which at the
 * default clock speed (60 virtual seconds per real second) is 20 virtual seconds per unit.
 * Initial value, tuned in stage 3.
 */
export const WALK_SEC_PER_UNIT = 20;

/** Walk time between two stations in whole virtual seconds (rounded up). */
export function walkDurationSec(from: StationId, to: StationId): number {
  return Math.ceil((DISTANCE_TENTHS[from][to] * WALK_SEC_PER_UNIT) / 10);
}
