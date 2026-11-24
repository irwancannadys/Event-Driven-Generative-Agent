import { describe, expect, it } from 'vitest';
import { isInstant, type LLMRequest } from './contracts';
import { FakeLLM, type FakeLine } from './fake-llm';

const ask = (
  purpose: LLMRequest['purpose'],
  context = 'konteks',
  feedback?: string,
): LLMRequest => ({
  purpose,
  context,
  ...(feedback !== undefined && { feedback }),
});

describe('FakeLLM', () => {
  it('answers from the first line of the script that fits, the same on every run', () => {
    const script: FakeLine[] = [
      {
        purpose: 'greeting',
        when: (request) => request.context.includes('pagi'),
        answer: () => ({ text: 'Selamat pagi!' }),
      },
      { purpose: 'greeting', answer: () => ({ text: 'Halo!' }) },
    ];
    const fake = new FakeLLM(script);
    expect(fake.completeNow(ask('greeting', 'pagi hari')).output).toEqual({
      text: 'Selamat pagi!',
    });
    expect(fake.completeNow(ask('greeting', 'sore hari')).output).toEqual({ text: 'Halo!' });
    expect(new FakeLLM(script).completeNow(ask('greeting', 'pagi hari')).output).toEqual({
      text: 'Selamat pagi!',
    });
  });

  it('can answer from the facts of the request', () => {
    const fake = new FakeLLM([
      {
        purpose: 'greeting',
        answer: (request) => ({ text: `Halo ${String(request.facts?.name)}` }),
      },
    ]);
    expect(fake.completeNow({ ...ask('greeting'), facts: { name: 'Budi' } }).output).toEqual({
      text: 'Halo Budi',
    });
  });

  it('is instant: no latency, a model name, and the same answer by the asynchronous way', async () => {
    const fake = new FakeLLM([{ purpose: 'greeting', answer: () => ({ text: 'x' }) }], {
      model: 'fake-1',
    });
    expect(isInstant(fake)).toBe(true);
    const now = fake.completeNow(ask('greeting'));
    expect(now).toEqual({ output: { text: 'x' }, model: 'fake-1', latencyMs: 0 });
    expect(await fake.complete(ask('greeting'))).toEqual(now);
  });

  it('tells a line that it is a retry, so that the first answer can be bad and the second good', () => {
    const fake = new FakeLLM([
      {
        purpose: 'greeting',
        answer: (_request, attempt) => (attempt === 0 ? 'bukan json' : { text: 'sudah benar' }),
      },
    ]);
    expect(fake.completeNow(ask('greeting')).output).toBe('bukan json');
    expect(fake.completeNow(ask('greeting', 'konteks', 'urgency: salah')).output).toEqual({
      text: 'sudah benar',
    });
    // a new question starts again from the first attempt
    expect(fake.completeNow(ask('greeting', 'konteks lain')).output).toBe('bukan json');
  });

  it('keeps every call, for the tests that ask what the model was asked', () => {
    const fake = new FakeLLM([{ purpose: 'greeting', answer: () => ({ text: 'x' }) }]);
    fake.completeNow(ask('greeting', 'satu'));
    fake.completeNow(ask('greeting', 'dua'));
    expect(fake.calls.map((call) => call.request.context)).toEqual(['satu', 'dua']);
  });

  it('says so when its script has no line for a request, instead of making something up', () => {
    const fake = new FakeLLM([{ purpose: 'greeting', answer: () => ({}) }]);
    expect(() => fake.completeNow(ask('stock_proposal'))).toThrow(/no line for stock_proposal/);
  });
});
