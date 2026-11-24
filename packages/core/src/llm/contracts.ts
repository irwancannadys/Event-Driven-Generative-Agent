import { z } from 'zod';
import { TableIdSchema } from '../ids';
import {
  ComplaintCategorySchema,
  CompensationSchema,
  SeveritySchema,
  StockLineSchema,
  UrgencySchema,
} from '../schema-parts';

export const PURPOSES = [
  'waiter_initiative',
  'stock_proposal',
  'complaint_triage',
  'greeting',
  'reflection',
  'policy_review',
] as const;
export const PurposeSchema = z.enum(PURPOSES);
export type Purpose = z.infer<typeof PurposeSchema>;

// LLM output contracts (PROJECT_BRIEF section 7). Enums and ids are English. A valid output is not
// necessarily a sensible one: checks against the live world (unknown ids, stale answers) happen where
// the decision is applied.

export const WaiterInitiativeSchema = z
  .object({
    action: z.enum(['prepare_table', 'tidy_table', 'idle']),
    table_id: TableIdSchema.optional(),
    regular_id: z.string().min(1).optional(),
    reason: z.string().min(1).max(140),
  })
  .refine((decision) => decision.action === 'idle' || decision.table_id !== undefined, {
    message: 'table_id is required for prepare_table and tidy_table',
    path: ['table_id'],
  });

export const StockProposalSchema = z
  .object({
    items: z.array(StockLineSchema).min(1),
    urgency: UrgencySchema,
    rationale: z.string().min(1).max(200),
  })
  .refine(
    (proposal) =>
      new Set(proposal.items.map((item) => item.ingredient_id)).size === proposal.items.length,
    {
      message: 'each ingredient may appear only once',
      path: ['items'],
    },
  );

export const ComplaintTriageSchema = z.object({
  category: ComplaintCategorySchema,
  severity: SeveritySchema,
  draft_reply: z.string().min(1),
  suggested_compensation: CompensationSchema,
  needs_boss_decision: z.boolean(),
});

/**
 * The nightly review of the stock admin (decision 034): a short summary of the day and at most one change
 * of the policy, the minimum stock of one ingredient. Whether the ingredient exists and the number is
 * within what a boss may be asked to approve is checked where the decision is applied (`validateDecision`).
 */
export const PolicyReviewSchema = z.object({
  summary: z.string().min(1).max(300),
  change: z
    .object({
      ingredient_id: z.string().min(1),
      min_qty: z.number().int().nonnegative(),
    })
    .optional(),
  rationale: z.string().min(1).max(200),
});

/** Used for both `greeting` and `reflection`. */
export const TextDecisionSchema = z.object({
  text: z.string().min(1).max(200),
});

export const DECISION_SCHEMAS = {
  waiter_initiative: WaiterInitiativeSchema,
  stock_proposal: StockProposalSchema,
  complaint_triage: ComplaintTriageSchema,
  greeting: TextDecisionSchema,
  reflection: TextDecisionSchema,
  policy_review: PolicyReviewSchema,
} as const satisfies Record<Purpose, z.ZodType>;

export type DecisionOf<P extends Purpose> = z.infer<(typeof DECISION_SCHEMAS)[P]>;

export const FALLBACK_REASONS = [
  'invalid_json',
  'invalid_enum',
  'unknown_id',
  'out_of_range',
  'too_long',
  'timeout',
  'stale',
] as const;
export const FallbackReasonSchema = z.enum(FALLBACK_REASONS);
export type FallbackReason = z.infer<typeof FallbackReasonSchema>;

export interface LLMRequest {
  purpose: Purpose;
  /** A few lines of context built from the database (memory lives in tables, not in the prompt). */
  context: string;
  /**
   * The same situation as data, for a client that answers from a script (`FakeLLM`) and has no use for
   * the text. A real model reads `context` and ignores this.
   */
  facts?: Record<string, unknown>;
  /** Validation error from the previous attempt, sent on a retry. */
  feedback?: string;
}

export interface LLMResponse {
  /** Raw model output. The caller validates it with `DECISION_SCHEMAS[request.purpose]`. */
  output: unknown;
  model: string;
  latencyMs: number;
}

/** One implementation talks to Ollama, another (FakeLLM) answers from a scenario table. */
export interface LLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
}

/**
 * A client that answers at once, so that a decision can be written in the same step as the question
 * (decision 010: `FakeLLM` is instant, the asynchronous way belongs to stage 6).
 */
export interface InstantLLM extends LLMClient {
  completeNow(request: LLMRequest): LLMResponse;
}

export function isInstant(client: LLMClient): client is InstantLLM {
  return typeof (client as Partial<InstantLLM>).completeNow === 'function';
}
