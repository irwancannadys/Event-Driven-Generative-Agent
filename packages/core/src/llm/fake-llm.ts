import type { InstantLLM, LLMRequest, LLMResponse, Purpose } from './contracts';

// The model that is not one: it answers from a scenario table (PROJECT_BRIEF principle 5), so that stages 1
// to 5 run without any model and every answer is the same on every run. A line of the table says for which
// kind of decision and which situation it answers, and what. A line can also answer badly on purpose
// (broken JSON, an unknown id), which is how the fallback to the rules is tested.

export interface FakeLine {
  purpose: Purpose;
  /** Whether this line answers the request. Default: any request of the purpose. */
  when?: (request: LLMRequest, attempt: number) => boolean;
  /** The raw answer, as a model would give it: an object, or text. */
  answer: (request: LLMRequest, attempt: number) => unknown;
}

export interface FakeCall {
  request: LLMRequest;
  output: unknown;
}

export interface FakeOptions {
  model?: string;
}

export class FakeLLM implements InstantLLM {
  /** Every call, in order: what was asked and what was answered. */
  readonly calls: FakeCall[] = [];
  private readonly model: string;
  /** How many times each decision (the same purpose in the same situation) was asked, for the retries. */
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly script: readonly FakeLine[],
    options: FakeOptions = {},
  ) {
    this.model = options.model ?? 'fake';
  }

  completeNow(request: LLMRequest): LLMResponse {
    // A retry carries the error of the attempt before it: that tells the lines it is not the first try.
    const key = `${request.purpose}:${request.context}`;
    const attempt = request.feedback === undefined ? 0 : (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);

    const line = this.script.find(
      (candidate) =>
        candidate.purpose === request.purpose && (candidate.when?.(request, attempt) ?? true),
    );
    if (!line) throw new Error(`FakeLLM has no line for ${request.purpose}: add one to its script`);
    const output = line.answer(request, attempt);
    this.calls.push({ request, output });
    return { output, model: this.model, latencyMs: 0 };
  }

  complete(request: LLMRequest): Promise<LLMResponse> {
    return Promise.resolve(this.completeNow(request));
  }
}
