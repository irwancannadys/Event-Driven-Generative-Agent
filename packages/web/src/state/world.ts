import { RECENT_DONE_WINDOW_SEC } from '@cafe/core';
import type {
  AgentId,
  AgentState as AgentStatus,
  OrderStatus,
  ServerMessage,
  Snapshot,
  StationId,
  StockLevel,
  StoredEvent,
  TimeView,
} from '@cafe/core';

// What the page knows about the world (decisions 026 and 027). It is built from the snapshot the server
// sends on connect and kept up to date by applying every event after that, with the same rules as the
// server's projections. Pure functions and no DOM, so all of it is tested without a browser; a test also
// checks that this state equals the server's own snapshot at many moments of a whole day.

export interface AgentState {
  id: AgentId;
  state: AgentStatus;
  /** Where the agent is, or where a walking agent is heading. */
  station: StationId;
  /** Where a walking agent set off from, otherwise `null`. */
  from: StationId | null;
  /** What a working agent is doing (a task label), otherwise `null`. */
  label: string | null;
  taskId: number | null;
  /** Virtual seconds at which the running task started and is due to end. */
  startedAt: number | null;
  endsAt: number | null;
}

/** A report that is not decided yet: on its way to the boss desk (`drafted`) or on it (`submitted`). */
export interface ReportCard {
  id: number;
  type: 'restock' | 'complaint';
  status: 'drafted' | 'submitted';
  title: string;
  body: string;
  createdAt: number;
  submittedAt: number | null;
}

/**
 * A customer, one for each order (decision 029). Walk-in customers are anonymous: all that is known of
 * one is its order, so everything the picture shows of a customer comes from what happened to that order.
 */
export interface CustomerState {
  orderId: number;
  source: 'walk_in' | 'regular';
  status: OrderStatus;
  /** When the order came in, and when it was done (`null` while it is not). */
  createdAt: number;
  doneAt: number | null;
  /** `open` from a complaint about the order until the cashier has answered it. */
  complaint: 'none' | 'open';
}

/** The last clock the server sent, and the real time (ms) at which it arrived. */
export interface ClockState {
  time: TimeView;
  atMs: number;
}

export interface WorldState {
  clock: ClockState;
  /** Id of the newest event that is already in this state. */
  lastEventId: number;
  agents: Record<AgentId, AgentState>;
  stock: Record<string, StockLevel>;
  orders: Record<OrderStatus, number>;
  reports: ReportCard[];
  /** The customers, by order id: the orders that are not done and the ones done a short while ago. */
  customers: Record<number, CustomerState>;
  /** The complaints that are not answered yet, as complaint id to order id. */
  openComplaints: Record<number, number>;
  /** The newest events, oldest first (the event log panel). */
  log: StoredEvent[];
}

/** How many events the page keeps for its log. */
export const LOG_LIMIT = 500;

export function applySnapshot(snapshot: Snapshot, atMs: number): WorldState {
  const agents = {} as Record<AgentId, AgentState>;
  for (const agent of snapshot.agents) {
    agents[agent.id] = {
      id: agent.id,
      state: agent.state,
      station: agent.station,
      from: agent.from_station,
      label: agent.task?.label ?? null,
      taskId: agent.task?.id ?? null,
      startedAt: agent.task?.started_at_sim ?? null,
      endsAt: agent.task?.ends_at_sim ?? null,
    };
  }
  return {
    clock: { time: snapshot.time, atMs },
    lastEventId: snapshot.last_event_id,
    agents,
    stock: Object.fromEntries(snapshot.stock.map((row) => [row.ingredient_id, row])),
    orders: { ...snapshot.orders },
    reports: snapshot.reports
      .filter((report) => report.status === 'drafted' || report.status === 'submitted')
      .map((report) => ({
        id: report.id,
        type: report.type,
        status: report.status as 'drafted' | 'submitted',
        title: report.title,
        body: report.body,
        createdAt: report.created_at_sim,
        submittedAt: report.submitted_at_sim,
      })),
    customers: Object.fromEntries(
      snapshot.recent_orders.map((order) => [
        order.id,
        {
          orderId: order.id,
          source: order.source,
          status: order.status,
          createdAt: order.created_at_sim,
          doneAt: order.done_at_sim,
          complaint: snapshot.open_complaints.some((c) => c.order_id === order.id)
            ? ('open' as const)
            : ('none' as const),
        },
      ]),
    ),
    openComplaints: Object.fromEntries(
      snapshot.open_complaints.map((complaint) => [complaint.complaint_id, complaint.order_id]),
    ),
    log: snapshot.events.slice(-LOG_LIMIT),
  };
}

