import {
  isInstant,
  validateDecision,
  type AgentId,
  type BuiltContext,
  type DecisionOf,
  type FallbackReason,
  type Purpose,
  type ValidationWorld,
} from '@cafe/core';
import { readStock } from '../db/queries';
import type { Context, Emit, EventDraft } from '../usecases/context';

// How an agent decides (decisions 010 and 034). The question is written down as `agent_think_requested`; the
// model answers, and the answer is checked before anything is done with it; an answer that is refused is
// asked for again with the error, up to two more times; then the rules decide. The result is written as
// `agent_decided`, with who decided: the model (`llm`), the rules because the model failed (`fallback`), or
// the rules because there is no model (`rule`). Every call of the model is kept in `llm_calls`. A replay
// reads the decision from the log and never asks the model again.

/** The first try and two retries (PROJECT_BRIEF principle 7). */
export const MAX_ATTEMPTS = 3;
const INPUT_SUMMARY_MAX = 500;

export interface DecideInput<P extends Purpose> {
  agent: AgentId;
  purpose: P;
  subject?: { ingredient_ids?: string[] };
  built: BuiltContext;
  world: ValidationWorld;
  /** What the rules decide: the answer when there is no model, or when its answers are refused. */
  fallback: DecisionOf<P>;
}

export interface Decided<P extends Purpose> {
  decision: DecisionOf<P>;
  origin: 'rule' | 'llm' | 'fallback';
  think_event_id: number;
}

/** What the checks against the world need: the stock, the shelves and what is already on order. */
export function validationWorld(
  ctx: Context,
  covered: ReadonlySet<string> = new Set(),
): ValidationWorld {
  return {
    ingredients: new Map(
      readStock(ctx.db).map((row) => [
        row.ingredient_id,
        { qty: row.qty, capacity_qty: row.capacity_qty, base_min_qty: row.base_min_qty },
      ]),
    ),
    covered,
  };
}

function keepCall(
  ctx: Context,
  purpose: Purpose,
  context: string,
  output: unknown,
  valid: boolean,
  latencyMs: number,
  model: string,
): number {
  const result = ctx.db
    .prepare(
      `INSERT INTO llm_calls (purpose, input_summary, output_json, valid, latency_ms, model, fallback_used, sim_time)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      purpose,
      context.slice(0, INPUT_SUMMARY_MAX),
      output === undefined ? null : JSON.stringify(output),
      valid ? 1 : 0,
      latencyMs,
      model,
      ctx.clock.now(),
    );
  return Number(result.lastInsertRowid);
}

export function decide<P extends Purpose>(
  ctx: Context,
  emit: Emit,
  input: DecideInput<P>,
): Decided<P> {
  const think = emit({
    type: 'agent_think_requested',
    actor: input.agent,
    origin: 'rule',
    payload: {
      agent_id: input.agent,
      purpose: input.purpose,
      ...(input.subject !== undefined && { subject: input.subject }),
    },
  });

  const write = (
    origin: Decided<P>['origin'],
    decision: DecisionOf<P>,
    extra: { llm_call_id?: number; fallback_reason?: FallbackReason; attempts?: number } = {},
  ): Decided<P> => {
    emit({
      type: 'agent_decided',
      actor: input.agent,
      origin,
      payload: {
        agent_id: input.agent,
        purpose: input.purpose,
        think_event_id: think.id,
        decision,
        ...extra,
      },
    } as EventDraft);
    return { decision, origin, think_event_id: think.id };
  };

  const llm = ctx.llm;
  if (!llm || !isInstant(llm)) return write('rule', input.fallback);

  let feedback: string | undefined;
  let lastReason: FallbackReason = 'invalid_json';
  let lastCall: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = llm.completeNow({
        purpose: input.purpose,
        context: input.built.context,
        facts: input.built.facts,
        ...(feedback !== undefined && { feedback }),
      });
    } catch {
      // The model gave no answer at all: that counts as a try that failed.
      lastReason = 'timeout';
      feedback = 'no answer';
      continue;
    }
    const checked = validateDecision(input.purpose, response.output, input.world);
    lastCall = keepCall(
      ctx,
      input.purpose,
      input.built.context,
      response.output,
      checked.ok,
      response.latencyMs,
      response.model,
    );
    if (checked.ok) {
      return write('llm', checked.decision, {
        llm_call_id: lastCall,
        ...(attempt > 1 && { attempts: attempt }),
      });
    }
    lastReason = checked.reason;
    feedback = checked.message;
  }
  if (lastCall !== undefined) {
    ctx.db.prepare('UPDATE llm_calls SET fallback_used = 1 WHERE id = ?').run(lastCall);
  }
  return write('fallback', input.fallback, { fallback_reason: lastReason, attempts: MAX_ATTEMPTS });
}
