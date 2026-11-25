import {
  DEFAULT_FAKE_SCRIPT,
  FakeLLM,
  formatClock,
  makeScenario,
  type InstantLLM,
  type LLMRequest,
  type LLMResponse,
} from '@cafe/core';
import { blockedIngredients } from '../agents/review-flow';
import { coveredIngredients } from '../agents/restock-flow';
import { validationWorld } from '../agents/decide';
import { openSeededMemoryDb } from '../db/memory';
import { bootSimulation } from '../sim/simulation';
import { AutoBoss } from '../test-support/auto-boss';
import type { Context } from '../usecases/context';
import type { Situation } from './situations';

// Makes the situations of the evaluation from simulated days: a cafe with a scripted model runs, and every
// time the stock admin asks the model something, the question and the world it is judged against are kept.

/** A model that answers from the script and writes down what it was asked, and what the world looked like. */
class Recorder implements InstantLLM {
  ctx: Context | undefined;
  readonly seen: { request: LLMRequest; world: Situation['world'] }[] = [];
  private readonly inner = new FakeLLM(DEFAULT_FAKE_SCRIPT);

  completeNow(request: LLMRequest): LLMResponse {
    // The first question only: a question with feedback is the same situation asked again.
    if (request.feedback === undefined && this.ctx)
      this.seen.push({ request, world: this.worldNow() });
    return this.inner.completeNow(request);
  }

  complete(request: LLMRequest): Promise<LLMResponse> {
    return Promise.resolve(this.completeNow(request));
  }

  private worldNow(): Situation['world'] {
    const ctx = this.ctx as Context;
    const world = validationWorld(ctx, coveredIngredients(ctx));
    return {
      ingredients: Object.fromEntries(world.ingredients),
      covered: [...(world.covered ?? [])].sort(),
      blocked: [...blockedIngredients(ctx)].sort(),
    };
  }
}

export interface CollectOptions {
  seeds: readonly number[];
  days: number;
  crowdPct: number;
}

/** Every question the admin asked during those days, with the world at that moment. */
export function collectSituations(options: CollectOptions): Situation[] {
  const found: Situation[] = [];
  for (const seed of options.seeds) {
    const db = openSeededMemoryDb();
    const recorder = new Recorder();
    const sim = bootSimulation({
      db,
      scenario: makeScenario(seed, { crowdPct: options.crowdPct }),
      llm: recorder,
    });
    recorder.ctx = sim.ctx;
    new AutoBoss(sim).advanceTo(options.days * 86400);
    recorder.seen.forEach(({ request, world }, index) => {
      if (request.purpose !== 'stock_proposal' && request.purpose !== 'policy_review') return;
      const purpose = request.purpose;
      const facts = request.facts ?? {};
      const kind = String(facts.kind ?? '');
      const at = typeof facts.now === 'number' ? ` ${formatClock(facts.now)}` : '';
      found.push({
        id: `${purpose === 'stock_proposal' ? 'stock' : 'review'}-s${seed}-${String(index + 1).padStart(2, '0')}`,
        purpose,
        note:
          purpose === 'stock_proposal'
            ? `seed ${seed}, ${kind === 'forecast' ? 'forecast' : 'low stock'}${at}`
            : `seed ${seed}, review of day ${String(facts.day ?? '?')}`,
        request: { purpose, context: request.context, facts },
        world,
      });
    });
  }
  return found;
}

/** `count` of the items, evenly spread over the list, so that the evaluation sees early and late days alike. */
export function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  return Array.from(
    { length: count },
    (_, index) => items[Math.floor((index * items.length) / count)] as T,
  );
}

const kindOf = (situation: Situation): string => String(situation.request.facts.kind ?? '');

/**
 * The situations of the file: six questions about stock that is low, six about the look ahead (the two kinds
 * ask for different things), and eight about the review of a night.
 */
export function makeSituations(): Situation[] {
  const all = collectSituations({
    seeds: [11, 12, 13, 14, 15, 16, 17, 18],
    days: 4,
    crowdPct: 150,
  });
  const of = (purpose: Situation['purpose'], kind?: string) =>
    all.filter((s) => s.purpose === purpose && (kind === undefined || kindOf(s) === kind));
  return [
    ...spread(of('stock_proposal', 'low_stock'), 6),
    ...spread(of('stock_proposal', 'forecast'), 6),
    ...spread(of('policy_review'), 8),
  ];
}
