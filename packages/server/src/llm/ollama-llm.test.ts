import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPrompt, decisionJsonSchema, type LLMRequest } from '@cafe/core';
import { OllamaError, OllamaLLM, type OllamaFetch } from './ollama-llm';

const request: LLMRequest = {
  purpose: 'stock_proposal',
  context: 'Pukul 10:00. Cek sebelum jam sibuk.',
  facts: {
    lines: [{ ingredient_id: 'susu', name: 'Susu', unit: 'ml', qty: 900, capacity_qty: 6000 }],
  },
};

const reply = (content: string, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify({ message: { role: 'assistant', content }, done: true }),
});
const failure = (status: number, error: string) => ({
  ok: false,
  status,
  text: async () => JSON.stringify({ error }),
});

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

function client(
  answers: ((sent: Sent, signal: AbortSignal) => Promise<ReturnType<typeof reply>>)[],
  overrides: Partial<ConstructorParameters<typeof OllamaLLM>[0]> = {},
) {
  const sent: Sent[] = [];
  const fetch: OllamaFetch = async (url, init) => {
    const entry = { url, body: JSON.parse(init.body) as Record<string, unknown> };
    sent.push(entry);
    const answer = answers[Math.min(sent.length, answers.length) - 1];
    if (!answer) throw new Error('no answer scripted');
    return answer(entry, init.signal);
  };
  const llm = new OllamaLLM({
    baseUrl: 'http://127.0.0.1:11434/',
    model: 'qwen3:4b',
    timeoutMs: 5000,
    fetch,
    ...overrides,
  });
  return { llm, sent };
}

const waitForAbort = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });

afterEach(() => vi.useRealTimers());

describe('OllamaLLM', () => {
  it('asks in one request: the prompt, the schema of the decision, temperature 0, no streaming', async () => {
    const { llm, sent } = client([async () => reply('{"ok":true}')]);
    await llm.complete(request);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('http://127.0.0.1:11434/api/chat');
    const prompt = buildPrompt(request);
    expect(sent[0]?.body).toMatchObject({
      model: 'qwen3:4b',
      stream: false,
      think: false,
      format: decisionJsonSchema('stock_proposal'),
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      options: { temperature: 0, seed: 42 },
    });
  });

  it('lets the model write only the ids of the ingredients it was told about', async () => {
    const { llm, sent } = client([async () => reply('{}')]);
    await llm.complete(request);
    const format = sent[0]?.body.format as {
      properties: { items: { items: { properties: { ingredient_id: { enum?: string[] } } } } };
    };
    expect(format.properties.items.items.properties.ingredient_id.enum).toEqual(['susu']);
  });

  it('hands the text of the answer on as it is, with the model and how long it took', async () => {
    let clock = 1000;
    const { llm } = client([async () => reply('{"items":[]}')], {
      now: () => {
        const now = clock;
        clock += 1234.4;
        return now;
      },
    });
    expect(await llm.complete(request)).toEqual({
      output: '{"items":[]}',
      model: 'qwen3:4b',
      latencyMs: 1234,
    });
  });

  it('sends the reason of the last refusal along on a retry', async () => {
    const { llm, sent } = client([async () => reply('{}')]);
    await llm.complete({ ...request, feedback: 'unknown ingredient "kopi susu"' });
    const messages = sent[0]?.body.messages as { content: string }[];
    expect(messages[1]?.content).toContain('unknown ingredient "kopi susu"');
  });

  it('does not tell a model that cannot think to stop thinking, and remembers it', async () => {
    const { llm, sent } = client([
      async () => failure(400, '"llama3.2:3b" does not support thinking') as never,
      async () => reply('{"a":1}'),
      async () => reply('{"a":2}'),
    ]);
    expect((await llm.complete(request)).output).toBe('{"a":1}');
    expect(sent).toHaveLength(2);
    expect(sent[0]?.body.think).toBe(false);
    expect('think' in (sent[1]?.body ?? {})).toBe(false);
    await llm.complete(request);
    expect(sent).toHaveLength(3);
    expect('think' in (sent[2]?.body ?? {})).toBe(false);
  });

  it('returns an empty answer as an empty text, for the validation to refuse', async () => {
    const { llm } = client([async () => reply('')]);
    expect((await llm.complete(request)).output).toBe('');
  });

  it('says how to install a model that is not there', async () => {
    const { llm } = client([async () => failure(404, 'model "qwen3:4b" not found') as never]);
    const error = await llm.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OllamaError);
    expect((error as OllamaError).kind).toBe('model_missing');
    expect((error as OllamaError).message).toContain('ollama pull qwen3:4b');
  });

  it('reports an error status of Ollama with its message', async () => {
    const { llm } = client([async () => failure(500, 'out of memory') as never]);
    const error = (await llm.complete(request).catch((e: unknown) => e)) as OllamaError;
    expect(error.kind).toBe('http');
    expect(error.message).toContain('500');
    expect(error.message).toContain('out of memory');
  });

  it('refuses an answer that is not JSON or has no message', async () => {
    const notJson = client([async () => ({ ok: true, status: 200, text: async () => 'oops' })]);
    expect(
      ((await notJson.llm.complete(request).catch((e: unknown) => e)) as OllamaError).kind,
    ).toBe('bad_response');
    const noMessage = client([
      async () => ({ ok: true, status: 200, text: async () => '{"done":true}' }),
    ]);
    expect(
      ((await noMessage.llm.complete(request).catch((e: unknown) => e)) as OllamaError).kind,
    ).toBe('bad_response');
  });

  it('says that it cannot reach Ollama when the connection fails', async () => {
    const { llm } = client([
      async () => {
        throw new Error('fetch failed');
      },
    ]);
    const error = (await llm.complete(request).catch((e: unknown) => e)) as OllamaError;
    expect(error.kind).toBe('unreachable');
    expect(error.message).toContain('http://127.0.0.1:11434');
    expect(error.message).toContain('fetch failed');
  });

  it('gives up after the time it may wait, without any real waiting in the test', async () => {
    vi.useFakeTimers();
    const { llm } = client([async (_sent, signal) => waitForAbort(signal)], { timeoutMs: 20_000 });
    const pending = llm.complete(request).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(19_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = (await pending) as OllamaError;
    expect(error.kind).toBe('timeout');
    expect(error.message).toContain('20 s');
  });

  it('stops a question that is waiting when it is closed, and refuses new ones', async () => {
    const { llm } = client([async (_sent, signal) => waitForAbort(signal)]);
    const pending = llm.complete(request).catch((e: unknown) => e);
    await Promise.resolve();
    llm.close();
    expect(((await pending) as OllamaError).kind).toBe('closed');
    const again = (await llm.complete(request).catch((e: unknown) => e)) as OllamaError;
    expect(again.kind).toBe('closed');
  });

  it('has no prompt for a purpose that is not put to a model yet, and says so', async () => {
    const { llm, sent } = client([async () => reply('{}')]);
    await expect(llm.complete({ purpose: 'complaint_triage', context: 'x' })).rejects.toThrow(
      /no prompt for the purpose/,
    );
    expect(sent).toHaveLength(0);
  });
});
