import type { LLMClient, LLMRequest, LLMResponse } from '@cafe/core';

/**
 * A model that takes its time, for tests: it answers when the test says so (`answer`, `fail`), so a test can
 * let the clock run while a question is open. It is not instant, so the pipeline asks it outside the step.
 */
export class DeferredLLM implements LLMClient {
  readonly calls: LLMRequest[] = [];
  private readonly waiting: {
    request: LLMRequest;
    resolve: (response: LLMResponse) => void;
    reject: (error: Error) => void;
  }[] = [];
  closed = false;

  complete(request: LLMRequest): Promise<LLMResponse> {
    this.calls.push(request);
    return new Promise((resolve, reject) => this.waiting.push({ request, resolve, reject }));
  }

  /** How many questions are waiting for an answer. */
  get pending(): number {
    return this.waiting.length;
  }

  /** The oldest question that waits for an answer. */
  get oldest(): LLMRequest | undefined {
    return this.waiting[0]?.request;
  }

  /** Answers the oldest question. */
  answer(output: unknown, extra: { model?: string; latencyMs?: number } = {}): void {
    const next = this.waiting.shift();
    if (!next) throw new Error('no question is waiting');
    next.resolve({ output, model: extra.model ?? 'deferred', latencyMs: extra.latencyMs ?? 1500 });
  }

  /** The oldest question gets no answer (a timeout, a refused connection). */
  fail(message = 'no answer'): void {
    const next = this.waiting.shift();
    if (!next) throw new Error('no question is waiting');
    next.reject(new Error(message));
  }

  close(): void {
    this.closed = true;
  }
}

/** Lets the promises that are ready run: the continuation of an answer is a microtask, not part of the step. */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
