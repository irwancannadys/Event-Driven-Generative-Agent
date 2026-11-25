import {
  type DecisionOf,
  type FallbackReason,
  type LLMClient,
  type LLMRequest,
  type Purpose,
} from './contracts';
import { validateDecision, type ValidationWorld } from './validate';

// The loop of asking a model that takes its time (PROJECT_BRIEF principle 7): ask, check the answer, ask
// again with the error up to two more times, and give up with the reason of the last refusal. It is pure
// (no database, no clock of its own) so that the server and the evaluation of a model run exactly the same
// loop: what the evaluation measures is what the cafe does.

/** The first try and two retries. */
export const MAX_ATTEMPTS = 3;

/** The model name of a try that got no answer at all. */
export const UNAVAILABLE_MODEL = 'unavailable';

/** One call of the model, and whether its answer passed the checks. */
export interface Attempt {
  output: unknown;
  valid: boolean;
  /** Real milliseconds. For a call that got no answer: how long it was waited for. */
  latencyMs: number;
  model: string;
}

export type Outcome<P extends Purpose> =
  { kind: 'llm'; decision: DecisionOf<P> } | { kind: 'fallback'; reason: FallbackReason };

export interface AskResult<P extends Purpose> {
  attempts: Attempt[];
  outcome: Outcome<P>;
}

export interface AskOptions<P extends Purpose> {
  client: LLMClient;
  request: Omit<LLMRequest, 'purpose' | 'feedback'> & { purpose: P };
  /** The world an answer is checked against. Asked for at every answer, for the world moves while the model thinks. */
  world: () => ValidationWorld;
  /** A clock in real milliseconds. */
  now: () => number;
  /** True when nobody wants the answer any more (the server is stopping): the loop then ends with `undefined`. */
  stopped?: () => boolean;
  maxAttempts?: number;
}

export async function askUntilValid<P extends Purpose>(
  options: AskOptions<P>,
): Promise<AskResult<P> | undefined> {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const attempts: Attempt[] = [];
  let feedback: string | undefined;
  let lastReason: FallbackReason = 'timeout';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = options.now();
    let response;
    try {
      response = await options.client.complete({
        ...options.request,
        ...(feedback !== undefined && { feedback }),
      });
    } catch {
      if (options.stopped?.()) return undefined;
      attempts.push({
        output: undefined,
        valid: false,
        latencyMs: options.now() - started,
        model: UNAVAILABLE_MODEL,
      });
      lastReason = 'timeout';
      feedback = 'no answer';
      continue;
    }
    if (options.stopped?.()) return undefined;
    // From here to the end of the turn nothing is awaited, so the world cannot move between check and use.
    const checked = validateDecision(options.request.purpose, response.output, options.world());
    attempts.push({
      output: response.output,
      valid: checked.ok,
      latencyMs: response.latencyMs,
      model: response.model,
    });
    if (checked.ok) return { attempts, outcome: { kind: 'llm', decision: checked.decision } };
    lastReason = checked.reason;
    feedback = checked.message;
  }
  return { attempts, outcome: { kind: 'fallback', reason: lastReason } };
}
