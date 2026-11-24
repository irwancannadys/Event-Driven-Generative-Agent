import { COUNTERS, ROOM, TABLES, WALLS, type Point, type Wall } from './registry';

// Finding a way through the cafe: around the tables and counters, and through the doors of the walls, so
// that nobody walks through furniture. A grid over the floor with the obstacles marked, a shortest path
// over it, and the path pulled straight where it can be. Pure and the same every time, so a character
// that is walking always goes the same way (decision 027).

const CELL = 0.4;
const COLUMNS = Math.ceil((ROOM.xMax - ROOM.xMin) / CELL);
const ROWS = Math.ceil((ROOM.zMax - ROOM.zMin) / CELL);
const TABLE_CLEARANCE = 0.95; // a table and the chairs around it
const WALL_CLEARANCE = 0.3;
const COUNTER_CLEARANCE = 0.55;
const EDGE = 0.3;

function distanceToSegment(point: Point, wall: Wall): number {
  const dx = wall.to.x - wall.from.x;
  const dz = wall.to.z - wall.from.z;
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - wall.from.x) * dx + (point.z - wall.from.z) * dz) / lengthSquared,
          ),
        );
  return Math.hypot(point.x - (wall.from.x + t * dx), point.z - (wall.from.z + t * dz));
}

/** Whether a person cannot stand at this point of the floor. */
export function isBlocked(point: Point): boolean {
  if (point.x < ROOM.xMin + EDGE || point.x > ROOM.xMax - EDGE) return true;
  if (point.z < ROOM.zMin + EDGE || point.z > ROOM.zMax - EDGE) return true;
  if (TABLES.some((table) => Math.hypot(point.x - table.x, point.z - table.z) < TABLE_CLEARANCE))
    return true;
  if (WALLS.some((wall) => distanceToSegment(point, wall) < WALL_CLEARANCE)) return true;
  return COUNTERS.some((counter) => distanceToSegment(point, counter) < COUNTER_CLEARANCE);
}

const cellCenter = (column: number, row: number): Point => ({
  x: ROOM.xMin + (column + 0.5) * CELL,
  z: ROOM.zMin + (row + 0.5) * CELL,
});
const cellOf = (point: Point): { column: number; row: number } => ({
  column: Math.max(0, Math.min(COLUMNS - 1, Math.floor((point.x - ROOM.xMin) / CELL))),
  row: Math.max(0, Math.min(ROWS - 1, Math.floor((point.z - ROOM.zMin) / CELL))),
});

const blocked = new Uint8Array(COLUMNS * ROWS);
for (let row = 0; row < ROWS; row += 1) {
  for (let column = 0; column < COLUMNS; column += 1) {
    blocked[row * COLUMNS + column] = isBlocked(cellCenter(column, row)) ? 1 : 0;
  }
}

/** Whether the straight line between two points is free of obstacles. */
function clear(a: Point, b: Point): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 0.1));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const { column, row } = cellOf({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    if (blocked[row * COLUMNS + column]) return false;
  }
  return true;
}

/** The free cell nearest to a point (the point's own cell when it is free). */
function nearestFree(point: Point): number {
  const { column, row } = cellOf(point);
  if (!blocked[row * COLUMNS + column]) return row * COLUMNS + column;
  for (let ring = 1; ring < Math.max(COLUMNS, ROWS); ring += 1) {
    let best = -1;
    let bestDistance = Infinity;
    for (let dr = -ring; dr <= ring; dr += 1) {
      for (let dc = -ring; dc <= ring; dc += 1) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const r = row + dr;
        const c = column + dc;
        if (r < 0 || c < 0 || r >= ROWS || c >= COLUMNS || blocked[r * COLUMNS + c]) continue;
        const center = cellCenter(c, r);
        const distance = Math.hypot(center.x - point.x, center.z - point.z);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = r * COLUMNS + c;
        }
      }
    }
    if (best >= 0) return best;
  }
  return row * COLUMNS + column;
}