function moveOrder(state: WorldState, from: OrderStatus, to: OrderStatus): WorldState {
  return {
    ...state,
    orders: { ...state.orders, [from]: state.orders[from] - 1, [to]: state.orders[to] + 1 },
  };
}

function changeCustomer(
  state: WorldState,
  orderId: number,
  change: (customer: CustomerState) => CustomerState,
): WorldState {
  const customer = state.customers[orderId];
  if (!customer) return state;
  return { ...state, customers: { ...state.customers, [orderId]: change(customer) } };
}

/** Customers that are done for long are no use any more: dropped when time has moved well past them. */
function forgetOldCustomers(state: WorldState, now: number): WorldState {
  const keep = Object.entries(state.customers).filter(
    ([, customer]) =>
      customer.doneAt === null || now - customer.doneAt <= 2 * RECENT_DONE_WINDOW_SEC,
  );
  if (keep.length === Object.keys(state.customers).length) return state;
  return { ...state, customers: Object.fromEntries(keep) };
}

function changeStock(
  state: WorldState,
  ingredientId: string,
  change: (row: StockLevel) => StockLevel,
): WorldState {
  const row = state.stock[ingredientId];
  if (!row) return state;
  return { ...state, stock: { ...state.stock, [ingredientId]: change(row) } };
}

function changeReport(
  state: WorldState,
  reportId: number,
  change: (card: ReportCard) => ReportCard | null,
): WorldState {
  const reports: ReportCard[] = [];
  for (const card of state.reports) {
    const changed = card.id === reportId ? change(card) : card;
    if (changed) reports.push(changed);
  }
  return { ...state, reports };
}

function react(state: WorldState, event: StoredEvent): WorldState {
  switch (event.type) {
    case 'order_created': {
      const { order_id, source } = event.payload;
      return {
        ...state,
        orders: { ...state.orders, placed: state.orders.placed + 1 },
        customers: {
          ...state.customers,
          [order_id]: {
            orderId: order_id,
            source,
            status: 'placed',
            createdAt: event.sim_time,
            doneAt: null,
            complaint: 'none',
          },
        },
      };
    }
    case 'order_held':
      return changeCustomer(
        moveOrder(state, 'placed', 'held'),
        event.payload.order_id,
        (customer) => ({
          ...customer,
          status: 'held',
        }),
      );
    case 'cooking_started':
      return changeCustomer(
        moveOrder(state, 'placed', 'cooking'),
        event.payload.order_id,
        (customer) => ({
          ...customer,
          status: 'cooking',
        }),
      );
    case 'cooking_done':
      return changeCustomer(
        moveOrder(state, 'cooking', 'done'),
        event.payload.order_id,
        (customer) => ({
          ...customer,
          status: 'done',
          doneAt: event.sim_time,
        }),
      );
    case 'order_resumed':
      return changeCustomer(
        moveOrder(state, 'held', 'placed'),
        event.payload.order_id,
        (customer) => ({
          ...customer,
          status: 'placed',
        }),
      );

    case 'complaint_received':
      return changeCustomer(
        {
          ...state,
          openComplaints: {
            ...state.openComplaints,
            [event.payload.complaint_id]: event.payload.order_id,
          },
        },
        event.payload.order_id,
        (customer) => ({ ...customer, complaint: 'open' }),
      );
    case 'complaint_replied': {
      const orderId = state.openComplaints[event.payload.complaint_id];
      if (orderId === undefined) return state;
      const openComplaints = { ...state.openComplaints };
      delete openComplaints[event.payload.complaint_id];
      return changeCustomer({ ...state, openComplaints }, orderId, (customer) => ({
        ...customer,
        complaint: 'none',
      }));
    }

    case 'stock_decreased':
      return changeStock(state, event.payload.ingredient_id, (row) => ({
        ...row,
        qty: event.payload.new_qty,
      }));
    case 'stock_low':
      return changeStock(state, event.payload.ingredient_id, (row) => ({ ...row, low: true }));
    case 'stock_out':
      return changeStock(state, event.payload.ingredient_id, (row) => ({ ...row, out: true }));
    case 'restock_arrived':
      // A delivery adds to the stock, and a flag goes off again once the stock is back above its limit.
      return event.payload.items.reduce(
        (next, item) =>
          changeStock(next, item.ingredient_id, (row) => {
            const qty = row.qty + item.qty;
            return {
              ...row,
              qty,
              low: qty > row.min_qty ? false : row.low,
              out: qty > 0 ? false : row.out,
            };
          }),
        state,
      );

    case 'agent_state_changed': {
      const { agent_id, state: next, station, label, task_id, eta_sim_time } = event.payload;
      const agent = state.agents[agent_id];
      if (!agent) return state;
      const running = task_id !== undefined;
      return {
        ...state,
        agents: {
          ...state.agents,
          [agent_id]: {
            id: agent_id,
            state: next,
            station,
            // A walking state records where the agent is heading, so it set off from where it was.
            from: next === 'walking' ? agent.station : null,
            label: running && next !== 'walking' ? (label ?? null) : null,
            taskId: running ? task_id : null,
            startedAt: running ? event.sim_time : null,
            endsAt: running ? (eta_sim_time ?? null) : null,
          },
        },
      };
    }

    case 'restock_proposed':
      return addReport(state, event.payload.report, 'restock', event.sim_time);
    case 'complaint_triaged':
      return event.payload.report
        ? addReport(state, event.payload.report, 'complaint', event.sim_time)
        : state;
    case 'report_submitted':
      return changeReport(state, event.payload.report_id, (card) => ({
        ...card,
        status: 'submitted',
        submittedAt: event.sim_time,
      }));
    case 'report_decided':
      return changeReport(state, event.payload.report_id, () => null);

    default:
      return state;
  }
}

