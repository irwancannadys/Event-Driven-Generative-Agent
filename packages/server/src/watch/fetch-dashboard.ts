import type { StockLevel, TimeView } from '@cafe/core';
import type { AgentOverviewRow, OrderListRow, ReportRow } from '../db/queries';
import type { DashboardView } from './format-dashboard';

/** How many of the finished orders the board shows. */
const DONE_SHOWN = 3;
/** The board only counts and lists open orders, so this is plenty. */
const OPEN_LIMIT = 200;

type Fetch = typeof fetch;

async function getJson<T>(fetchFn: Fetch, url: string): Promise<T> {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

/** Reads what the board needs from the API of a running server. */
export async function fetchDashboard(
  apiUrl: string,
  fetchFn: Fetch = fetch,
): Promise<DashboardView> {
  const get = <T>(path: string) => getJson<T>(fetchFn, `${apiUrl}${path}`);
  const orders = (status: OrderListRow['status'], limit: number) =>
    get<OrderListRow[]>(`/orders?status=${status}&limit=${limit}`);

  const [time, agents, stock, placed, held, cooking, done, reports] = await Promise.all([
    get<TimeView>('/time'),
    get<AgentOverviewRow[]>('/agents'),
    get<StockLevel[]>('/stock'),
    orders('placed', OPEN_LIMIT),
    orders('held', OPEN_LIMIT),
    orders('cooking', OPEN_LIMIT),
    orders('done', DONE_SHOWN),
    get<ReportRow[]>('/reports?status=submitted'),
  ]);
  return { apiUrl, time, agents, stock, orders: { placed, held, cooking, done }, reports };
}
