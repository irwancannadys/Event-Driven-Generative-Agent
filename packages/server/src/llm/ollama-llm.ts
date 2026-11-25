import {
  buildPrompt,
  decisionJsonSchema,
  type LLMClient,
  type LLMRequest,
  type LLMResponse,
} from '@cafe/core';

// The model that runs on this machine through Ollama (stage 6). It is asked in one request, with the
// answer constrained to the JSON schema of the decision (`format`), at temperature 0, and with a limit
// on the time we wait. What comes back is handed on as raw text: whether it is a sensible answer is
// `validateDecision`'s business, not ours. Nothing here needs a dependency: Node has `fetch`.

export type OllamaFailure =
  'unreachable' | 'timeout' | 'model_missing' | 'http' | 'bad_response' | 'closed';

/** Why a question to the model got no answer. The pipeline counts any of them as a failed attempt. */
export class OllamaError extends Error {
  constructor(
    readonly kind: OllamaFailure,
    message: string,
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

/** The part of `fetch` that we use, so that tests can answer without a network. */
export type OllamaFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface OllamaOptions {
  /** Where Ollama listens, for example `http://127.0.0.1:11434`. */
  baseUrl: string;
  model: string;
  /** How long to wait for one answer, in real milliseconds. */
  timeoutMs: number;
  fetch?: OllamaFetch;
  /** A clock in real milliseconds, for the latency. */
  now?: () => number;
  seed?: number;
  /** The most tokens the answer may have. */
  numPredict?: number;
  /** The size of the context window. */
  numCtx?: number;
  /** How long Ollama keeps the model in memory after an answer. */
  keepAlive?: string;
}

const defaultFetch: OllamaFetch = (url, init) => fetch(url, init);

interface ChatBody {
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  stream: false;
  format: Record<string, unknown>;
  think?: false;
  keep_alive: string;
  options: { temperature: 0; seed: number; num_predict: number; num_ctx: number };
}

export class OllamaLLM implements LLMClient {
  private readonly chatUrl: string;
  private readonly fetchFn: OllamaFetch;
  private readonly now: () => number;
  private readonly inflight = new Set<() => void>();
  private closed = false;
  /** Models that think before they answer (qwen3) must be told not to; the ones that cannot think refuse the flag. */
  private sendThink = true;

  constructor(private readonly options: OllamaOptions) {
    this.chatUrl = `${options.baseUrl.replace(/\/+$/, '')}/api/chat`;
    this.fetchFn = options.fetch ?? defaultFetch;
    this.now = options.now ?? (() => performance.now());
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const prompt = buildPrompt(request);
    const body: ChatBody = {
      model: this.options.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      stream: false,
      format: decisionJsonSchema(request.purpose),
      keep_alive: this.options.keepAlive ?? '30m',
      options: {
        temperature: 0,
        seed: this.options.seed ?? 42,
        num_predict: this.options.numPredict ?? 512,
        num_ctx: this.options.numCtx ?? 4096,
      },
    };
    const started = this.now();
    let answer = await this.post(this.sendThink ? { ...body, think: false } : body);
    if (answer.status === 400 && /think/i.test(answer.text) && this.sendThink) {
      this.sendThink = false;
      answer = await this.post(body);
    }
    const content = this.contentOf(answer);
    return {
      output: content,
      model: this.options.model,
      latencyMs: Math.max(0, Math.round(this.now() - started)),
    };
  }

  /** Stops every question that is waiting for an answer, and refuses new ones (the server is shutting down). */
  close(): void {
    this.closed = true;
    for (const stop of [...this.inflight]) stop();
  }

  private async post(body: ChatBody): Promise<{ status: number; text: string }> {
    if (this.closed) throw new OllamaError('closed', 'the server is stopping');
    const controller = new AbortController();
    let why: 'timeout' | 'closed' | undefined;
    const stop = (reason: 'timeout' | 'closed') => (): void => {
      why ??= reason;
      controller.abort();
    };
    const onClose = stop('closed');
    const timer = setTimeout(stop('timeout'), this.options.timeoutMs);
    this.inflight.add(onClose);
    try {
      const response = await this.fetchFn(this.chatUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      return { status: response.ok ? 200 : response.status, text };
    } catch (error) {
      if (why === 'timeout') {
        throw new OllamaError('timeout', `no answer within ${this.options.timeoutMs / 1000} s`);
      }
      if (why === 'closed') throw new OllamaError('closed', 'the server is stopping');
      throw new OllamaError(
        'unreachable',
        `cannot reach Ollama at ${this.options.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
      this.inflight.delete(onClose);
    }
  }

  private contentOf(answer: { status: number; text: string }): string {
    if (answer.status !== 200) {
      const detail = errorText(answer.text);
      if (answer.status === 404) {
        throw new OllamaError(
          'model_missing',
          `model "${this.options.model}" is not installed: run "ollama pull ${this.options.model}" (${detail})`,
        );
      }
      throw new OllamaError('http', `Ollama answered ${answer.status}: ${detail}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(answer.text);
    } catch {
      throw new OllamaError('bad_response', 'Ollama did not answer with JSON');
    }
    const message = (parsed as { message?: { content?: unknown } } | null)?.message;
    if (typeof message?.content !== 'string') {
      throw new OllamaError('bad_response', 'Ollama answered without a message');
    }
    return message.content;
  }
}

function errorText(text: string): string {
  try {
    const error = (JSON.parse(text) as { error?: unknown }).error;
    if (typeof error === 'string') return error;
  } catch {
    // not JSON: the text itself is the best we have
  }
  return text.slice(0, 200);
}
