import { describe, expect, it, vi } from 'vitest';
import type { StoredEvent } from '@cafe/core';
import { ev } from '../test-support/events';
import { EventBus } from './bus';

function stored(id: number): StoredEvent {
  return { ...ev.orderCreated(id), id } as StoredEvent;
}

describe('EventBus', () => {
  it('hands the same batch, in order, to every subscriber', () => {
    const bus = new EventBus();
    const first: StoredEvent[][] = [];
    const second: StoredEvent[][] = [];
    bus.subscribe((events) => first.push(events));
    bus.subscribe((events) => second.push(events));
    const batch = [stored(1), stored(2), stored(3)];

    bus.publish(batch);

    expect(first).toEqual([batch]);
    expect(second).toEqual([batch]);
    expect(first[0]?.map((event) => event.id)).toEqual([1, 2, 3]);
  });

  it('notifies subscribers in the order they subscribed', () => {
    const bus = new EventBus();
    const calls: string[] = [];
    bus.subscribe(() => calls.push('a'));
    bus.subscribe(() => calls.push('b'));
    bus.publish([stored(1)]);
    expect(calls).toEqual(['a', 'b']);
  });

  it('stops notifying a subscriber after it unsubscribes', () => {
    const bus = new EventBus();
    const received: number[] = [];
    const unsubscribe = bus.subscribe((events) => received.push(events.length));
    bus.publish([stored(1)]);
    unsubscribe();
    bus.publish([stored(2)]);
    expect(received).toEqual([1]);
    expect(bus.subscriberCount).toBe(0);
  });

  it('keeps going when one subscriber throws, and reports the error', () => {
    const bus = new EventBus();
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const received: number[] = [];
      bus.subscribe(() => {
        throw new Error('broken listener');
      });
      bus.subscribe((events) => received.push(events.length));
      bus.publish([stored(1), stored(2)]);
      expect(received).toEqual([2]);
      expect(report).toHaveBeenCalledOnce();
    } finally {
      report.mockRestore();
    }
  });

  it('does nothing when nobody listens', () => {
    expect(() => new EventBus().publish([stored(1)])).not.toThrow();
  });

  it('is not affected by a subscriber that subscribes during a publish', () => {
    const bus = new EventBus();
    const late: number[] = [];
    bus.subscribe(() => {
      bus.subscribe((events) => late.push(events.length));
    });
    bus.publish([stored(1)]);
    expect(late).toEqual([]); // the new subscriber only sees the next publish
    bus.publish([stored(2)]);
    expect(late).toEqual([1]);
  });

  it('can be passed as ctx.publish without binding', () => {
    const bus = new EventBus();
    const received: number[] = [];
    bus.subscribe((events) => received.push(events.length));
    const { publish } = bus;
    publish([stored(1)]);
    expect(received).toEqual([1]);
  });
});