function addReport(
  state: WorldState,
  report: { report_id: number; title: string; body: string },
  type: ReportCard['type'],
  createdAt: number,
): WorldState {
  const card: ReportCard = {
    id: report.report_id,
    type,
    status: 'drafted',
    title: report.title,
    body: report.body,
    createdAt,
    submittedAt: null,
  };
  return { ...state, reports: [...state.reports, card] };
}

/**
 * Applies one event. An event that is already in the state (its id is not above `lastEventId`) is
 * skipped, so the events that follow a snapshot can overlap it without harm (decision 026).
 */
export function applyEvent(state: WorldState, event: StoredEvent): WorldState {
  if (event.id <= state.lastEventId) return state;
  const next = forgetOldCustomers(react(state, event), event.sim_time);
  return { ...next, lastEventId: event.id, log: [...next.log, event].slice(-LOG_LIMIT) };
}

export function applyClock(state: WorldState, time: TimeView, atMs: number): WorldState {
  return { ...state, clock: { time, atMs } };
}

/** Folds one message of the server into the state. A snapshot replaces everything. */
export function applyMessage(
  state: WorldState | undefined,
  message: ServerMessage,
  atMs: number,
): WorldState | undefined {
  switch (message.kind) {
    case 'snapshot':
      return applySnapshot(message.snapshot, atMs);
    case 'events':
      return state && message.events.reduce(applyEvent, state);
    case 'clock':
      return state && applyClock(state, message.time, atMs);
  }
}

/**
 * The virtual time right now: the last clock from the server plus the real time that passed since,
 * at the speed of the clock. It stands still while paused (decision 027).
 */
export function virtualNow(clock: ClockState, nowMs: number): number {
  if (clock.time.paused) return clock.time.sim_time;
  return clock.time.sim_time + ((nowMs - clock.atMs) / 1000) * clock.time.speed;
}

/**
 * Stops the clock where it is, for when the connection to the server is lost: nobody knows what time it
 * is any more, so the picture must not run on. The snapshot after the reconnect sets everything right.
 */
export function freezeClock(state: WorldState, nowMs: number): WorldState {
  const { time } = state.clock;
  if (time.paused) return state;
  return {
    ...state,
    clock: {
      time: { ...time, sim_time: virtualNow(state.clock, nowMs), paused: true },
      atMs: nowMs,
    },
  };
}