const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** A* over the free cells, from one cell to another. */
function search(start: number, goal: number): number[] {
  const cost = new Float64Array(COLUMNS * ROWS).fill(Infinity);
  const from = new Int32Array(COLUMNS * ROWS).fill(-1);
  const goalColumn = goal % COLUMNS;
  const goalRow = Math.floor(goal / COLUMNS);
  const heuristic = (cell: number): number => {
    const dx = Math.abs((cell % COLUMNS) - goalColumn);
    const dz = Math.abs(Math.floor(cell / COLUMNS) - goalRow);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  const open: { cell: number; priority: number }[] = [];
  const push = (cell: number, priority: number): void => {
    open.push({ cell, priority });
    let index = open.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (
        (open[parent] as { priority: number }).priority <=
        (open[index] as { priority: number }).priority
      )
        break;
      [open[parent], open[index]] = [
        open[index] as (typeof open)[number],
        open[parent] as (typeof open)[number],
      ];
      index = parent;
    }
  };
  const pop = (): number => {
    const top = open[0] as (typeof open)[number];
    const last = open.pop() as (typeof open)[number];
    if (open.length > 0) {
      open[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (
          left < open.length &&
          (open[left] as { priority: number }).priority <
            (open[smallest] as { priority: number }).priority
        )
          smallest = left;
        if (
          right < open.length &&
          (open[right] as { priority: number }).priority <
            (open[smallest] as { priority: number }).priority
        )
          smallest = right;
        if (smallest === index) break;
        [open[smallest], open[index]] = [
          open[index] as (typeof open)[number],
          open[smallest] as (typeof open)[number],
        ];
        index = smallest;
      }
    }
    return top.cell;
  };

  cost[start] = 0;
  push(start, heuristic(start));
  while (open.length > 0) {
    const current = pop();
    if (current === goal) break;
    const column = current % COLUMNS;
    const row = Math.floor(current / COLUMNS);
    for (const [dc, dr, step] of NEIGHBOURS) {
      const c = column + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= COLUMNS || r >= ROWS || blocked[r * COLUMNS + c]) continue;
      // a diagonal step may not cut the corner of an obstacle
      if (dc !== 0 && dr !== 0 && (blocked[row * COLUMNS + c] || blocked[r * COLUMNS + column]))
        continue;
      const next = r * COLUMNS + c;
      const total = (cost[current] as number) + step;
      if (total < (cost[next] as number)) {
        cost[next] = total;
        from[next] = current;
        push(next, total + heuristic(next));
      }
    }
  }
  const cells: number[] = [];
  for (let cell = goal; cell !== -1; cell = from[cell] as number) {
    cells.push(cell);
    if (cell === start) break;
  }
  return cells.reverse();
}

const cache = new Map<string, Point[]>();

/**
 * A walkable path from `from` to `to` as a list of points, the first being `from` and the last `to`.
 * Straight when nothing is in the way; round the tables and through the doors when there is.
 */
export function findPath(from: Point, to: Point): Point[] {
  const key = `${from.x.toFixed(2)},${from.z.toFixed(2)}>${to.x.toFixed(2)},${to.z.toFixed(2)}`;
  const known = cache.get(key);
  if (known) return known;
  if (cache.size > 2000) cache.clear();

  let path: Point[];
  if (clear(from, to)) {
    path = [from, to];
  } else {
    const start = nearestFree(from);
    const goal = nearestFree(to);
    const cells = search(start, goal).map((cell) =>
      cellCenter(cell % COLUMNS, Math.floor(cell / COLUMNS)),
    );
    const raw = [from, ...cells, to];
    // pull the path straight: from each point go as far ahead as the line stays clear
    path = [from];
    let index = 0;
    while (index < raw.length - 1) {
      let far = raw.length - 1;
      while (far > index + 1 && !clear(raw[index] as Point, raw[far] as Point)) far -= 1;
      path.push(raw[far] as Point);
      index = far;
    }
  }
  cache.set(key, path);
  return path;
}

export function pathLength(path: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    length += Math.hypot(
      (path[index] as Point).x - (path[index - 1] as Point).x,
      (path[index] as Point).z - (path[index - 1] as Point).z,
    );
  }
  return length;
}

/** The point `fraction` (0 to 1) of the way along a path, and the way the path goes there. */
export function pointAlong(
  path: readonly Point[],
  fraction: number,
): { x: number; z: number; heading: number } {
  const first = path[0] as Point;
  const total = pathLength(path);
  let heading = 0;
  if (path.length > 1) {
    const second = path[1] as Point;
    heading = Math.atan2(second.x - first.x, second.z - first.z);
  }
  if (total === 0) return { x: first.x, z: first.z, heading };
  let remaining = Math.max(0, Math.min(1, fraction)) * total;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1] as Point;
    const b = path[index] as Point;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    heading = Math.atan2(b.x - a.x, b.z - a.z);
    if (remaining <= length || index === path.length - 1) {
      const t = length === 0 ? 1 : Math.min(1, remaining / length);
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading };
    }
    remaining -= length;
  }
  const last = path.at(-1) as Point;
  return { x: last.x, z: last.z, heading };
}
