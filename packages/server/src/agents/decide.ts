import {
  MAX_ATTEMPTS,
  askUntilValid,
  isInstant,
  validateDecision,
  type AgentId,
  type Attempt,
  type BuiltContext,
  type DecisionOf,
  type FallbackReason,
  type InstantLLM,
  type LLMClient,
  type Outcome,
  type Purpose,
  type ValidationWorld,
} from '@cafe/core';
import { readStock } from '../db/queries';
import {
  afterCommit,
  transact,
  type Context,
  type Emit,
  type EventDraft,
} from '../usecases/context';
import { kick, readAgent } from './engine';
import type { Thinker } from './thinker';

// How an agent decides (decisions 010, 034 and 037). The question is written down as `agent_think_requested`;
// the model answers, and the answer is checked before anything is done with it; an answer that is refused is
// asked for again with the error, up to two more times; then the rules decide. The result is written as
// `agent_decided`, with who decided: the model (`llm`), the rules because the model failed (`fallback`), or
// the rules because there is no model (`rule`). Every call of the model is kept in `llm_calls`. A replay
// reads the decision from the log and never asks the model again.
//
// A model that answers at once (`FakeLLM`) is asked inside the step, and the whole decision is one step. A
// model that takes seconds cannot be waited for inside a transaction, so then it is two steps: this one
// writes the question and the agent starts to think; when the answer comes, a step of its own checks it
// against the world as it is by then, writes the decision, and does what follows from it (`then`).

export { MAX_ATTEMPTS };
const INPUT_SUMMARY_MAX = 500;

export interface DecideInput<P extends Purpose> {
  agent: AgentId;
  purpose: P;
  subject?: { ingredient_ids?: string[] };
  built: BuiltContext;
  /** The world the answer is checked against. Asked again when an answer arrives, for the world may have changed. */
  world: () => ValidationWorld;
  /** What the rules decide: the answer when there is no model, or when its answers are refused. */
  fallback: DecisionOf<P>;
  /**
   * What the rules decide now, for a model that took its time: `null` when there is nothing left to decide. When
   * absent, `fallback` stands. Not used for a model that answers at once, for the world cannot change meanwhile.
   */
  refresh?: () => DecisionOf<P> | null;
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
      Math.max(0, Math.round(latencyMs)),
      model,
      ctx.clock.now(),
    );
  return Number(result.lastInsertRowid);
}

export type DecidedExtra = {
  llm_call_id?: number;
  fallback_reason?: FallbackReason;
  attempts?: number;
};

export function writeDecided<P extends Purpose>(
  emit: Emit,
  input: Pick<DecideInput<P>, 'agent' | 'purpose'>,
  thinkEventId: number,
  origin: Decided<P>['origin'],
  decision: DecisionOf<P>,
  extra: DecidedExtra = {},
): Decided<P> {
  emit({
    type: 'agent_decided',
    actor: input.agent,
    origin,
    payload: {
      agent_id: input.agent,
      purpose: input.purpose,
      think_event_id: thinkEventId,
      decision,
      ...extra,
    },
  } as EventDraft);
  return { decision, origin, think_event_id: thinkEventId };
}

/**
 * The agent decides what to do about `input.purpose`, and `then` does what follows from the decision (writes
 * the report, the review, ...). With a model that answers at once, or with none, `then` runs right here in the
 * same step. With a model that takes its time it runs later, in the step of the answer, and not at all when
 * the server stops first (the question is then picked up by the next boot, decision 037).
 */
export function decide<P extends Purpose>(
  ctx: Context,
  emit: Emit,
  input: DecideInput<P>,
  then: (decided: Decided<P>, emit: Emit) => void,
): void {
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

  const llm = ctx.llm;
  if (!llm) {
    then(writeDecided(emit, input, think.id, 'rule', input.fallback), emit);
    return;
  }
  if (isInstant(llm)) {
    then(decideNow(ctx, emit, llm, input, think.id), emit);
    return;
  }
  startThinking(ctx, emit, llm, input, think.id, then);
}

