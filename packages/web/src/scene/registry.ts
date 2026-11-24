import type { AgentId, StationId } from '@cafe/core';

// Where things are in the room. This is the only place with coordinates (decision 002): the domain only
// knows station ids. Units are those of Three.js, x to the right and z towards the camera. The room is
// a hall with two rooms in it, separated by walls with doors: the kitchen at the back on the right
// (with a hatch where the food is handed out) and the boss's office at the front on the left. A
// character stands facing a direction: `facing` is the `rotation.y` that makes it look there (0 looks
// at the camera, pi at the back wall, +pi/2 to the right, -pi/2 to the left).

export interface Spot {
  x: number;
  z: number;
  facing: number;
}

export interface Point {
  x: number;
  z: number;
}

export const ROOM = { xMin: -11, xMax: 11, zMin: -5.5, zMax: 7.5 } as const;

/** Seven tables for the customers. Three of them are the tables 1 to 3 of the domain (for Rina). */
export const TABLES: readonly Point[] = [
  { x: -7.2, z: 1.6 },
  { x: -4, z: 1.6 },
  { x: 3.6, z: 1.6 },
  { x: 6.8, z: 1.6 },
  { x: -7.2, z: 4.8 },
  { x: -4, z: 4.8 },
  { x: 3.6, z: 4.8 },
];

export const FURNITURE = {
  cashierDesk: { x: -2.8, z: -3.7 },
  kitchenIsland: { x: 7.2, z: -3.2 },
  shelf: { x: 1.7, z: -5 },
  bossDesk: { x: -8.9, z: -3 },
  tables: TABLES,
} as const;

// --- The walls and the doors ---

/** A wall seen from above, from one end to the other. */
export interface Wall {
  name: string;
  from: Point;
  to: Point;
}

export const OFFICE = { xMin: -11, xMax: -6.4, zMin: -5.5, zMax: -0.5, doorZ: -2.8 } as const;
export const KITCHEN = {
  xMin: 3,
  xMax: 11,
  zMin: -5.5,
  zMax: -0.5,
  doorX: 5,
  hatchZ: -2.2,
} as const;
export const DOOR_WIDTH = 1.2;
/** The glass front of the cafe, with the entrance in the middle of it. */
export const ENTRANCE = { x: 0, z: ROOM.zMax } as const;

/** The partition walls. Each has a gap where its door is; the hatch of the kitchen is no way through. */
export const WALLS: readonly Wall[] = [
  {
    name: 'office-front',
    from: { x: OFFICE.xMin, z: OFFICE.zMax },
    to: { x: OFFICE.xMax, z: OFFICE.zMax },
  },
  {
    name: 'office-side-1',
    from: { x: OFFICE.xMax, z: OFFICE.zMin },
    to: { x: OFFICE.xMax, z: OFFICE.doorZ - DOOR_WIDTH / 2 },
  },
  {
    name: 'office-side-2',
    from: { x: OFFICE.xMax, z: OFFICE.doorZ + DOOR_WIDTH / 2 },
    to: { x: OFFICE.xMax, z: OFFICE.zMax },
  },
  {
    name: 'kitchen-side',
    from: { x: KITCHEN.xMin, z: KITCHEN.zMin },
    to: { x: KITCHEN.xMin, z: KITCHEN.zMax },
  },
  {
    name: 'kitchen-front-1',
    from: { x: KITCHEN.xMin, z: KITCHEN.zMax },
    to: { x: KITCHEN.doorX - DOOR_WIDTH / 2, z: KITCHEN.zMax },
  },
  {
    name: 'kitchen-front-2',
    from: { x: KITCHEN.doorX + DOOR_WIDTH / 2, z: KITCHEN.zMax },
    to: { x: KITCHEN.xMax, z: KITCHEN.zMax },
  },
];

/** Counters that cannot be walked through. */
export const COUNTERS: readonly Wall[] = [
  {
    name: 'cashier-counter',
    from: { x: -5.2, z: FURNITURE.cashierDesk.z },
    to: { x: -0.4, z: FURNITURE.cashierDesk.z },
  },
  {
    name: 'kitchen-island',
    from: { x: 5.4, z: FURNITURE.kitchenIsland.z },
    to: { x: 9.2, z: FURNITURE.kitchenIsland.z },
  },
  {
    name: 'shelf',
    from: { x: 0.6, z: FURNITURE.shelf.z + 0.5 },
    to: { x: 2.8, z: FURNITURE.shelf.z + 0.5 },
  },
];

