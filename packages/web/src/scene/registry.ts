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
