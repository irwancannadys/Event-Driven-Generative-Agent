import {
  DECISION_SCHEMAS,
  askUntilValid,
  type FallbackReason,
  type LLMClient,
  UNAVAILABLE_MODEL,
} from '@cafe/core';
import { toWorld, type Situation } from './situations';

// Judges a model on the situations (stage 6). Each situation is put to the model the way the cafe puts it,
// with the same loop (`askUntilValid`: up to three tries, each refusal explained), and the answer is judged
// with the same checks (`validateDecision` against the world of the situation). "Correct" means that the
// answer passes those rule-based checks, not that it is the best answer.

export interface SituationResult {
  id: string;
  purpose: Situation['purpose'];
  /** The first answer was JSON in the shape of the contract, before any check against the world. */
  jsonValid: boolean;
  /** The first answer passed every check. */
  firstTryCorrect: boolean;
  /** An answer passed within the tries: what the cafe would use. Otherwise the rules decide. */
  correct: boolean;
  attempts: number;
  fallbackReason?: FallbackReason;
  /** How many calls got no answer at all. */
  unanswered: number;
  latenciesMs: number[];
}

function hasShape(purpose: Situation['purpose'], output: unknown): boolean {
  let value = output;
  if (typeof output === 'string') {
    try {
      value = JSON.parse(output);
    } catch {
      return false;
    }
  }
  return DECISION_SCHEMAS[purpose].safeParse(value).success;
}

export async function evaluateSituation(
  client: LLMClient,
  situation: Situation,
  now: () => number,
): Promise<SituationResult> {
  const world = toWorld(situation);
  const result = await askUntilValid({
    client,
    request: situation.request,
    world: () => world,
    now,
  });
  if (!result) throw new Error('the evaluation was stopped');
  const [first] = result.attempts;
  return {
    id: situation.id,
    purpose: situation.purpose,
    jsonValid:
      first !== undefined &&
      first.model !== UNAVAILABLE_MODEL &&
      hasShape(situation.purpose, first.output),
    firstTryCorrect: first?.valid ?? false,
    correct: result.outcome.kind === 'llm',
    attempts: result.attempts.length,
    ...(result.outcome.kind === 'fallback' && { fallbackReason: result.outcome.reason }),
    unanswered: result.attempts.filter((attempt) => attempt.model === UNAVAILABLE_MODEL).length,
    latenciesMs: result.attempts.map((attempt) => attempt.latencyMs),
  };
}

export interface Summary {
  situations: number;
  jsonValidPct: number;
  firstTryCorrectPct: number;
  correctPct: number;
  fallbackPct: number;
  fallbackReasons: Record<string, number>;
  unanswered: number;
  meanAttempts: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
}

/** The value below which `p` percent of the (sorted) values lie, by the nearest rank. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] as number;
}

export function summarize(results: readonly SituationResult[]): Summary {
  const n = results.length;
  const pct = (count: number) => (n === 0 ? 0 : (count * 100) / n);
  const latencies = results.flatMap((result) => result.latenciesMs).sort((a, b) => a - b);
  const fallbackReasons: Record<string, number> = {};
  for (const result of results) {
    if (result.fallbackReason) {
      fallbackReasons[result.fallbackReason] = (fallbackReasons[result.fallbackReason] ?? 0) + 1;
    }
  }
  return {
    situations: n,
    jsonValidPct: pct(results.filter((result) => result.jsonValid).length),
    firstTryCorrectPct: pct(results.filter((result) => result.firstTryCorrect).length),
    correctPct: pct(results.filter((result) => result.correct).length),
    fallbackPct: pct(results.filter((result) => !result.correct).length),
    fallbackReasons,
    unanswered: results.reduce((sum, result) => sum + result.unanswered, 0),
    meanAttempts: n === 0 ? 0 : results.reduce((sum, result) => sum + result.attempts, 0) / n,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
  };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} dtk`;
const percent = (value: number) => `${Math.round(value)}%`;

/** The report of one model, as the table that goes into the decision about which model to use. */
export function formatReport(model: string, runs: number, groups: Record<string, Summary>): string {
  const rows = Object.entries(groups).map(([name, summary]) => {
    const reasons = Object.entries(summary.fallbackReasons)
      .map(([reason, count]) => `${reason} ${count}`)
      .join(', ');
    return [
      name.padEnd(14),
      String(summary.situations).padStart(4),
      percent(summary.jsonValidPct).padStart(10),
      percent(summary.firstTryCorrectPct).padStart(12),
      percent(summary.correctPct).padStart(9),
      percent(summary.fallbackPct).padStart(9),
      seconds(summary.latencyP50Ms).padStart(9),
      seconds(summary.latencyP95Ms).padStart(9),
      reasons === '' ? '' : `  (${reasons})`,
    ].join(' ');
  });
  return [
    `=== Evaluasi model ${model}: ${runs} putaran ===`,
    `${'keputusan'.padEnd(14)} ${'n'.padStart(4)} ${'JSON valid'.padStart(10)} ${'benar 1x coba'.padStart(12)} ${'benar'.padStart(9)} ${'fallback'.padStart(9)} ${'p50'.padStart(9)} ${'p95'.padStart(9)}`,
    ...rows,
    '"benar" = lolos pemeriksaan aturan (bahan dikenal, jumlah muat, batas dalam rentang, tidak basi) dalam tiga kali coba;',
    'sisanya diputuskan aturan (fallback). Latensi per panggilan, termasuk percobaan ulang.',
  ].join('\n');
}
