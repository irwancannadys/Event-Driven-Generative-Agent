import type { StoredEvent } from './events';
import type { AgentId, StationId } from './ids';
import type { ComplaintCause } from './rules';
import type { Compensation } from './schema-parts';
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

/** A customer whose order was done this many virtual seconds ago may still be walking out. */
export const RECENT_DONE_WINDOW_SEC = 1200;

/** An order as far as the picture needs it: a customer is drawn for each one (decision 029). */
export interface OrderView {
  id: number;
  status: OrderStatus;
  source: 'walk_in' | 'regular';
  /** The customer that came in at the door and placed it (decision 032), `null` for an order made by hand. */
  customer_id: number | null;
  created_at_sim: SimTime;
  /** When the cashier had written it down and the cook got it, `null` before that. */
  recorded_at_sim: SimTime | null;
  /** When it was cooked, `null` while it is not done. */
  done_at_sim: SimTime | null;
}

/** A customer that came in at the door and is on its way to the cashier to place its order. */
export interface ArrivalView {
  customer_id: number;
  arrived_at_sim: SimTime;
}

export type ComplaintStatus = 'received' | 'triaged' | 'replied';

/** A replied complaint stays in the snapshot this long (two virtual hours), for the complaints panel. */
export const RECENT_COMPLAINT_WINDOW_SEC = 7200;

/** A complaint and where it stands: noted by the cashier, waiting for the boss, or answered. */
export interface ComplaintView {
  complaint_id: number;
  order_id: number;
  cause: ComplaintCause;
  status: ComplaintStatus;
  received_at_sim: SimTime;
  /** `null` until it is answered. */
  replied_at_sim: SimTime | null;
  /**
   * What the customer is offered: the cashier's proposal once she has judged the complaint, the
   * compensation given once it is answered, `null` before that.
   */
  compensation: Compensation | null;
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
  /** The customers that are on their way to the cashier (`WALK_IN_SEC` after the door they order). */
  arrivals_in_flight: ArrivalView[];
  /**
   * The complaints that are not answered yet, and the ones answered in the last two virtual hours
   * (`RECENT_COMPLAINT_WINDOW_SEC`). Oldest first.
   */
  complaints: ComplaintView[];
  /** Reports that are not decided yet (`drafted` and `submitted`). */
  reports: ReportView[];
  /** The newest events, oldest first, so the log on the page is filled from the start. */
  events: StoredEvent[];
}

export type ServerMessage =
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'events'; events: StoredEvent[] }
  | { kind: 'clock'; time: TimeView };
