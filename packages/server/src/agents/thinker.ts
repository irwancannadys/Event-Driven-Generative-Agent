import type { LLMClient } from '@cafe/core';

// Asks a model that takes its time (decision 037). A question is written down in one step and asked after
// that step committed; the answer is applied in a step of its own when it arrives. This is the part in the
// middle: the questions wait in line and go to the model one at a time (PROJECT_BRIEF principle 7), in the
// order they were asked. It holds no state of the cafe: that lives in the log and the tables.

export class Thinker {
  private tail: Promise<void> = Promise.resolve();
  private waiting = 0;
  private stopped = false;

  constructor(
    readonly llm: LLMClient,
    /** A clock in real milliseconds, for the latency of a call that got no answer. */
    readonly now: () => number = () => performance.now(),
  ) {}

  /** True once the server is shutting down: a question that is still open is left for the next boot. */
  get closed(): boolean {
    return this.stopped;
  }

  /** How many questions are open: being asked, or waiting for their turn. */
  get open(): number {
    return this.waiting;
  }

  /** Puts a job at the end of the line. A job that fails is reported and does not stop the ones behind it. */
  enqueue(job: () => Promise<void>): void {
    if (this.stopped) return;
    this.waiting += 1;
    this.tail = this.tail
      .then(job)
      .catch((error: unknown) => {
        console.error('a decision of the model could not be made or applied:', error);
      })
      .then(() => {
        this.waiting -= 1;
      });
  }

  /** Resolves when no question is open any more (also those asked while waiting). For tests and for shutdown. */
  async idle(): Promise<void> {
    while (this.waiting > 0) await this.tail;
  }

  /** Stops the question that is being asked and refuses new ones. */
  close(): void {
    this.stopped = true;
    (this.llm as { close?: () => void }).close?.();
  }
}
