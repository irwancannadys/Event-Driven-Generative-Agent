import type http from 'node:http';
import { WS_PATH, type ServerMessage, type Snapshot, type TimeView } from '@cafe/core';
import { WebSocket, WebSocketServer } from 'ws';
import type { EventBus } from '../events/bus';

// The WebSocket of decision 026: a page that connects gets a snapshot, then every batch of events as
// it is saved, and the virtual clock a few times a second. Pages only listen; what the boss does goes
// through the HTTP API.

export interface SocketOptions {
  bus: EventBus;
  snapshot: () => Snapshot;
  clock: () => TimeView;
  /** How often the clock is sent. Default 250 ms. */
  clockEveryMs?: number;
}

export interface SocketHub {
  /** Sends the clock to every page right now, e.g. after the boss changed the speed. */
  broadcastClock(): void;
  clientCount(): number;
  /** Disconnects every page and stops listening. Safe to call twice. */
  close(): Promise<void>;
}

/** A page that cannot keep up is dropped instead of making the server's memory grow. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

function send(client: WebSocket, message: ServerMessage): void {
  if (client.readyState !== WebSocket.OPEN) return;
  if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
    client.terminate();
    return;
  }
  try {
    client.send(JSON.stringify(message));
  } catch {
    client.terminate(); // one broken page must not hurt the others, or the commit that just happened
  }
}

export function attachWebSocket(server: http.Server, options: SocketOptions): SocketHub {
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (
    req: http.IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ): void => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== WS_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
  };
  server.on('upgrade', onUpgrade);

  const broadcast = (message: ServerMessage): void => {
    for (const client of wss.clients) send(client, message);
  };

  // The snapshot is built and sent in the same turn the page becomes a listener, and events are only
  // published after a commit in a turn of their own, so nothing falls between the two (decision 026).
  wss.on('connection', (client) => {
    client.on('error', () => client.terminate());
    send(client, { kind: 'snapshot', snapshot: options.snapshot() });
  });

  const unsubscribe = options.bus.subscribe((events) => broadcast({ kind: 'events', events }));
  const broadcastClock = (): void => broadcast({ kind: 'clock', time: options.clock() });
  const timer = setInterval(broadcastClock, options.clockEveryMs ?? 250);

  let closed: Promise<void> | undefined;
  return {
    broadcastClock,
    clientCount: () => wss.clients.size,
    close() {
      closed ??= new Promise<void>((resolve) => {
        clearInterval(timer);
        unsubscribe();
        server.off('upgrade', onUpgrade);
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      });
      return closed;
    },
  };
}
