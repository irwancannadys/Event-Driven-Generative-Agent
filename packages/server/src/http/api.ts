import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OrderItemSchema, SECONDS_PER_DAY } from '@cafe/core';
import { z } from 'zod';
import {
  readAgentOverview,
  readMenu,
  readOrders,
  readRecipe,
  readReport,
  readReports,
  readStock,
} from '../db/queries';
import { MAX_SPEED, MIN_SPEED } from '../sim/pacer';
import type { TimeControl } from '../sim/time-control';
import { DomainError, type Context } from '../usecases/context';
import { createOrder } from '../usecases/orders';
import { decideReport } from '../usecases/reports';

// The cashier mock plus time controls: a tiny HTTP API on top of the use cases (node:http, no framework).
//   GET  /menu                   menu items with their recipe
//   GET  /stock                  stock level per ingredient
//   POST /orders                 { items: [{ menu_item_id, qty }] } -> 201 { order_id }
//   GET  /orders                 the newest orders (?status=, ?limit=)
//   GET  /agents                 where every character is and what they are doing
//   GET  /reports                reports (?status=submitted for the ones on the boss desk)
//   POST /reports/:id/decision   { decision: "approved" | "rejected" } -> the decided report
//   GET  /time                   the virtual clock (only when time controls are given)
//   POST /time                   { speed?, paused?, advance_seconds? } -> the new clock

const MAX_BODY_BYTES = 64 * 1024;
/** A single jump may not be longer than a week of virtual time. */
const MAX_ADVANCE_SEC = 7 * SECONDS_PER_DAY;

const OrderBodySchema = z.object({ items: z.array(OrderItemSchema).min(1) });

const DecisionBodySchema = z.object({ decision: z.enum(['approved', 'rejected']) });

const ReportStatusSchema = z.enum(['drafted', 'submitted', 'approved', 'rejected']);
const OrderStatusSchema = z.enum(['placed', 'held', 'cooking', 'done']);
const DEFAULT_ORDER_LIMIT = 100;
const MAX_ORDER_LIMIT = 1000;

const TimeBodySchema = z
  .object({
    speed: z.number().int().min(MIN_SPEED).max(MAX_SPEED).optional(),
    paused: z.boolean().optional(),
    advance_seconds: z.number().int().positive().max(MAX_ADVANCE_SEC).optional(),
  })
  .refine(
    (body) =>
      body.speed !== undefined || body.paused !== undefined || body.advance_seconds !== undefined,
    { message: 'send at least one of speed, paused, advance_seconds' },
  );

interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** What a handler gets: the request, the `:name` parts of the path and the query string. */
interface Call {
  req: http.IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
}

type Handler = (call: Call) => Promise<Reply> | Reply;
type Routes = Record<string, Record<string, Handler>>;

export interface ApiOptions {
  /** Adds `GET /time` and `POST /time`. */
  time?: TimeControl;
}

function buildRoutes(ctx: Context, options: ApiOptions): Routes {
  const routes: Routes = {
    '/menu': { GET: () => ({ status: 200, body: menuView(ctx) }) },
    '/stock': { GET: () => ({ status: 200, body: stockView(ctx) }) },
    '/orders': {
      GET: ({ query }) => getOrders(ctx, query),
      POST: ({ req }) => postOrder(req, ctx),
    },
    '/agents': { GET: () => ({ status: 200, body: readAgentOverview(ctx.db) }) },
    '/reports': { GET: ({ query }) => getReports(ctx, query) },
    '/reports/:id/decision': {
      POST: ({ req, params }) => postDecision(req, ctx, Number(params.id)),
    },
  };
  const time = options.time;
  if (time) {
    routes['/time'] = {
      GET: () => ({ status: 200, body: time.state() }),
      POST: ({ req }) => postTime(req, time),
    };
  }
  return routes;
}

function menuView(ctx: Context) {
  const recipe = readRecipe(ctx.db);
  return readMenu(ctx.db).map((item) => ({
    ...item,
    recipe: recipe
      .filter((line) => line.menu_item_id === item.id)
      .map(({ ingredient_id, qty_per_portion }) => ({ ingredient_id, qty_per_portion })),
  }));
}

export function stockView(ctx: Context) {
  return readStock(ctx.db).map(({ low_flagged, out_flagged, ...row }) => ({
    ...row,
    low: low_flagged,
    out: out_flagged,
  }));
}

