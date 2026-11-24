import { describe, expect, it } from 'vitest';
import { FakeLLM, type FakeLine, type FallbackReason, type StoredEvent } from '@cafe/core';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import { createTestWorld } from '../test-support/world';
import { transact, type Context } from '../usecases/context';
import { MAX_ATTEMPTS, decide, validationWorld } from './decide';

// The pipeline of a decision (decisions 010 and 034): the question, the answer of the model checked, a retry
// with the error, and the rules when the model keeps failing. A proposal of milk is the example.

const RULE = {
  items: [{ ingredient_id: 'susu', qty: 3500 }],
  urgency: 'normal' as const,
  rationale: 'Susu tinggal 2500 ml: isi sampai penuh.',
};
const GOOD = {
  items: [{ ingredient_id: 'susu', qty: 3000 }],
  urgency: 'high',
  rationale: 'Pesan susu sebelum jam sibuk.',
};

function setup(script: FakeLine[] | undefined) {
  const world = createTestWorld();
  const fake = script ? new FakeLLM(script) : undefined;
  const ctx: Context = { ...world.ctx, ...(fake && { llm: fake }) };
  const run = () =>
    transact(ctx, (emit) =>
      decide(ctx, emit, {
        agent: 'stock_admin',
        purpose: 'stock_proposal',
        subject: { ingredient_ids: ['susu'] },
        built: { context: 'Susu tinggal 2500 ml.', facts: {} },
        world: validationWorld(ctx),
        fallback: RULE,
      }),
    );
  const events = (): StoredEvent[] =>
    world.published.filter((event) => event.type.startsWith('agent_'));
  const calls = () =>
    world.db.prepare('SELECT * FROM llm_calls ORDER BY id').all() as {
      id: number;
      valid: number;
      fallback_used: number;
      model: string;
      output_json: string | null;
    }[];
  return { world, fake, run, events, calls };
}

const answer = (...outputs: unknown[]): FakeLine[] => [
  {
    purpose: 'stock_proposal',
    answer: (_request, attempt) => outputs[Math.min(attempt, outputs.length - 1)],
  },
];

describe('decide without a model', () => {
  it('lets the rules decide, and writes the question and the decision as one step', () => {
    const { run, events, calls } = setup(undefined);
    const decided = run();
    expect(decided).toMatchObject({ origin: 'rule', decision: RULE });
    expect(events().map((event) => [event.type, event.origin])).toEqual([
      ['agent_think_requested', 'rule'],
      ['agent_decided', 'rule'],
    ]);
    expect(events()[1]?.payload).toMatchObject({
      purpose: 'stock_proposal',
      think_event_id: events()[0]?.id,
    });
    expect(calls()).toEqual([]);
  });
});

describe('decide with a model', () => {
  it('takes a good answer as the decision, and keeps the call', () => {
    const { run, events, calls } = setup(answer(GOOD));
    const decided = run();
    expect(decided).toMatchObject({ origin: 'llm', decision: GOOD });
    const decision = events()[1];
    expect(decision?.origin).toBe('llm');
    expect(decision?.payload).toMatchObject({ llm_call_id: calls()[0]?.id });
    expect((decision?.payload as { attempts?: number }).attempts).toBeUndefined();
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ valid: 1, fallback_used: 0, model: 'fake' });
    expect(JSON.parse(calls()[0]?.output_json ?? 'null')).toEqual(GOOD);
  });

  it('asks again with the error when an answer is refused, and takes the good answer of the retry', () => {
    const { run, events, calls, fake } = setup(answer('bukan json', GOOD));
    const decided = run();
    expect(decided.origin).toBe('llm');
    expect(fake?.calls).toHaveLength(2);
    expect(fake?.calls[0]?.request.feedback).toBeUndefined();
    expect(fake?.calls[1]?.request.feedback).toContain('not valid JSON');
    expect(events()[1]?.payload).toMatchObject({ attempts: 2, llm_call_id: calls()[1]?.id });
    expect(calls().map((call) => call.valid)).toEqual([0, 1]);
  });

  it.each<[string, unknown, FallbackReason]>([
    ['text that is not JSON', 'halo', 'invalid_json'],
    ['a value that is not one of the choices', { ...GOOD, urgency: 'sangat' }, 'invalid_enum'],
    [
      'an ingredient that does not exist',
      { ...GOOD, items: [{ ingredient_id: 'durian', qty: 10 }] },
      'unknown_id',
    ],
    [
      'more than fits on the shelf',
      { ...GOOD, items: [{ ingredient_id: 'susu', qty: 99_999 }] },
      'out_of_range',
    ],
    ['a rationale that is too long', { ...GOOD, rationale: 'a'.repeat(201) }, 'too_long'],
  ])('falls back to the rules when the answers are always refused: %s', (_what, bad, reason) => {
    const { run, events, calls } = setup(answer(bad));
    const decided = run();
    expect(decided).toMatchObject({ origin: 'fallback', decision: RULE });
    expect(events()[1]).toMatchObject({ origin: 'fallback' });
    expect(events()[1]?.payload).toMatchObject({ fallback_reason: reason, attempts: MAX_ATTEMPTS });
    expect(calls()).toHaveLength(MAX_ATTEMPTS);
    expect(calls().map((call) => call.valid)).toEqual([0, 0, 0]);
    expect(calls().map((call) => call.fallback_used)).toEqual([0, 0, 1]); // the last call is the one that fell back
  });

  it('falls back as stale when what was proposed is already covered while the model thought', () => {
    const world = createTestWorld();
    const fake = new FakeLLM(answer(GOOD));
    const ctx: Context = { ...world.ctx, llm: fake };
    const decided = transact(ctx, (emit) =>
      decide(ctx, emit, {
        agent: 'stock_admin',
        purpose: 'stock_proposal',
        built: { context: 'x', facts: {} },
        world: validationWorld(ctx, new Set(['susu'])),
        fallback: RULE,
      }),
    );
    expect(decided.origin).toBe('fallback');
    expect(world.published.at(-1)?.payload).toMatchObject({ fallback_reason: 'stale' });
  });

  it('counts a model that gives no answer at all as a failure, and does not stall the cafe', () => {
    const { run, events, calls } = setup([]); // a script without a line: the model throws
    const decided = run();
    expect(decided.origin).toBe('fallback');
    expect(events()[1]?.payload).toMatchObject({
      fallback_reason: 'timeout',
      attempts: MAX_ATTEMPTS,
    });
    expect(calls()).toEqual([]);
  });

  it('writes nothing at all when the step is rolled back', () => {
    const { world, fake } = setup(answer(GOOD));
    const ctx: Context = { ...world.ctx, llm: fake as FakeLLM };
    expect(() =>
      transact(ctx, (emit) => {
        decide(ctx, emit, {
          agent: 'stock_admin',
          purpose: 'stock_proposal',
          built: { context: 'x', facts: {} },
          world: validationWorld(ctx),
          fallback: RULE,
        });
        throw new Error('the step failed');
      }),
    ).toThrow('the step failed');
    expect(world.db.prepare('SELECT COUNT(*) FROM llm_calls').pluck().get()).toBe(0);
    expect(world.published).toEqual([]);
  });
});

describe('a replay of decisions', () => {
  it('reads them from the log: the model is not asked again and the state is the same', () => {
    const { world, run, fake } = setup(answer(GOOD));
    run();
    const asked = fake?.calls.length;
    const live = snapshotProjections(world.db);
    rebuildProjections(world.db);
    expect(fake?.calls.length).toBe(asked);
    expect(snapshotProjections(world.db)).toEqual(live);
  });
});
