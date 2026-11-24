import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@cafe/core';
import { connect, type ConnectionStatus, type SocketLike } from './connection';
import { socketUrl } from './url';

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close(): void {
    this.closed = true;
  }
}

/** A clock that only moves when the test says so: waiting calls queue up here. */
function harness() {
  const sockets: FakeSocket[] = [];
  const waits: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const statuses: ConnectionStatus[] = [];
  const messages: ServerMessage[] = [];
  const connection = connect(
    'ws://page/ws',
    { onMessage: (m) => messages.push(m), onStatus: (s) => statuses.push(s) },
    {
      open: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      schedule: (run, ms) => {
        const wait = { ms, run, cancelled: false };
        waits.push(wait);
        return wait;
      },
      cancel: (handle) => {
        (handle as { cancelled: boolean }).cancelled = true;
      },
    },
  );
  const pending = () => waits.filter((wait) => !wait.cancelled);
  /** Lets the oldest waiting retry happen. */
  const elapse = () => {
    const next = pending()[0];
    if (!next) throw new Error('nothing is waiting');
    next.cancelled = true;
    next.run();
  };
  return { connection, sockets, waits, pending, elapse, statuses, messages };
}

const snapshotText = JSON.stringify({ kind: 'clock', time: { sim_time: 1 } });

describe('connect', () => {
  it('asks for the address it was given and reports connecting, then open', () => {
    const { sockets, statuses } = harness();
    expect(sockets.map((socket) => socket.url)).toEqual(['ws://page/ws']);
    expect(statuses).toEqual(['connecting']);
    sockets[0]?.onopen?.();
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('hands over messages that are JSON with a kind, and ignores everything else', () => {
    const { sockets, messages } = harness();
    const socket = sockets[0] as FakeSocket;
    socket.onmessage?.({ data: snapshotText });
    socket.onmessage?.({ data: 'not json' });
    socket.onmessage?.({ data: JSON.stringify({ nothing: true }) });
    socket.onmessage?.({ data: new ArrayBuffer(4) });
    expect(messages).toEqual([{ kind: 'clock', time: { sim_time: 1 } }]);
  });

  it('tries again after the connection is lost, and says so', () => {
    const { sockets, statuses, elapse, pending } = harness();
    sockets[0]?.onopen?.();
    sockets[0]?.onclose?.();
    expect(statuses).toEqual(['connecting', 'open', 'closed']);
    expect(pending().map((wait) => wait.ms)).toEqual([500]);
    elapse();
    expect(sockets).toHaveLength(2);
    expect(statuses.at(-1)).toBe('connecting');
  });

  it('waits longer after every failed try, up to 5 seconds, and starts over after a success', () => {
    const { sockets, elapse, pending } = harness();
    const delays: number[] = [];
    for (let failed = 0; failed < 6; failed += 1) {
      sockets.at(-1)?.onclose?.();
      delays.push(pending()[0]?.ms ?? -1);
      elapse();
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
    sockets.at(-1)?.onopen?.(); // connected at last
    sockets.at(-1)?.onclose?.();
    expect(pending()[0]?.ms).toBe(500);
  });

  it('counts an error followed by a close as one lost connection, not two', () => {
    const { sockets, pending, statuses } = harness();
    sockets[0]?.onerror?.();
    sockets[0]?.onclose?.();
    expect(pending()).toHaveLength(1);
    expect(statuses.filter((status) => status === 'closed')).toHaveLength(1);
  });

  it('stops for good when it is closed: no more tries, no more calls', () => {
    const { connection, sockets, pending, statuses } = harness();
    sockets[0]?.onopen?.();
    sockets[0]?.onclose?.(); // a retry is now waiting
    connection.close();
    expect(pending()).toHaveLength(0);

    const { connection: other, sockets: otherSockets, statuses: otherStatuses } = harness();
    otherSockets[0]?.onopen?.();
    other.close();
    expect(otherSockets[0]?.closed).toBe(true);
    otherSockets[0]?.onclose?.(); // the browser reports the close afterwards
    expect(otherStatuses).toEqual(['connecting', 'open']);
    expect(statuses).toEqual(['connecting', 'open', 'closed']);
  });
});

describe('socketUrl', () => {
  it('follows the page: ws on http, wss on https, always the page host', () => {
    expect(socketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws');
    expect(socketUrl({ protocol: 'https:', host: 'cafe.example' })).toBe('wss://cafe.example/ws');
  });
});