// --- Where the characters stand ---

export const STATION_SPOTS: Record<StationId, Spot> = {
  cashier: { x: -2.8, z: -4.6, facing: 0 }, // behind the counter, facing the customers and the camera
  kitchen: { x: 7.2, z: -4.2, facing: 0 }, // behind the island, facing the camera
  stock_shelf: { x: 1.7, z: -3.8, facing: Math.PI }, // in front of the shelf on the back wall
  boss_desk: { x: -7.5, z: -3, facing: -Math.PI / 2 }, // inside the office, facing the desk
  table_1: { x: (TABLES[1] as Point).x, z: (TABLES[1] as Point).z + 1.2, facing: Math.PI },
  table_2: { x: (TABLES[2] as Point).x, z: (TABLES[2] as Point).z + 1.2, facing: Math.PI },
  table_3: { x: (TABLES[3] as Point).x, z: (TABLES[3] as Point).z + 1.2, facing: Math.PI },
};

/** Four characters can be at the boss desk, so each has its own place along it. */
const BOSS_DESK_Z: Record<AgentId, number> = {
  cashier: -2,
  cook: -2.7,
  stock_admin: -3.4,
  waiter: -4.1,
};

/** Where `agent` stands at `station`. */
export function standingPoint(station: StationId, agent: AgentId): Spot {
  const spot = STATION_SPOTS[station];
  return station === 'boss_desk' ? { ...spot, z: BOSS_DESK_Z[agent] } : spot;
}

/** The boss sits behind his desk, facing the door (and you). */
export const BOSS_SPOT: Spot = { x: -10.2, z: -3, facing: Math.PI / 2 };

// --- Where customers go (decision 029) ---

/** The front door, in the glass front: customers come in and go out here. */
export const DOOR: Spot = { x: 0, z: 6.9, facing: Math.PI };
/** Where a customer stands to order, in front of the cashier. */
export const ORDER_SPOT: Spot = { x: -2.8, z: -2.8, facing: Math.PI };
/** Where food is picked up: at the hatch of the kitchen, facing it. */
export const PICKUP_SPOT: Spot = { x: 2.2, z: KITCHEN.hatchZ, facing: Math.PI / 2 };

/** Three places along the counter to order, so that customers who arrive together do not stand inside each other. */
export function orderSpot(orderId: number): Spot {
  return { ...ORDER_SPOT, x: ORDER_SPOT.x + ((orderId % 3) - 1) * 0.9 };
}

/** Three places along the hatch to take the food. */
export function pickupSpot(orderId: number): Spot {
  return { ...PICKUP_SPOT, z: PICKUP_SPOT.z + ((orderId % 3) - 1) * 0.5 };
}

export interface WaitingSpot extends Spot {
  /** A seat at a table, as opposed to a place to stand. */
  seat: boolean;
}

/** Places to wait for the food: two seats at each of the seven tables, and six places to stand. */
export const WAITING_SPOTS: WaitingSpot[] = [
  ...TABLES.flatMap((table): WaitingSpot[] => [
    { x: table.x - 1, z: table.z, facing: Math.PI / 2, seat: true },
    { x: table.x + 1, z: table.z, facing: -Math.PI / 2, seat: true },
  ]),
  { x: -5.2, z: -1.6, facing: Math.PI, seat: false },
  { x: -4, z: -2.6, facing: Math.PI, seat: false },
  { x: -1, z: -1.4, facing: Math.PI, seat: false },
  { x: 0.4, z: -2.2, facing: Math.PI, seat: false },
  { x: -2.6, z: -0.6, facing: Math.PI, seat: false },
  { x: -0.6, z: 0, facing: Math.PI, seat: false },
];

/** The place where the customer of an order waits: the same one every time, whoever else is waiting. */
export function waitingSpot(orderId: number): WaitingSpot {
  const base = WAITING_SPOTS[orderId % WAITING_SPOTS.length] as WaitingSpot;
  // A customer beyond the number of places shares one with an earlier customer, a little to the side (and
  // a customer sixty orders later a little to the other side again)
  const aside = (round: number): number => (round === 0 ? 0 : round === 1 ? 0.35 : -0.35);
  const rounds = Math.floor(orderId / WAITING_SPOTS.length);
  // (a seat only moves along the table: further out it would be inside it)
  const sideways = base.seat ? 0 : aside(Math.floor(rounds / 3) % 3);
  return { ...base, z: base.z + aside(rounds % 3), x: base.x + sideways };
}
