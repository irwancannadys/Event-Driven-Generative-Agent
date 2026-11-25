import { describe, expect, it } from 'vitest';
import type { LLMClient, LLMResponse } from '@cafe/core';
import {
  evaluateSituation,
  formatReport,
  percentile,
  summarize,
  type SituationResult,
} from './run-eval';
import type { Situation } from './situations';

const situation: Situation = {
  id: 'stock-test',
  purpose: 'stock_proposal',
  note: 'a test',
  request: { purpose: 'stock_proposal', context: 'Susu tipis.', facts: {} },
  world: {
    ingredients: { susu: { qty: 900, capacity_qty: 6000, base_min_qty: 1000 } },
    covered: [],
    blocked: [],
  },
};
const GOOD = {
  items: [{ ingredient_id: 'susu', qty: 3000 }],
  urgency: 'high',
  rationale: 'Pesan.',
};
const UNKNOWN = {
  items: [{ ingredient_id: 'kopi', qty: 10 }],
  urgency: 'normal',
  rationale: 'Kopi.',
};

function script(...answers: (unknown | Error)[]): LLMClient {
  let asked = 0;
  return {
    async complete(): Promise<LLMResponse> {
      asked += 1;
      const next = answers[Math.min(asked, answers.length) - 1];
      if (next instanceof Error) throw next;
      return { output: next, model: 'm', latencyMs: 1000 * asked };
    },
  };
}
const run = (client: LLMClient) => evaluateSituation(client, situation, () => 0);

describe('evaluateSituation', () => {
  it('counts an answer that passes at once', async () => {
    expect(await run(script(GOOD))).toEqual({
      id: 'stock-test',
      purpose: 'stock_proposal',
      jsonValid: true,
      firstTryCorrect: true,
      correct: true,
      attempts: 1,
      unanswered: 0,
      latenciesMs: [1000],
    });
  });

  it('tells a good shape from a good answer: JSON that names an unknown ingredient is valid but not correct', async () => {
    const result = await run(script(UNKNOWN, GOOD));
    expect(result).toMatchObject({
      jsonValid: true,
      firstTryCorrect: false,
      correct: true,
      attempts: 2,
    });
  });

  it('counts text that is not JSON as not valid, and the retry that fixes it as correct', async () => {
    expect(await run(script('Tentu! Ini usulan saya:', GOOD))).toMatchObject({
      jsonValid: false,
      firstTryCorrect: false,
      correct: true,
    });
  });

  it('falls back after three refusals and keeps the reason of the last one', async () => {
    const result = await run(script('x', UNKNOWN, { ...GOOD, urgency: 'urgent' }));
    expect(result).toMatchObject({ correct: false, attempts: 3, fallbackReason: 'invalid_enum' });
    expect(result.latenciesMs).toEqual([1000, 2000, 3000]);
  });

  it('counts the calls that got no answer', async () => {
    const result = await run(script(new Error('refused'), new Error('refused'), GOOD));
    expect(result).toMatchObject({ jsonValid: false, correct: true, unanswered: 2, attempts: 3 });
  });
});

describe('percentile', () => {
  it('takes the nearest rank', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(100);
    expect(percentile(values, 10)).toBe(10);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });
});

describe('summarize', () => {
  const result = (overrides: Partial<SituationResult>): SituationResult => ({
    id: 'x',
    purpose: 'stock_proposal',
    jsonValid: true,
    firstTryCorrect: true,
    correct: true,
    attempts: 1,
    unanswered: 0,
    latenciesMs: [1000],
    ...overrides,
  });

  it('gives the percentages, the reasons of the fallbacks, the attempts and the latencies', () => {
    const summary = summarize([
      result({}),
      result({ firstTryCorrect: false, attempts: 2, latenciesMs: [2000, 3000] }),
      result({
        jsonValid: false,
        firstTryCorrect: false,
        correct: false,
        attempts: 3,
        fallbackReason: 'unknown_id',
        unanswered: 1,
        latenciesMs: [4000, 5000, 6000],
      }),
      result({
        correct: false,
        firstTryCorrect: false,
        attempts: 3,
        fallbackReason: 'unknown_id',
        latenciesMs: [1000, 1000, 1000],
      }),
    ]);
    expect(summary).toMatchObject({
      situations: 4,
      jsonValidPct: 75,
      firstTryCorrectPct: 25,
      correctPct: 50,
      fallbackPct: 50,
      fallbackReasons: { unknown_id: 2 },
      unanswered: 1,
      meanAttempts: 2.25,
    });
    expect(summary.latencyP50Ms).toBe(2000);
    expect(summary.latencyP95Ms).toBe(6000);
  });

  it('is all zeros for nothing', () => {
    expect(summarize([])).toMatchObject({ situations: 0, correctPct: 0, latencyP95Ms: 0 });
  });
});

describe('formatReport', () => {
  it('is a table with a row per group, the model and the reasons of the fallbacks', () => {
    const summary = summarize([
      {
        id: 'x',
        purpose: 'stock_proposal',
        jsonValid: true,
        firstTryCorrect: false,
        correct: false,
        attempts: 3,
        fallbackReason: 'out_of_range',
        unanswered: 0,
        latenciesMs: [2500, 2500, 2500],
      },
    ]);
    const report = formatReport('qwen3:4b', 2, { stock_proposal: summary, semua: summary });
    expect(report).toContain('Evaluasi model qwen3:4b: 2 putaran');
    expect(report).toContain('stock_proposal');
    expect(report).toContain('semua');
    expect(report).toContain('100%');
    expect(report).toContain('2.5 dtk');
    expect(report).toContain('(out_of_range 1)');
  });
});
