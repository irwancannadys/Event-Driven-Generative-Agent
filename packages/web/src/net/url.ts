import { WS_PATH } from '@cafe/core';

/** The page's own address with the socket path: `ws://` on http, `wss://` on https (decision 028). */
export function socketUrl(location: { protocol: string; host: string }): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${WS_PATH}`;
}

/** Where the HTTP API lives from the page's point of view: Vite forwards `/api/...` to the server. */
export const API_BASE = '/api';
