import type { AgentId, StationId } from '@cafe/core';

// Where the stations are in the room. This is the only place with coordinates (decision 002): the
// domain only knows station ids. Units are those of Three.js, x to the right and z towards the camera,
// from the layout in docs/reference/. The points are where a character stands, chosen so that the
// distances on screen stay close to the walk times of the domain (a test keeps them within 50%).

export interface Spot {
  x: number;
  z: number;
  /** `rotation.y` that makes the character face its work. */
  facing: number;
}

export const STATION_SPOTS: Record<StationId, Spot> = {
  cashier: { x: -5.4, z: -2.2, facing: -Math.PI / 2 }, // behind the desk, facing the queue on the left
  kitchen: { x: 5, z: -2.2, facing: Math.PI }, // in front of the stove
  stock_shelf: { x: 6, z: 3.4, facing: Math.PI / 2 }, // facing the shelf on the right
  boss_desk: { x: -4.6, z: 4.4, facing: Math.PI }, // where a report is handed in, facing the desk
  table_1: { x: -2.4, z: 0.9, facing: Math.PI },
  table_2: { x: 0, z: 0.9, facing: Math.PI },
  table_3: { x: 2.4, z: 0.9, facing: Math.PI },
};

/** Four characters can be at the boss desk, so each has its own place along the desk. */
const BOSS_DESK_X: Record<AgentId, number> = {
  cashier: -6,
  cook: -5,
  stock_admin: -4.2,
  waiter: -3.3,
};

/** Where `agent` stands at `station`. */
export function standingPoint(station: StationId, agent: AgentId): Spot {
  const spot = STATION_SPOTS[station];
  return station === 'boss_desk' ? { ...spot, x: BOSS_DESK_X[agent] } : spot;
}

/** The furniture, for the room and for the labels above it. */
export const FURNITURE = {
  cashierDesk: { x: -5, z: -3.6 },
  kitchen: { x: 5, z: -3.6 },
  shelf: { x: 6.9, z: 2.6 },
  bossDesk: { x: -5.5, z: 3 },
  tables: [
    { x: -2.4, z: -0.5 },
    { x: 0, z: -0.5 },
    { x: 2.4, z: -0.5 },
  ],
} as const;

/** The boss sits at his desk and does not move (he is you). */
export const BOSS_SPOT: Spot = { x: -5.5, z: 1.7, facing: 0 };

// --- Where customers go (decision 029) ---

/** The door on the left wall: customers come in and go out here. */
export const DOOR: Spot = { x: -8.8, z: 0.6, facing: Math.PI / 2 };
/** Where a customer stands to order, in front of the cashier, who looks at the queue on the left. */
export const ORDER_SPOT: Spot = { x: -6.8, z: -2.2, facing: Math.PI / 2 };
/** Where food is picked up: the near end of the kitchen counter, facing the cook. */
export const PICKUP_SPOT: Spot = { x: 3.4, z: -2.2, facing: Math.PI / 2 };

export interface WaitingSpot extends Spot {
  /** A seat at a table, as opposed to a place to stand. */
  seat: boolean;
}

/** Places to wait for the food: two seats at each of the three tables, and six places to stand. */
export const WAITING_SPOTS: WaitingSpot[] = [
  ...FURNITURE.tables.flatMap((table): WaitingSpot[] => [
    { x: table.x, z: table.z - 0.95, facing: 0, seat: true }, // behind the table, facing the front
    { x: table.x, z: table.z + 0.95, facing: Math.PI, seat: true }, // in front of it, facing the wall
  ]),
  { x: -3, z: 2.8, facing: Math.PI, seat: false },
  { x: -1.5, z: 3.2, facing: Math.PI, seat: false },
  { x: 0, z: 2.8, facing: Math.PI, seat: false },
  { x: 1.5, z: 3.2, facing: Math.PI, seat: false },
  { x: 3, z: 2.8, facing: Math.PI, seat: false },
  { x: 4.2, z: 2.2, facing: Math.PI, seat: false },
];

/** The place where the customer of an order waits: the same one every time, whoever else is waiting. */
export function waitingSpot(orderId: number): WaitingSpot {
  const base = WAITING_SPOTS[orderId % WAITING_SPOTS.length] as WaitingSpot;
  // Customers beyond the number of places share one, standing a little apart.
  const round = Math.floor(orderId / WAITING_SPOTS.length) % 3;
  return base.seat ? base : { ...base, x: base.x + (round - 1) * 0.35 };
}
