import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OrderItemSchema } from '@cafe/core';
import { z } from 'zod';
import { readMenu, readRecipe, readStock } from '../db/queries';
import { DomainError, type Context } from '../usecases/context';
import { createOrder } from '../usecases/orders';

// The cashier mock: a tiny HTTP API on top of the use cases, built on node:http (no framework).
//   GET  /menu    menu items with their recipe
//   GET  /stock   stock level per ingredient
//   POST /orders  { items: [{ menu_item_id, qty }] } -> 201 { order_id }

const MAX_BODY_BYTES = 64 * 1024;

const OrderBodySchema = z.object({ items: z.array(OrderItemSchema).min(1) });

interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

type Handler = (req: http.IncomingMessage, ctx: Context) => Promise<Reply> | Reply;

const ROUTES: Record<string, Record<string, Handler>> = {
  '/menu': { GET: (_req, ctx) => ({ status: 200, body: menuView(ctx) }) },
  '/stock': { GET: (_req, ctx) => ({ status: 200, body: stockView(ctx) }) },
  '/orders': { POST: postOrder },
};

function menuView(ctx: Context) {
  const recipe = readRecipe(ctx.db);
  return readMenu(ctx.db).map((item) => ({
    ...item,
    recipe: recipe
      .filter((line) => line.menu_item_id === item.id)
      .map(({ ingredient_id, qty_per_portion }) => ({ ingredient_id, qty_per_portion })),
  }));
}

function stockView(ctx: Context) {
  return readStock(ctx.db).map(({ low_flagged, out_flagged, ...row }) => ({
    ...row,
    low: low_flagged,
    out: out_flagged,
  }));
}

async function postOrder(req: http.IncomingMessage, ctx: Context): Promise<Reply> {
  const body = await readBody(req);
  if ('tooLarge' in body) {
    return { status: 413, body: { error: 'body_too_large', max_bytes: MAX_BODY_BYTES } };
  }
  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }
  const parsed = OrderBodySchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`,
    );
    return { status: 400, body: { error: 'invalid_body', issues } };
  }
  try {
    return { status: 201, body: createOrder(ctx, { items: parsed.data.items }) };
  } catch (error) {
    if (error instanceof DomainError) {
      return { status: 422, body: { error: error.code, message: error.message } };
    }
    throw error;
  }
}

function readBody(req: http.IncomingMessage): Promise<{ text: string } | { tooLarge: true }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true; // keep draining the request, but stop storing it
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    req.on('end', () =>
      resolve(tooLarge ? { tooLarge: true } : { text: Buffer.concat(chunks).toString('utf8') }),
    );
    req.on('error', reject);
  });
}

async function handle(req: http.IncomingMessage, ctx: Context): Promise<Reply> {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const route = ROUTES[pathname];
  if (!route) return { status: 404, body: { error: 'not_found' } };
  const handler = route[req.method ?? ''];
  if (!handler) {
    return {
      status: 405,
      headers: { allow: Object.keys(route).join(', ') },
      body: { error: 'method_not_allowed' },
    };
  }
  return handler(req, ctx);
}

function send(res: http.ServerResponse, reply: Reply): void {
  res.writeHead(reply.status, {
    'content-type': 'application/json; charset=utf-8',
    ...reply.headers,
  });
  res.end(JSON.stringify(reply.body));
}

export function createApiServer(ctx: Context): http.Server {
  return http.createServer((req, res) => {
    handle(req, ctx)
      .then((reply) => send(res, reply))
      .catch((error: unknown) => {
        console.error('API error:', error);
        send(res, { status: 500, body: { error: 'internal_error' } });
      });
  });
}

export interface RunningApi {
  server: http.Server;
  url: string;
  close(): Promise<void>;
}

/** Starts the API on localhost. Port 0 picks a free port (used by tests and the demo). */
export async function startApiServer(
  ctx: Context,
  options: { port?: number; host?: string } = {},
): Promise<RunningApi> {
  const server = createApiServer(ctx);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://${address.address}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
