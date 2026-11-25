import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeferredLLM, flushPromises } from '../test-support/deferred-llm';
import { Thinker } from './thinker';

afterEach(() => vi.restoreAllMocks());

/** A job that waits until the test lets it go. */
function gate() {
  let release: () => void = () => undefined;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { open, release };
}

describe('Thinker', () => {
  it('lets the questions go one at a time, in the order they were asked', async () => {
    const thinker = new Thinker(new DeferredLLM());
    const order: string[] = [];
    const first = gate();
    thinker.enqueue(async () => {
      order.push('first starts');
      await first.open;
      order.push('first ends');
    });
    thinker.enqueue(async () => {
      order.push('second starts');
    });
    await flushPromises();
    expect(order).toEqual(['first starts']);
    expect(thinker.open).toBe(2);
    first.release();
    await thinker.idle();
    expect(order).toEqual(['first starts', 'first ends', 'second starts']);
    expect(thinker.open).toBe(0);
  });

  it('reports a job that fails and goes on with the ones behind it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thinker = new Thinker(new DeferredLLM());
    const ran: string[] = [];
    thinker.enqueue(async () => {
      throw new Error('the step could not be applied');
    });
    thinker.enqueue(async () => {
      ran.push('second');
    });
    await thinker.idle();
    expect(ran).toEqual(['second']);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('waits also for the questions that are asked while it waits', async () => {
    const thinker = new Thinker(new DeferredLLM());
    const done: string[] = [];
    thinker.enqueue(async () => {
      thinker.enqueue(async () => {
        done.push('inner');
      });
      done.push('outer');
    });
    await thinker.idle();
    expect(done).toEqual(['outer', 'inner']);
  });

  it('is idle at once when nothing was asked', async () => {
    await expect(new Thinker(new DeferredLLM()).idle()).resolves.toBeUndefined();
  });

  it('stops the model and refuses new questions when it is closed', async () => {
    const llm = new DeferredLLM();
    const thinker = new Thinker(llm);
    expect(thinker.closed).toBe(false);
    thinker.close();
    expect(thinker.closed).toBe(true);
    expect(llm.closed).toBe(true);
    const ran: string[] = [];
    thinker.enqueue(async () => {
      ran.push('never');
    });
    await thinker.idle();
    expect(ran).toEqual([]);
  });

  it('measures time with a clock that a test can set', () => {
    let now = 5;
    const thinker = new Thinker(new DeferredLLM(), () => now);
    now = 9;
    expect(thinker.now()).toBe(9);
  });
});