/** The model answers at once: ask, check, ask again with the error, or let the rules decide. All in this step. */
function decideNow<P extends Purpose>(
  ctx: Context,
  emit: Emit,
  llm: InstantLLM,
  input: DecideInput<P>,
  thinkEventId: number,
): Decided<P> {
  const world = input.world();
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
    const checked = validateDecision(input.purpose, response.output, world);
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
      return writeDecided(emit, input, thinkEventId, 'llm', checked.decision, {
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
  return writeDecided(emit, input, thinkEventId, 'fallback', input.fallback, {
    fallback_reason: lastReason,
    attempts: MAX_ATTEMPTS,
  });
}

/** Step A: the agent starts to think. The question goes to the model once this step has committed. */
function startThinking<P extends Purpose>(
  ctx: Context,
  emit: Emit,
  llm: LLMClient,
  input: DecideInput<P>,
  thinkEventId: number,
  then: (decided: Decided<P>, emit: Emit) => void,
): void {
  const thinker = ctx.thinker;
  if (!thinker) throw new Error('a model that takes its time needs a thinker (decision 037)');
  emit({
    type: 'agent_state_changed',
    actor: input.agent,
    origin: 'rule',
    payload: {
      agent_id: input.agent,
      state: 'thinking',
      station: readAgent(ctx.db, input.agent).station,
    },
  });
  afterCommit(ctx, () =>
    thinker.enqueue(() => askUntilDecided(ctx, thinker, llm, input, thinkEventId, then)),
  );
}

/** Asks the model, up to three times, and applies the result. Nothing in here waits inside a transaction. */
async function askUntilDecided<P extends Purpose>(
  ctx: Context,
  thinker: Thinker,
  llm: LLMClient,
  input: DecideInput<P>,
  thinkEventId: number,
  then: (decided: Decided<P>, emit: Emit) => void,
): Promise<void> {
  const result = await askUntilValid({
    client: llm,
    request: { purpose: input.purpose, context: input.built.context, facts: input.built.facts },
    world: input.world,
    now: thinker.now,
    // The server is stopping: the next boot finishes this thought (decision 037).
    stopped: () => thinker.closed,
  });
  if (result) settle(ctx, input, thinkEventId, result.attempts, result.outcome, then);
}

/** The agent stops thinking and is free for the tasks that wait. `kick` starts them. */
export function freeAgent(ctx: Context, emit: Emit, agent: AgentId): void {
  emit({
    type: 'agent_state_changed',
    actor: agent,
    origin: 'rule',
    payload: { agent_id: agent, state: 'idle', station: readAgent(ctx.db, agent).station },
  });
}

/**
 * Step B: the answer is in. Writes what the model was asked and answered, the decision, lets the agent go
 * back to being free, and does what follows from the decision.
 */
function settle<P extends Purpose>(
  ctx: Context,
  input: DecideInput<P>,
  thinkEventId: number,
  attempts: readonly Attempt[],
  outcome: Outcome<P>,
  then: (decided: Decided<P>, emit: Emit) => void,
): void {
  transact(ctx, (emit) => {
    const calls = attempts.map((attempt) =>
      keepCall(
        ctx,
        input.purpose,
        input.built.context,
        attempt.output,
        attempt.valid,
        attempt.latencyMs,
        attempt.model,
      ),
    );
    const free = (): void => freeAgent(ctx, emit, input.agent);

    if (outcome.kind === 'llm') {
      const decided = writeDecided(emit, input, thinkEventId, 'llm', outcome.decision, {
        llm_call_id: calls[calls.length - 1] as number,
        ...(attempts.length > 1 && { attempts: attempts.length }),
      });
      free();
      then(decided, emit);
    } else {
      const last = calls[calls.length - 1];
      if (last !== undefined) {
        ctx.db.prepare('UPDATE llm_calls SET fallback_used = 1 WHERE id = ?').run(last);
      }
      const now = input.refresh ? input.refresh() : input.fallback;
      const extra = { attempts: MAX_ATTEMPTS };
      if (now === null) {
        // What she wanted to decide has been taken care of while the model thought: the thought is closed, nothing follows.
        writeDecided(emit, input, thinkEventId, 'fallback', input.fallback, {
          ...extra,
          fallback_reason: 'stale',
        });
        free();
      } else {
        const decided = writeDecided(emit, input, thinkEventId, 'fallback', now, {
          ...extra,
          fallback_reason: outcome.reason,
        });
        free();
        then(decided, emit);
      }
    }
    kick(ctx, emit, input.agent);
  });
}

/** The thinker of a context, for the places that need to wait until nothing is being thought (tests, shutdown). */
export function settled(ctx: Context): Promise<void> {
  return ctx.thinker ? ctx.thinker.idle() : Promise.resolve();
}