/** Reads and validates a JSON body. On failure `reply` is the answer to send back. */
async function readJson<T>(
  req: http.IncomingMessage,
  schema: z.ZodType<T>,
): Promise<{ ok: true; value: T } | { ok: false; reply: Reply }> {
  const body = await readBody(req);
  if ('tooLarge' in body) {
    return {
      ok: false,
      reply: { status: 413, body: { error: 'body_too_large', max_bytes: MAX_BODY_BYTES } },
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    return { ok: false, reply: { status: 400, body: { error: 'invalid_json' } } };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`,
    );
    return { ok: false, reply: { status: 400, body: { error: 'invalid_body', issues } } };
  }
  return { ok: true, value: parsed.data };
}

async function postOrder(req: http.IncomingMessage, ctx: Context): Promise<Reply> {
  const body = await readJson(req, OrderBodySchema);
  if (!body.ok) return body.reply;
  try {
    return { status: 201, body: createOrder(ctx, { items: body.value.items }) };
  } catch (error) {
    if (error instanceof DomainError) {
      return { status: 422, body: { error: error.code, message: error.message } };
    }
    throw error;
  }
}

function badQuery(name: string, allowed: string): Reply {
  return { status: 400, body: { error: 'invalid_query', issues: [`${name}: ${allowed}`] } };
}

function getOrders(ctx: Context, query: URLSearchParams): Reply {
  const rawStatus = query.get('status');
  const status = rawStatus === null ? undefined : OrderStatusSchema.safeParse(rawStatus);
  if (status && !status.success) return badQuery('status', 'placed, held, cooking or done');

  const rawLimit = query.get('limit');
  const limit = rawLimit === null ? DEFAULT_ORDER_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ORDER_LIMIT) {
    return badQuery('limit', `a whole number from 1 to ${MAX_ORDER_LIMIT}`);
  }
  return { status: 200, body: readOrders(ctx.db, { status: status?.data, limit }) };
}

function getReports(ctx: Context, query: URLSearchParams): Reply {
  const rawStatus = query.get('status');
  const status = rawStatus === null ? undefined : ReportStatusSchema.safeParse(rawStatus);
  if (status && !status.success) {
    return badQuery('status', 'drafted, submitted, approved or rejected');
  }
  return { status: 200, body: readReports(ctx.db, status?.data) };
}

const DOMAIN_ERROR_STATUS: Record<string, number> = {
  report_not_found: 404,
  report_not_submitted: 409,
};

async function postDecision(
  req: http.IncomingMessage,
  ctx: Context,
  report_id: number,
): Promise<Reply> {
  const body = await readJson(req, DecisionBodySchema);
  if (!body.ok) return body.reply;
  try {
    decideReport(ctx, { report_id, decision: body.value.decision });
  } catch (error) {
    if (error instanceof DomainError) {
      return {
        status: DOMAIN_ERROR_STATUS[error.code] ?? 422,
        body: { error: error.code, message: error.message },
      };
    }
    throw error;
  }
  return { status: 200, body: readReport(ctx.db, report_id) };
}

/** Applies speed, then pause, then the jump, and answers with the clock as it is afterwards. */
async function postTime(req: http.IncomingMessage, time: TimeControl): Promise<Reply> {
  const body = await readJson(req, TimeBodySchema);
  if (!body.ok) return body.reply;
  const { speed, paused, advance_seconds } = body.value;
  if (speed !== undefined) time.setSpeed(speed);
  if (paused !== undefined) {
    if (paused) time.pause();
    else time.resume();
  }
  if (advance_seconds !== undefined) time.skip(advance_seconds);
  return { status: 200, body: time.state() };
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

/** Matches a path like `/reports/3/decision` against a pattern like `/reports/:id/decision`. */
function matchPath(pattern: string, path: string): Record<string, string> | undefined {
  const want = pattern.split('/');
  const got = path.split('/');
  if (want.length !== got.length) return undefined;
  const params: Record<string, string> = {};
  for (const [index, part] of want.entries()) {
    const actual = got[index] as string;
    if (part.startsWith(':')) {
      if (!/^\d+$/.test(actual)) return undefined;
      params[part.slice(1)] = actual;
    } else if (part !== actual) {
      return undefined;
    }
  }
  return params;
}

async function handle(req: http.IncomingMessage, routes: Routes): Promise<Reply> {
  const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost');
  for (const [pattern, route] of Object.entries(routes)) {
    const params = matchPath(pattern, pathname);
    if (!params) continue;
    const handler = route[req.method ?? ''];
    if (!handler) {
      return {
        status: 405,
        headers: { allow: Object.keys(route).join(', ') },
        body: { error: 'method_not_allowed' },
      };
    }
    return handler({ req, params, query: searchParams });
  }
  return { status: 404, body: { error: 'not_found' } };
}

function send(res: http.ServerResponse, reply: Reply): void {
  res.writeHead(reply.status, {
    'content-type': 'application/json; charset=utf-8',
    ...reply.headers,
  });
  res.end(JSON.stringify(reply.body));
}

export function createApiServer(ctx: Context, options: ApiOptions = {}): http.Server {
  const routes = buildRoutes(ctx, options);
  return http.createServer((req, res) => {
    handle(req, routes)
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
  options: ApiOptions & { port?: number; host?: string } = {},
): Promise<RunningApi> {
  const server = createApiServer(ctx, { time: options.time });
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
