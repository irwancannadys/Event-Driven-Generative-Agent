import type { ServerMessage } from '@cafe/core';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface ConnectionHandlers {
  onMessage(message: ServerMessage): void;
  onStatus(status: ConnectionStatus): void;
}

/** The little of the browser's WebSocket that the connection needs, so a test can stand in for it. */
export interface SocketLike {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

export interface ConnectionOptions {
  /** Makes a socket for the address. Default: the browser's `WebSocket`. */
  open?: (url: string) => SocketLike;
  /** Waits before trying again: 0.5 s, doubling up to 5 s, back to 0.5 s after a successful connect. */
  firstRetryMs?: number;
  maxRetryMs?: number;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface Connection {
  close(): void;
}

function parse(data: unknown): ServerMessage | undefined {
  if (typeof data !== 'string') return undefined;
  try {
    const message = JSON.parse(data) as { kind?: unknown };
    return typeof message.kind === 'string' ? (message as ServerMessage) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keeps a WebSocket to the server open (decision 026). Every new connection starts with a snapshot
 * from the server, so when the server restarts or the network drops the page simply connects again
 * and is handed the world as it is, nothing is repaired on the page's side.
 */
export function connect(
  url: string,
  handlers: ConnectionHandlers,
  options: ConnectionOptions = {},
): Connection {
  const open = options.open ?? ((target) => new WebSocket(target) as unknown as SocketLike);
  const schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as number));
  const firstRetryMs = options.firstRetryMs ?? 500;
  const maxRetryMs = options.maxRetryMs ?? 5000;

  let retryMs = firstRetryMs;
  let socket: SocketLike | undefined;
  let timer: unknown;
  let stopped = false;

  const attempt = (): void => {
    timer = undefined;
    handlers.onStatus('connecting');
    const current = open(url);
    socket = current;
    current.onopen = () => {
      retryMs = firstRetryMs;
      handlers.onStatus('open');
    };
    current.onmessage = (event) => {
      const message = parse(event.data);
      if (message) handlers.onMessage(message);
    };
    const lost = (): void => {
      if (socket !== current) return; // an old socket reporting late
      socket = undefined;
      handlers.onStatus('closed');
      if (stopped) return;
      timer = schedule(attempt, retryMs);
      retryMs = Math.min(retryMs * 2, maxRetryMs);
    };
    current.onclose = lost;
    current.onerror = lost;
  };

  attempt();
  return {
    close() {
      stopped = true;
      if (timer !== undefined) cancel(timer);
      const current = socket;
      socket = undefined;
      current?.close();
    },
  };
}
