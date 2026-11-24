import { describe, expect, it } from 'vitest';
import { findPath, isBlocked, pathLength, pointAlong } from './navigation';
import {
  COUNTERS,
  DOOR,
  KITCHEN,
  OFFICE,
  ORDER_SPOT,
  PICKUP_SPOT,
  STATION_SPOTS,
  TABLES,
  WAITING_SPOTS,
  WALLS,
  standingPoint,
  type Point,
} from './registry';

const straight = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** Points along the path, a tenth of a unit apart. */
function sample(path: Point[]): Point[] {
  const total = pathLength(path);
  const points: Point[] = [];
  for (let step = 0; step <= Math.ceil(total * 10); step += 1)
    points.push(pointAlong(path, step / Math.max(1, Math.ceil(total * 10))));
  return points;
}

function crossesWall(a: Point, b: Point, wall: { from: Point; to: Point }): boolean {
  const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return (
    o(a, b, wall.from) * o(a, b, wall.to) < 0 &&
    o(wall.from, wall.to, a) * o(wall.from, wall.to, b) < 0
  );
}

describe('findPath', () => {
  it('goes straight when nothing is in the way, and starts and ends where it is asked to', () => {
    const a = { x: -2, z: -1 };
    const b = { x: 0.4, z: -2.2 };
    expect(findPath(a, b)).toEqual([a, b]);
  });

  it('is a single point for a walk that goes nowhere', () => {
    const a = STATION_SPOTS.cashier;
    expect(pathLength(findPath(a, a))).toBe(0);
  });

  it('is the same every time, so that a character always takes the same way', () => {
    const a = standingPoint('stock_shelf', 'stock_admin');
    const b = standingPoint('boss_desk', 'stock_admin');
    expect(findPath(a, b)).toEqual(findPath(a, b));
    expect(findPath({ ...a }, { ...b })).toEqual(findPath(a, b));
  });

  it('is never shorter than the straight line, and not much longer than needed', () => {
    for (const spot of WAITING_SPOTS) {
      const there = pathLength(findPath(ORDER_SPOT, spot));
      expect(there).toBeGreaterThanOrEqual(straight(ORDER_SPOT, spot) - 1e-9);
      expect(there).toBeLessThan(straight(ORDER_SPOT, spot) * 1.8 + 3);
    }
  });

  it('goes through the door of the office, not through its walls', () => {
    const shelf = standingPoint('stock_shelf', 'stock_admin');
    const desk = standingPoint('boss_desk', 'stock_admin');
    const path = findPath(shelf, desk);
    for (let index = 1; index < path.length; index += 1) {
      for (const wall of WALLS)
        expect(crossesWall(path[index - 1] as Point, path[index] as Point, wall), wall.name).toBe(
          false,
        );
    }
    // it is at the wall of the office somewhere within the gap of the door
    const atWall = sample(path).filter((point) => Math.abs(point.x - OFFICE.xMax) < 0.15);
    expect(atWall.length).toBeGreaterThan(0);
    for (const point of atWall) expect(Math.abs(point.z - OFFICE.doorZ)).toBeLessThan(0.7);
  });

  it('keeps clear of the tables and the counters all the way, from the door of the cafe to a seat and on to the hatch', () => {
    for (const spot of WAITING_SPOTS) {
      for (const path of [
        findPath(DOOR, spot),
        findPath(spot, PICKUP_SPOT),
        findPath(PICKUP_SPOT, DOOR),
      ]) {
        for (const point of sample(path).slice(1, -1)) {
          for (const table of TABLES)
            expect(
              Math.hypot(point.x - table.x, point.z - table.z),
              `table at ${table.x},${table.z}`,
            ).toBeGreaterThan(0.6);
          for (const counter of COUNTERS) {
            const near =
              Math.abs(point.z - counter.from.z) < 0.3 &&
              point.x > Math.min(counter.from.x, counter.to.x) &&
              point.x < Math.max(counter.from.x, counter.to.x);
            expect(near, `${counter.name} at ${point.x.toFixed(1)},${point.z.toFixed(1)}`).toBe(
              false,
            );
          }
        }
      }
    }
  });

  it('never leaves through the glass wall of the kitchen, which has a hatch and a door', () => {
    const cook = STATION_SPOTS.kitchen;
    const path = findPath(cook, { x: 2.2, z: -2.2 });
    for (let index = 1; index < path.length; index += 1) {
      expect(
        crossesWall(
          path[index - 1] as Point,
          path[index] as Point,
          WALLS.find((wall) => wall.name === 'kitchen-side') as never,
        ),
      ).toBe(false);
    }
    const through = sample(path).filter(
      (point) =>
        Math.abs(point.z - KITCHEN.zMax) < 0.15 &&
        point.x >= KITCHEN.xMin &&
        point.x <= KITCHEN.xMax,
    );
    expect(through.length).toBeGreaterThan(0); // the cook has to come out through the door
    for (const point of through) expect(Math.abs(point.x - KITCHEN.doorX)).toBeLessThan(0.7);
  });
});

describe('isBlocked', () => {
  it('knows the tables, the counters and the walls, and that the places where people stand are free', () => {
    expect(isBlocked({ x: TABLES[0]?.x ?? 0, z: TABLES[0]?.z ?? 0 })).toBe(true);
    expect(isBlocked({ x: -2.8, z: -3.7 })).toBe(true); // the cashier counter
    expect(isBlocked({ x: OFFICE.xMax, z: 0 })).toBe(false); // there is no wall there (the office ends at -0.5)
    expect(isBlocked({ x: OFFICE.xMax, z: -1.5 })).toBe(true); // the wall of the office
    expect(isBlocked({ x: OFFICE.xMax, z: OFFICE.doorZ })).toBe(false); // the door
    for (const spot of [
      DOOR,
      ORDER_SPOT,
      PICKUP_SPOT,
      ...WAITING_SPOTS,
      ...Object.values(STATION_SPOTS),
    ]) {
      expect(isBlocked(spot), `${spot.x},${spot.z}`).toBe(false);
    }
  });
});

describe('pointAlong', () => {
  const path = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 3 },
  ];

  it('measures the way along its length, round the corners', () => {
    expect(pathLength(path)).toBe(7);
    expect(pointAlong(path, 0)).toMatchObject({ x: 0, z: 0 });
    expect(pointAlong(path, 4 / 7)).toMatchObject({ x: 4, z: 0 });
    expect(pointAlong(path, 1)).toMatchObject({ x: 4, z: 3 });
    expect(pointAlong(path, 5.5 / 7).z).toBeCloseTo(1.5);
  });

  it('says which way it goes at that point', () => {
    expect(pointAlong(path, 0.2).heading).toBeCloseTo(Math.PI / 2); // along +x
    expect(pointAlong(path, 0.9).heading).toBeCloseTo(0); // along +z
  });

  it('stays inside the path for a fraction outside 0 to 1', () => {
    expect(pointAlong(path, -1)).toMatchObject({ x: 0, z: 0 });
    expect(pointAlong(path, 9)).toMatchObject({ x: 4, z: 3 });
  });
});
