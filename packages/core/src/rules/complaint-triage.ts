import type { Compensation } from '../schema-parts';
import { DEFAULT_TEXT, type TextSet } from '../text';

export type ComplaintCause = 'slow_service' | 'wrong_order' | 'quality';

export interface ComplaintTriage {
  category: 'slow_service' | 'wrong_order' | 'quality' | 'other';
  severity: 1 | 2 | 3;
  draft_reply: string;
  suggested_compensation: Compensation;
  needs_boss_decision: boolean;
  /** Only when the boss has to decide. */
  report?: { title: string; body: string };
}

/** Customers who waited less than this get an apology only. */
export const MILD_WAIT_SEC = 40 * 60;
/** Customers who waited less than this (and more than the mild limit) get a discount. */
export const MEDIUM_WAIT_SEC = 60 * 60;

/**
 * The rule for a complaint (decision 024). For slow service the compensation grows with the wait:
 * under 40 minutes an apology (the cashier replies by herself), under 60 minutes a 10% discount,
 * beyond that a free item. Compensation always needs the boss. Stage 3 only generates slow service,
 * the other causes get a fixed, cautious rule so the function is total.
 */
export function triageComplaint(
  cause: ComplaintCause,
  waitedSec: number,
  orderId: number,
  text: TextSet = DEFAULT_TEXT,
): ComplaintTriage {
  let severity: 1 | 2 | 3;
  let compensation: Compensation;
  if (cause === 'slow_service') {
    if (waitedSec < MILD_WAIT_SEC) {
      severity = 1;
      compensation = 'none';
    } else if (waitedSec < MEDIUM_WAIT_SEC) {
      severity = 2;
      compensation = 'discount_10';
    } else {
      severity = 3;
      compensation = 'free_item';
    }
  } else if (cause === 'wrong_order') {
    severity = 2;
    compensation = 'free_item';
  } else {
    severity = 2;
    compensation = 'discount_10';
  }

  const needs_boss_decision = compensation !== 'none';
  const draft_reply = text.complaintReply(compensation, orderId);
  const triage: ComplaintTriage = {
    category: cause,
    severity,
    draft_reply,
    suggested_compensation: compensation,
    needs_boss_decision,
  };
  if (needs_boss_decision) {
    triage.report = {
      title: text.complaintTitle(cause, orderId),
      body: text.complaintBody(orderId, Math.round(waitedSec / 60), draft_reply, compensation),
    };
  }
  return triage;
}
