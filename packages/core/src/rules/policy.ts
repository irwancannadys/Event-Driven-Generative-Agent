// The policy the stock admin may propose to change (decision 034): the minimum stock of one ingredient.
// A proposal may only move it within a range around the value the cafe started with, so that a model
// that is wrong cannot ask the boss to approve something absurd.

/** The lowest a proposed minimum may be, as a percentage of the starting value. */
export const POLICY_MIN_PCT = 50;
/** The highest a proposed minimum may be, as a percentage of the starting value. */
export const POLICY_MAX_PCT = 300;

export interface PolicyBounds {
  min: number;
  max: number;
}

/** What a minimum stock may be changed to: 0.5x to 3x the starting value, and never above the capacity. */
export function policyBounds(baseMinQty: number, capacityQty: number): PolicyBounds {
  const max = Math.min(capacityQty, Math.floor((baseMinQty * POLICY_MAX_PCT) / 100));
  const min = Math.min(max, Math.ceil((baseMinQty * POLICY_MIN_PCT) / 100));
  return { min, max };
}
