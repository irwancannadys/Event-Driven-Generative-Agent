import { describe, expect, it } from 'vitest';
import type { LLMClient, LLMRequest, LLMResponse } from './contracts';
import { MAX_ATTEMPTS, UNAVAILABLE_MODEL, askUntilValid } from './attempts';
import type { ValidationWorld } from './validate';

const world = (covered: string[] = []): ValidationWorld => ({
  ingredients: new Map([['susu', { qty: 900, capacity_qty: 6000, base_min_qty: 1000 }]]),
  covered: new Set(covered),
});
const GOOD = {
  items: [{ ingredient_id: 'susu', qty: 3000 }],
  urgency: 'high',
  rationale: 'Pesan susu.',
};

/** Answers from a list: a value is an answer, an Error is a call that failed. */
function script(...answers: (unknown | Error)[]) {
  const asked: LLMRequest[] = [];
  const client: LLMClient = {
    async complete(request): Promise<LLMResponse> {
      asked.push(request);
      const next = answers[Math.min(asked.length, answers.length) - 1];
      if (next instanceof Error) throw next;
      return { output: next, model: 'm', latencyMs: 100 * asked.length };
    },
  };
  return { client, asked };
}

const options = (client: LLMClient, extra: object = {}) => ({
  client,
  request: { purpose: 'stock_proposal' as const, context: 'x', facts: { a: 1 } },
  world: () => world(),
  now: () => 0,
  ...extra,
});

describe('askUntilValid', () => {
  it('takes the first answer that passes, with the one call', async () => {
    const { client, asked } = script(GOOD);
    const result = await askUntilValid(options(client));
    expect(result?.outcome).toEqual({ kind: 'llm', decision: GOOD });
    expect(result?.attempts).toEqual([{ output: GOOD, valid: true, latencyMs: 100, model: 'm' }]);
    expect(asked[0]).toEqual({ purpose: 'stock_proposal', context: 'x', facts: { a: 1 } });
  });

  it('asks again with the reason of the refusal, and takes the second answer when it passes', async () => {
    const { client, asked } = script('not json', GOOD);
    const result = await askUntilValid(options(client));
    expect(result?.outcome.kind).toBe('llm');
    expect(result?.attempts.map((attempt) => attempt.valid)).toEqual([false, true]);
    expect(asked[0]?.feedback).toBeUndefined();
    expect(asked[1]?.feedback).toContain('not valid JSON');
  });

  it('gives up after three refusals, with the reason of the last one', async () => {
    const { client, asked } = script('x', { items: [] }, { ...GOOD, urgency: 'urgent' });
    const result = await askUntilValid(options(client));
    expect(asked).toHaveLength(MAX_ATTEMPTS);
    expect(result?.outcome).toEqual({ kind: 'fallback', reason: 'invalid_enum' });
    expect(result?.attempts.every((attempt) => !attempt.valid)).toBe(true);
  });

  it('counts a call that gets no answer as a failed try, and keeps how long it was waited for', async () => {
    let clock = 0;
    const { client } = script(new Error('refused'), new Error('refused'), new Error('refused'));
    const result = await askUntilValid(
      options(client, {
        now: () => {
          clock += 250;
          return clock;
        },
      }),
    );
    expect(result?.outcome).toEqual({ kind: 'fallback', reason: 'timeout' });
    expect(result?.attempts).toEqual(
      Array.from({ length: 3 }, () => ({
        output: undefined,
        valid: false,
        latencyMs: 250,
        model: UNAVAILABLE_MODEL,
      })),
    );
  });

  it('can recover after a call that failed', async () => {
    const { client } = script(new Error('refused'), GOOD);
    const result = await askUntilValid(options(client));
    expect(result?.outcome.kind).toBe('llm');
    expect(result?.attempts.map((attempt) => attempt.model)).toEqual([UNAVAILABLE_MODEL, 'm']);
  });

  it('asks the world again for every answer, because the world moves while the model thinks', async () => {
    const { client } = script(GOOD, GOOD);
    let asks = 0;
    const result = await askUntilValid(
      options(client, {
        world: () => {
          asks += 1;
          return world(asks === 1 ? ['susu'] : []); // the milk is covered at the first answer only
        },
      }),
    );
    expect(asks).toBe(2);
    expect(result?.attempts.map((attempt) => attempt.valid)).toEqual([false, true]);
    expect(result?.outcome.kind).toBe('llm');
  });

  it('says stale when what was proposed is covered by the time the answer comes', async () => {
    const { client } = script(GOOD);
    const result = await askUntilValid(
      options(client, { world: () => world(['susu']), maxAttempts: 1 }),
    );
    expect(result?.outcome).toEqual({ kind: 'fallback', reason: 'stale' });
  });

  it('ends with nothing when nobody wants the answer any more', async () => {
    const { client } = script(GOOD);
    expect(await askUntilValid(options(client, { stopped: () => true }))).toBeUndefined();
    const failing = script(new Error('closed'));
    expect(await askUntilValid(options(failing.client, { stopped: () => true }))).toBeUndefined();
  });

  it('may be told to try fewer times', async () => {
    const { client, asked } = script('x');
    await askUntilValid(options(client, { maxAttempts: 1 }));
    expect(asked).toHaveLength(1);
  });
});
