import type { StoredEvent } from './events';
import type { AgentId, StationId } from './ids';
import type { SimTime } from './time';

// What travels between the server and the web page (decision 026). Types only: the server builds these
// from its projections and the page reads them. No code here, so core stays pure.

/** Where the WebSocket listens. */
export const WS_PATH = '/ws';

/** The virtual clock as the boss sees it (`GET /time`, and the `clock` message). */
export interface TimeView {
  /** Virtual seconds since day 0 at 00:00. */
  sim_time: SimTime;
  /** Wall-clock label such as `08:30`. */
  clock: string;
  day: number;
  /** Virtual seconds per real second. */
  speed: number;
  paused: boolean;
}

export type AgentState = 'idle' | 'walking' | 'working' | 'thinking';
export type OrderStatus = 'placed' | 'held' | 'cooking' | 'done';
export type ReportStatus = 'drafted' | 'submitted' | 'approved' | 'rejected';

export interface AgentView {
  id: AgentId;
  role: string;
  /** Where the agent is, or where a walking agent is heading. */
  station: StationId;
  state: AgentState;
  /** The task that is running, if any. */
  task: {
    id: number;
    kind: 'goto' | 'work';
    label: string | null;
    /** Destination of a `goto`. */
    station: StationId | null;
    started_at_sim: SimTime | null;
    ends_at_sim: SimTime | null;
  } | null;
  /** How many tasks wait behind the running one. */
  queued: number;
  /** Where a walking agent set off from, `null` when it is not walking. */
  from_station: StationId | null;
}

export interface StockLevel {
  ingredient_id: string;
  name: string;
  unit: string;
  qty: number;
  min_qty: number;
  capacity_qty: number;
  low: boolean;
  out: boolean;
}

export interface ReportView {
  id: number;
  type: 'restock' | 'complaint';
  status: ReportStatus;
  title: string;
  body: string;
  subject: Record<string, unknown>;
  created_at_sim: SimTime;
  submitted_at_sim: SimTime | null;
  decided_at_sim: SimTime | null;
}

/** An order as far as the picture needs it: a customer is drawn for each one (decision 029). */
export interface OrderView {
  id: number;
  status: OrderStatus;
  source: 'walk_in' | 'regular';
  created_at_sim: SimTime;
  /** When it was cooked, `null` while it is not done. */
  done_at_sim: SimTime | null;
}

/** A complaint that has not been answered yet, and the order it is about. */
export interface ComplaintView {
  complaint_id: number;
  order_id: number;
}

/** The state of the world at one moment, sent once when a page connects. */
export interface Snapshot {
  time: TimeView;
  /** Id of the newest event in the log (0 for an empty log). The events that follow have higher ids. */
  last_event_id: number;
  agents: AgentView[];
  stock: StockLevel[];
  /** How many orders there are in each status. */
  orders: Record<OrderStatus, number>;
  /**
   * The orders that are not done, and the ones that were done in the last twenty virtual minutes
   * (a customer is still on the way out). Oldest first, at most 200 of the newest.
   */
  recent_orders: OrderView[];
  open_complaints: ComplaintView[];
  /** Reports that are not decided yet (`drafted` and `submitted`). */
  reports: ReportView[];
  /** The newest events, oldest first, so the log on the page is filled from the start. */
  events: StoredEvent[];
}

export type ServerMessage =
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'events'; events: StoredEvent[] }
  | { kind: 'clock'; time: TimeView };
