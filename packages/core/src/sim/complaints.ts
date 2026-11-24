import type { SimTime } from '../time';
import { rand } from './rng';
import type { Scenario } from './scenario';

export interface WaitingOrder {
  id: number;
  created_at_sim: SimTime;
}

/**
 * Whether the customer of an order that has not been served yet complains, and why.
 * It needs two things: the order waited at least `complaintWaitSec`, and its own draw succeeded.
 * The draw belongs to the order (not to the moment of the check), so checking more or less often
 * never changes the outcome. Stage 2 only knows `slow_service`; other causes need cooked orders.
 */
export function complaintCause(
  order: WaitingOrder,
  now: SimTime,
  scenario: Scenario,
): 'slow_service' | null {
  if (now - order.created_at_sim < scenario.complaintWaitSec) return null;
  const draw = rand(scenario.seed, `complaint:${order.id}`) * 100;
  return draw < scenario.complaintChancePct ? 'slow_service' : null;
}
