import type { Event, InstantLLM, Scenario, SimClock, StoredEvent } from '@cafe/core';
import type { Db } from '../db/database';
import { appendEvent } from '../events/store';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event without its time: the clock fills `sim_time` in. */
export type EventDraft = DistributiveOmit<Event, 'sim_time'>;

/** Writes an event (and its projection) inside the running step. */
export type Emit = (draft: EventDraft) => StoredEvent;

export interface Context {
  db: Db;
  clock: SimClock;
  /** Called with the events of a step after its transaction committed (persist-then-publish). */
  publish?: (events: StoredEvent[]) => void;
  /**
   * The characters' reactions (decision 022): called for every event written in a step, inside the
   * step's transaction, in the order the events were written. A reaction writes more events through
   * `emit`, and those get their own reactions in turn.
   */
  react?: (ctx: Context, event: StoredEvent, emit: Emit) => void;
  /** Safety net against reactions that keep triggering each other. Default 10000 per step. */
  maxReactions?: number;
  /** The scenario of this world: the reactions need its seed for the supplier's behaviour. */
  scenario?: Scenario;
  /**
   * The model that helps the agents decide (decision 034). Without one the rules decide, as before. Replay
   * never uses it: the decisions are in the log.
   */
  llm?: InstantLLM;
}

/** A rule of the cafe was broken by the request (unknown menu item, wrong order status, ...). */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

const DEFAULT_MAX_REACTIONS = 10_000;

interface Step {
  written: StoredEvent[];
  queue: StoredEvent[];
  emit: Emit;
}

/** The step that is running on a database right now, so that nested `transact` calls can join it. */
const activeSteps = new WeakMap<Db, Step>();

function createStep(ctx: Context): Step {
  const written: StoredEvent[] = [];
  const queue: StoredEvent[] = [];
  const emit: Emit = (draft) => {
    const stored = appendEvent(ctx.db, { ...draft, sim_time: ctx.clock.now() } as Event);
    written.push(stored);
    queue.push(stored);
    return stored;
  };
  return { written, queue, emit };
}

function drainReactions(ctx: Context, step: Step): void {
  if (!ctx.react) {
    step.queue.length = 0;
    return;
  }
  const limit = ctx.maxReactions ?? DEFAULT_MAX_REACTIONS;
  for (let handled = 0; step.queue.length > 0; handled += 1) {
    if (handled >= limit) {
      throw new Error(
        `more than ${limit} reactions in one step: do reactions trigger each other forever?`,
      );
    }
    const event = step.queue.shift() as StoredEvent;
    ctx.react(ctx, event, step.emit);
  }
}

/**
 * Runs one step in one transaction (decision 022). Everything written through `emit`, by the use
 * case itself and by every reaction it sets off, commits together or not at all. Only after the commit
 * are the new events handed to `publish`, so a listener never sees an event that was rolled back
 * (decision 005). A listener that throws cannot undo work that is already saved, so its error is
 * reported and swallowed.
 *
 * `transact` can be nested: a use case called from inside a step joins that step instead of opening
 * its own, and its events are published once, with the rest, when the outermost step commits.
 */
export function transact<T>(ctx: Context, work: (emit: Emit) => T): T {
  const running = activeSteps.get(ctx.db);
  if (running) return work(running.emit);

  const step = createStep(ctx);
  activeSteps.set(ctx.db, step);
  let result: T;
  try {
    result = ctx.db.transaction(() => {
      const value = work(step.emit);
      drainReactions(ctx, step);
      return value;
    })();
  } finally {
    activeSteps.delete(ctx.db);
  }

  if (ctx.publish && step.written.length > 0) {
    try {
      ctx.publish(step.written);
    } catch (error) {
      console.error('publish failed after commit:', error);
    }
  }
  return result;
}

/** Entity tables whose ids are allocated inside the transaction that creates them (decision 012). */
export type IdTable = 'orders' | 'complaints' | 'reports' | 'restock_orders' | 'agent_tasks';

export function nextId(db: Db, table: IdTable): number {
  return (db.prepare(`SELECT COALESCE(MAX(id), 0) + 1 FROM ${table}`).pluck().get() as number) ?? 1;
}
