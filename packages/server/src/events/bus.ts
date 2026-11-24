import type { StoredEvent } from '@cafe/core';

export type EventListener = (events: StoredEvent[]) => void;

/**
 * The in-process event bus (persist-then-publish, decision 005). A use case writes its events to the
 * database first; only after the commit are they published here, in the order they were written.
 * The terminal log subscribes today, the WebSocket of stage 4 will too. One subscriber that throws
 * must not stop the others, and cannot undo events that are already saved, so its error is reported
 * and swallowed.
 */
export class EventBus {
  private readonly listeners = new Set<EventListener>();

  /** Returns a function that removes the subscription again. */
  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Arrow function on purpose: it can be handed over as `ctx.publish` without binding. */
  publish = (events: StoredEvent[]): void => {
    for (const listener of [...this.listeners]) {
      try {
        listener(events);
      } catch (error) {
        console.error('event subscriber failed:', error);
      }
    }
  };

  get subscriberCount(): number {
    return this.listeners.size;
  }
}
