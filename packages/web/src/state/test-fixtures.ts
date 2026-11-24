import type { AgentView, Snapshot, StockLevel, StoredEvent, TimeView } from '@cafe/core';
import { applyEvent, applySnapshot, type WorldState } from './world';

// Small builders for the tests of the state and the panels. Not used by the page itself.

export const TIME: TimeView = {
  sim_time: 30_000,
  clock: '08:20',
  day: 0,
  speed: 60,
  paused: false,
};

export const agent = (id: AgentView['id'], station: AgentView['station']): AgentView => ({
  id,
  role: id,
  station,
  state: 'idle',
  task: null,
  queued: 0,
  from_station: null,
});

export const stockRow = (ingredient_id: string, qty: number, min_qty: number): StockLevel => ({
  ingredient_id,
  name: ingredient_id,
  unit: 'g',
  qty,
  min_qty,
  capacity_qty: 1000,
  low: qty <= min_qty,
  out: qty === 0,
});

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    time: TIME,
    last_event_id: 10,
    agents: [
      agent('cashier', 'cashier'),
      agent('cook', 'kitchen'),
      agent('stock_admin', 'stock_shelf'),
      agent('waiter', 'table_2'),
    ],
    stock: [stockRow('susu', 2500, 1000), stockRow('nasi', 100, 1000)],
    orders: { placed: 0, held: 0, cooking: 0, done: 0 },
    recent_orders: [],
    arrivals_in_flight: [],
    complaints: [],
    reports: [],
    events: [],
    ...overrides,
  };
}

let nextId = 11;
export function event(
  type: string,
  payload: Record<string, unknown>,
  sim_time = 30_100,
): StoredEvent {
  return { id: nextId++, type, sim_time, actor: 'system', origin: 'rule', payload } as StoredEvent;
}
export const start = (): WorldState => applySnapshot(snapshot(), 1000);
export const apply = (state: WorldState, ...events: StoredEvent[]) =>
  events.reduce(applyEvent, state);
