import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import {
  DOOR_WIDTH,
  ENTRANCE,
  FURNITURE,
  KITCHEN,
  OFFICE,
  ROOM,
  TABLES,
  WALLS,
  type Wall,
} from './registry';

// The cafe from above and the front, from primitives, as a hall with two rooms in it: the kitchen at the
// back on the right and the boss's office at the back on the left, each behind a partition wall of wood
// and glass with a door. The glass lets you see in from the camera. Everything that does not change with
// the world is built here. The parts that do (the pot, the boxes on the shelf, the papers on the boss
// desk, the dishes at the hatch) are handed back as groups for the scene to fill.

export interface Room {
  group: Group;
  /** The pot on the stove, which wobbles while the cook is cooking. */
  pot: Mesh;
  /** The boxes on the stock shelf are put here (the group runs along the shelf, from left to right). */
  shelfBoxes: Group;
  /** The papers on the boss desk are put here. */
  reportPapers: Group;
  /** The dishes that wait at the kitchen hatch for their customers are put here. */
  dishes: Group;
}

const COLOR = {
  floor: 0xd7cdbd,
  rug: 0xcdb487,
  kitchenFloor: 0xe9e4d8,
  officeFloor: 0x7a8b72,
  wall: 0xf4ede0,
  wainscot: 0x6e8f7d,
  wood: 0x9a6b43,
  woodDark: 0x5c3f2a,
  steel: 0xc3c8cc,
  steelDark: 0x6d7378,
  black: 0x25272a,
  white: 0xfafaf7,
  glass: 0xcfe6ee,
  brick: 0xb86b4b,
  leaf: 0x3f8a4e,
  pot: 0xb66a3c,
  gold: 0xd9a441,
  cup: 0xf3efe6,
  coffee: 0x4a2e1f,
  cream: 0xefe2c4,
};

const materials = new Map<string, MeshStandardMaterial>();
function mat(color: number, roughness = 0.85, metalness = 0): MeshStandardMaterial {
  const key = `${color}:${roughness}:${metalness}`;
  let found = materials.get(key);
  if (!found) {
    found = new MeshStandardMaterial({ color, roughness, metalness });
    materials.set(key, found);
  }
  return found;
}
const glass = new MeshStandardMaterial({
  color: COLOR.glass,
  roughness: 0.05,
  metalness: 0,
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
});

function part(
  name: string,
  geometry: BufferGeometry,
  material: Material,
  x: number,
  y: number,
  z: number,
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = material !== glass;
  mesh.receiveShadow = true;
  return mesh;
}
const box = (
  name: string,
  w: number,
  h: number,
  d: number,
  material: Material,
  x: number,
  y: number,
  z: number,
) => part(name, new BoxGeometry(w, h, d), material, x, y, z);
const cyl = (
  name: string,
  top: number,
  bottom: number,
  h: number,
  material: Material,
  x: number,
  y: number,
  z: number,
  seg = 20,
) => part(name, new CylinderGeometry(top, bottom, h, seg), material, x, y, z);
const ball = (name: string, r: number, material: Material, x: number, y: number, z: number) =>
  part(name, new SphereGeometry(r, 16, 12), material, x, y, z);

// --- Walls and doors ---

const WALL_HEIGHT = 5;
const PARTITION_SOLID = 1;
const PARTITION_TOP = 2.7;
const DOOR_HEIGHT = 2.3;

/** A straight wall piece lying along x (at height `z`) or along z, from `a` to `b`. */
function slab(
  name: string,
  along: 'x' | 'z',
  fixed: number,
  a: number,
  b: number,
  y0: number,
  y1: number,
  thickness: number,
  material: Material,
): Mesh {
  const length = Math.abs(b - a);
  const middle = (a + b) / 2;
  const height = y1 - y0;
  return along === 'x'
    ? box(name, length, height, thickness, material, middle, y0 + height / 2, fixed)
    : box(name, thickness, height, length, material, fixed, y0 + height / 2, middle);
}

/** A wall along `axis` with an opening for a door: two pieces and a piece over the opening. */
function wallWithDoor(
  name: string,
  along: 'x' | 'z',
  fixed: number,
  from: number,
  to: number,
  doorAt: number,
  thickness: number,
  material: Material,
): Mesh[] {
  const open0 = doorAt - DOOR_WIDTH / 2;
  const open1 = doorAt + DOOR_WIDTH / 2;
  return [
    slab(`${name}-1`, along, fixed, from, open0, 0, WALL_HEIGHT, thickness, material),
    slab(`${name}-2`, along, fixed, open1, to, 0, WALL_HEIGHT, thickness, material),
    slab(`${name}-over`, along, fixed, open0, open1, DOOR_HEIGHT, WALL_HEIGHT, thickness, material),
  ];
}

/** A door in its frame, the leaf swung open a little. `along` is the direction of the wall it is in. */
function door(name: string, along: 'x' | 'z', x: number, z: number, glassLeaf = false): Group {
  const door = new Group();
  door.name = name;
  door.position.set(x, 0, z);
  if (along === 'z') door.rotation.y = Math.PI / 2;
  const half = DOOR_WIDTH / 2;
  const frame = mat(COLOR.woodDark, 0.7);
  door.add(
    box('frame-left', 0.1, DOOR_HEIGHT, 0.22, frame, -half - 0.05, DOOR_HEIGHT / 2, 0),
    box('frame-right', 0.1, DOOR_HEIGHT, 0.22, frame, half + 0.05, DOOR_HEIGHT / 2, 0),
    box('frame-top', DOOR_WIDTH + 0.2, 0.1, 0.22, frame, 0, DOOR_HEIGHT + 0.05, 0),
  );
  const hinge = new Group();
  hinge.name = 'leaf';
  hinge.position.set(-half, 0, 0);
  hinge.rotation.y = -0.9;
  hinge.add(
    box(
      'panel',
      DOOR_WIDTH,
      DOOR_HEIGHT - 0.05,
      0.06,
      glassLeaf ? glass : mat(COLOR.wood, 0.6),
      DOOR_WIDTH / 2,
      DOOR_HEIGHT / 2,
      0,
    ),
    box('frame-of-leaf', DOOR_WIDTH, 0.1, 0.08, frame, DOOR_WIDTH / 2, DOOR_HEIGHT - 0.1, 0),
    box('frame-of-leaf', DOOR_WIDTH, 0.1, 0.08, frame, DOOR_WIDTH / 2, 0.08, 0),
    ball('handle', 0.05, mat(COLOR.gold, 0.3, 0.8), DOOR_WIDTH - 0.15, 1.05, 0.06),
  );
  door.add(hinge);
  return door;
}

/** A partition: wood below, glass above, a rail on top. Where a door is, the wall is left open. */
function partition(wall: Wall): Mesh[] {
  const along = wall.from.z === wall.to.z ? 'x' : 'z';
  const fixed = along === 'x' ? wall.from.z : wall.from.x;
  const a = along === 'x' ? wall.from.x : wall.from.z;
  const b = along === 'x' ? wall.to.x : wall.to.z;
  return [
    slab(
      `${wall.name}-wood`,
      along,
      fixed,
      a,
      b,
      0,
      PARTITION_SOLID,
      0.18,
      mat(COLOR.wainscot, 0.7),
    ),
    slab(`${wall.name}-glass`, along, fixed, a, b, PARTITION_SOLID, PARTITION_TOP, 0.04, glass),
    slab(
      `${wall.name}-rail`,
      along,
      fixed,
      a,
      b,
      PARTITION_TOP,
      PARTITION_TOP + 0.08,
      0.14,
      mat(COLOR.woodDark, 0.6),
    ),
  ];
}

// --- Furniture ---

function tableWithChairs(index: number, x: number, z: number): Group {
  const table = new Group();
  table.name = `table-${index}`;
  table.position.set(x, 0, z);
  const wood = mat(COLOR.wood, 0.55);
  table.add(
    cyl('table-top', 0.7, 0.7, 0.07, wood, 0, 0.78, 0, 32),
    cyl('table-leg', 0.06, 0.06, 0.75, mat(COLOR.black, 0.4, 0.6), 0, 0.38, 0),
    cyl('table-foot', 0.32, 0.32, 0.04, mat(COLOR.black, 0.4, 0.6), 0, 0.02, 0),
  );
  // two chairs at the sides (the places of the customers) and two more at the front and the back
  for (const [dx, dz, turn] of [
    [-1, 0, Math.PI / 2],
    [1, 0, -Math.PI / 2],
    [0, -1, 0],
    [0, 1, Math.PI],
  ] as const) {
    table.add(chair(dx * 0.95, dz * 0.95, turn));
  }
  // on the table: a plate, a cup on a saucer, a little vase with a flower, a sugar pot
  table.add(
    cyl('plate', 0.2, 0.17, 0.03, mat(COLOR.white, 0.3), -0.25, 0.835, 0.12),
    cyl('saucer', 0.14, 0.12, 0.02, mat(COLOR.white, 0.3), 0.22, 0.83, 0.18),
    cyl('cup', 0.07, 0.055, 0.1, mat(COLOR.cup, 0.3), 0.22, 0.89, 0.18),
    cyl('coffee', 0.06, 0.06, 0.01, mat(COLOR.coffee, 0.2), 0.22, 0.94, 0.18),
    cyl('vase', 0.05, 0.04, 0.16, mat(0x4d7ea8, 0.3), 0.02, 0.9, -0.2),
    ball('flower', 0.07, mat(0xd9455f, 0.7), 0.02, 1.03, -0.2),
    cyl('sugar', 0.05, 0.05, 0.08, mat(COLOR.cream, 0.4), 0.3, 0.86, -0.15),
  );
  return table;
}

function chair(x: number, z: number, turn: number): Group {
  const chair = new Group();
  chair.name = 'chair';
  chair.position.set(x, 0, z);
  chair.rotation.y = turn;
  const wood = mat(COLOR.woodDark, 0.6);
  chair.add(
    box('seat', 0.46, 0.05, 0.46, mat(COLOR.leaf, 0.8), 0, 0.47, 0),
    box('back', 0.46, 0.5, 0.05, wood, 0, 0.75, -0.22),
  );
  for (const [lx, lz] of [
    [-0.2, -0.2],
    [0.2, -0.2],
    [-0.2, 0.2],
    [0.2, 0.2],
  ] as const) {
    chair.add(box('chair-leg', 0.05, 0.45, 0.05, wood, lx, 0.23, lz));
  }
  return chair;
}

function plant(x: number, z: number, scale = 1): Group {
  const plant = new Group();
  plant.name = 'plant';
  plant.position.set(x, 0, z);
  plant.scale.setScalar(scale);
  plant.add(cyl('pot', 0.28, 0.2, 0.45, mat(COLOR.pot, 0.8), 0, 0.22, 0));
  for (const [dx, dy, dz, r] of [
    [0, 0.95, 0, 0.42],
    [0.2, 0.7, 0.12, 0.3],
    [-0.2, 0.75, -0.1, 0.3],
    [0, 1.3, 0.05, 0.28],
  ] as const) {
    plant.add(ball('leaves', r, mat(COLOR.leaf, 0.9), dx, dy, dz));
  }
  return plant;
}

function frame(
  name: string,
  w: number,
  h: number,
  color: number,
  x: number,
  y: number,
  z: number,
  along: 'x' | 'z',
  facing: 1 | -1,
): Group {
  const picture = new Group();
  picture.name = name;
  picture.position.set(x, y, z);
  if (along === 'z') picture.rotation.y = (Math.PI / 2) * facing;
  else if (facing === -1) picture.rotation.y = Math.PI;
  picture.add(
    box('frame', w, h, 0.06, mat(COLOR.woodDark, 0.5), 0, 0, 0),
    box('canvas', w - 0.14, h - 0.14, 0.02, mat(color, 0.9), 0, 0, 0.035),
    box(
      'sun',
      (w - 0.14) * 0.3,
      (h - 0.14) * 0.3,
      0.02,
      mat(COLOR.gold, 0.8),
      (w - 0.14) * 0.2,
      (h - 0.14) * 0.15,
      0.05,
    ),
  );
  return picture;
}

function pendantLamp(x: number, z: number, height = 3.4): Group {
  const lamp = new Group();
  lamp.name = 'pendant-lamp';
  lamp.position.set(x, height, z);
  lamp.add(
    cyl(
      'cord',
      0.01,
      0.01,
      WALL_HEIGHT - height,
      mat(COLOR.black),
      0,
      (WALL_HEIGHT - height) / 2,
      0,
      6,
    ),
    part('shade', new ConeGeometry(0.34, 0.28, 24, 1, true), mat(COLOR.gold, 0.4, 0.6), 0, 0, 0),
    ball(
      'bulb',
      0.1,
      new MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe6a0, emissiveIntensity: 1.6 }),
      0,
      -0.04,
      0,
    ),
  );
  return lamp;
}

export function buildRoom(): Room {
  const group = new Group();
  group.name = 'room';
  const { cashierDesk, kitchenIsland, shelf, bossDesk } = FURNITURE;
  const wallColor = mat(COLOR.wall, 0.95);
  const midX = (ROOM.xMin + ROOM.xMax) / 2;
  const midZ = (ROOM.zMin + ROOM.zMax) / 2;
  const width = ROOM.xMax - ROOM.xMin;
  const depth = ROOM.zMax - ROOM.zMin;

  // The cafe stands on a slab, like a model: its edge shows under the walls
  group.add(box('base-slab', width + 0.8, 0.5, depth + 0.8, mat(0xe9e5dc, 0.9), midX, -0.26, midZ));

  // The floor in three: stone in the hall, tiles in the kitchen, green in the office; a rug in the hall
  const floorPart = (
    name: string,
    w: number,
    d: number,
    color: number,
    x: number,
    z: number,
    y = 0.001,
  ): Mesh => {
    const floor = part(name, new PlaneGeometry(w, d), mat(color, 0.6), x, y, z);
    floor.rotation.x = -Math.PI / 2;
    floor.castShadow = false;
    return floor;
  };
  group.add(
    floorPart('floor', width, depth, COLOR.floor, midX, midZ),
    floorPart(
      'kitchen-floor',
      KITCHEN.xMax - KITCHEN.xMin,
      KITCHEN.zMax - KITCHEN.zMin,
      COLOR.kitchenFloor,
      (KITCHEN.xMin + KITCHEN.xMax) / 2,
      (KITCHEN.zMin + KITCHEN.zMax) / 2,
    ),
    floorPart(
      'office-floor',
      OFFICE.xMax - OFFICE.xMin,
      OFFICE.zMax - OFFICE.zMin,
      COLOR.officeFloor,
      (OFFICE.xMin + OFFICE.xMax) / 2,
      (OFFICE.zMin + OFFICE.zMax) / 2,
    ),
    floorPart('hall-rug-border', 8.2, 5.6, 0x8a6a45, 0, 3.4, 0.003),
    floorPart('hall-rug', 7.6, 5, COLOR.rug, 0, 3.4, 0.005),
  );

  // The outer walls: back, left and right (each of the sides with a door), and the glass front
  const doorAtLeft = 3.2;
  const doorAtRight = 2;
  group.add(
    slab('wall-back', 'x', ROOM.zMin - 0.1, ROOM.xMin, ROOM.xMax, 0, WALL_HEIGHT, 0.2, wallColor),
    ...wallWithDoor(
      'wall-left',
      'z',
      ROOM.xMin - 0.1,
      ROOM.zMin,
      ROOM.zMax,
      doorAtLeft,
      0.2,
      wallColor,
    ),
    ...wallWithDoor(
      'wall-right',
      'z',
      ROOM.xMax + 0.1,
      ROOM.zMin,
      ROOM.zMax,
      doorAtRight,
      0.2,
      wallColor,
    ),
    slab(
      'wainscot-back',
      'x',
      ROOM.zMin + 0.02,
      ROOM.xMin,
      ROOM.xMax,
      0,
      1.1,
      0.05,
      mat(COLOR.wainscot, 0.7),
    ),
    door('door-wc', 'z', ROOM.xMin - 0.1, doorAtLeft),
    door('door-side', 'z', ROOM.xMax + 0.1, doorAtRight),
  );

  // The front of the cafe is glass on a low stone wall, with the entrance (a double door) in the middle
  const front = ROOM.zMax + 0.05;
  const entranceHalf = DOOR_WIDTH;
  for (const [name, a, b] of [
    ['front-left', ROOM.xMin, ENTRANCE.x - entranceHalf],
    ['front-right', ENTRANCE.x + entranceHalf, ROOM.xMax],
  ] as const) {
    group.add(
      slab(`${name}-base`, 'x', front, a, b, 0, 0.55, 0.3, mat(0xcfc7b8, 0.8)),
      slab(`${name}-glass`, 'x', front, a, b, 0.55, 2.8, 0.04, glass),
      slab(`${name}-rail`, 'x', front, a, b, 2.8, 2.92, 0.12, mat(COLOR.black, 0.5)),
    );
    for (let post = 0; post <= Math.round((b - a) / 2.2); post += 1) {
      const x = a + (post * (b - a)) / Math.round((b - a) / 2.2);
      group.add(box('front-post', 0.08, 2.3, 0.1, mat(COLOR.black, 0.5), x, 1.7, front));
    }
  }
  group.add(
    slab(
      'front-over-door',
      'x',
      front,
      ENTRANCE.x - entranceHalf,
      ENTRANCE.x + entranceHalf,
      2.5,
      2.92,
      0.12,
      mat(COLOR.black, 0.5),
    ),
  );
  const entrance = new Group();
  entrance.name = 'door-entrance';
  entrance.position.set(ENTRANCE.x, 0, front);
  for (const side of [-1, 1] as const) {
    const leaf = new Group();
    leaf.position.set(side * entranceHalf, 0, 0);
    leaf.rotation.y = side * 0.7;
    leaf.add(
      box('panel', entranceHalf, 2.4, 0.04, glass, (-side * entranceHalf) / 2, 1.2, 0),
      box(
        'leaf-frame',
        entranceHalf,
        0.08,
        0.06,
        mat(COLOR.black, 0.4),
        (-side * entranceHalf) / 2,
        2.38,
        0,
      ),
      box('leaf-frame', 0.06, 2.4, 0.06, mat(COLOR.black, 0.4), -side * entranceHalf, 1.2, 0),
      cyl(
        'handle',
        0.02,
        0.02,
        0.6,
        mat(COLOR.steel, 0.3, 0.8),
        -side * (entranceHalf - 0.12),
        1.1,
        0.06,
        8,
      ),
    );
    entrance.add(leaf);
  }
  group.add(entrance);
  // Planters along the glass, full of green, on both sides of the door
  for (const [name, a, b] of [
    ['planter-left', ROOM.xMin + 1, ENTRANCE.x - 2.4],
    ['planter-right', ENTRANCE.x + 2.4, ROOM.xMax - 1],
  ] as const) {
    group.add(box(name, b - a, 0.5, 0.6, mat(0xd8d2c4, 0.8), (a + b) / 2, 0.25, ROOM.zMax - 0.5));
    for (let bush = 0; bush < Math.round((b - a) / 0.55); bush += 1) {
      const x = a + 0.3 + bush * 0.55;
      group.add(
        ball(
          'bush',
          0.32 + (bush % 3) * 0.05,
          mat(bush % 2 ? 0x4f8f4a : 0x3f7a3f, 0.9),
          x,
          0.7 + (bush % 3) * 0.08,
          ROOM.zMax - 0.5,
        ),
      );
    }
  }

  // The partitions of the kitchen and the office, and their doors
  for (const wall of WALLS) group.add(...partition(wall));
  group.add(
    door('door-office', 'z', OFFICE.xMax, OFFICE.doorZ),
    door('door-kitchen', 'x', KITCHEN.doorX, KITCHEN.zMax),
  );
  // The hatch of the kitchen: a sill where the food is put, under an awning
  group.add(
    box(
      'hatch-sill',
      0.7,
      0.06,
      1.5,
      mat(COLOR.woodDark, 0.5),
      KITCHEN.xMin - 0.1,
      1.04,
      KITCHEN.hatchZ,
    ),
    box(
      'hatch-awning',
      0.9,
      0.08,
      1.7,
      mat(COLOR.brick, 0.8),
      KITCHEN.xMin - 0.1,
      2.3,
      KITCHEN.hatchZ,
    ),
  );

  // Cashier: counter clad in stone with a warm strip of light, till, espresso machine, grinder, pastry case
  const cx = cashierDesk.x;
  const cz = cashierDesk.z;
  group.add(
    box('cashier-counter', 4.8, 1.05, 0.9, mat(0xcfc7b8, 0.8), cx, 0.525, cz),
    box('counter-top', 5, 0.06, 1.05, mat(COLOR.woodDark, 0.4), cx, 1.08, cz),
    box(
      'counter-light',
      4.6,
      0.04,
      0.03,
      new MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffc070, emissiveIntensity: 1.4 }),
      cx,
      0.12,
      cz + 0.46,
    ),
    box('till', 0.5, 0.3, 0.4, mat(COLOR.black, 0.4), cx + 1.5, 1.26, cz - 0.1),
    box('espresso-machine', 0.9, 0.5, 0.45, mat(COLOR.steel, 0.25, 0.8), cx - 1.4, 1.36, cz - 0.15),
    cyl('grinder', 0.13, 0.17, 0.5, mat(COLOR.steelDark, 0.3, 0.7), cx - 2.15, 1.36, cz - 0.15),
    box('pastry-case', 1.5, 0.5, 0.5, glass, cx + 0.2, 1.38, cz + 0.1),
    box('pastry-tray', 1.4, 0.04, 0.42, mat(COLOR.white, 0.3), cx + 0.2, 1.22, cz + 0.1),
    ball('croissant', 0.09, mat(0xc98a3d, 0.8), cx - 0.2, 1.3, cz + 0.1),
    ball('croissant', 0.09, mat(0xc98a3d, 0.8), cx + 0.2, 1.3, cz + 0.1),
    ball('cake', 0.11, mat(0xf2c9d6, 0.7), cx + 0.6, 1.31, cz + 0.1),
    box('menu-frame', 2.74, 1.24, 0.04, mat(COLOR.woodDark, 0.5), cx, 3.7, ROOM.zMin + 0.03),
    box('menu-board', 2.6, 1.1, 0.06, mat(COLOR.black, 0.9), cx, 3.7, ROOM.zMin + 0.05),
  );
  for (let line = 0; line < 6; line += 1) {
    group.add(
      box(
        'menu-line',
        1.5 - (line % 3) * 0.3,
        0.04,
        0.02,
        mat(COLOR.white, 0.9),
        cx - 0.2,
        4.1 - line * 0.16,
        ROOM.zMin + 0.1,
      ),
    );
  }
  // behind the counter: wooden slats on the wall, and shelves with jars and cups
  for (let slat = 0; slat < 23; slat += 1) {
    group.add(
      box(
        'slat',
        0.1,
        1.9,
        0.06,
        mat(0xb98a5a, 0.6),
        cx - 2.3 + slat * 0.2,
        2.05,
        ROOM.zMin + 0.05,
      ),
    );
  }
  for (const [index, height] of [1.9, 2.5].entries()) {
    group.add(
      box(
        `wall-shelf-${index + 1}`,
        4.6,
        0.05,
        0.3,
        mat(COLOR.wood, 0.5),
        cx,
        height,
        ROOM.zMin + 0.22,
      ),
    );
  }
  for (let jar = 0; jar < 6; jar += 1) {
    group.add(
      cyl(
        'jar',
        0.1,
        0.1,
        0.22,
        mat(jar % 2 ? COLOR.cream : 0x7a4a2c, 0.5),
        cx - 2 + jar * 0.8,
        2.04,
        ROOM.zMin + 0.22,
      ),
    );
  }
  for (let cup = 0; cup < 9; cup += 1) {
    group.add(
      cyl(
        'cup',
        0.07,
        0.055,
        0.1,
        mat(COLOR.cup, 0.3),
        cx - 2.1 + cup * 0.52,
        2.63,
        ROOM.zMin + 0.22,
      ),
    );
  }

  // Kitchen: island with the stove and the pot, hood, fridge, prep counter at the hatch, shelf and pans
  const pot = cyl(
    'pot',
    0.32,
    0.3,
    0.35,
    mat(COLOR.steelDark, 0.3, 0.8),
    kitchenIsland.x + 0.5,
    1.38,
    kitchenIsland.z,
  );
  group.add(
    box(
      'kitchen-island',
      4,
      1.05,
      0.9,
      mat(COLOR.steel, 0.35, 0.6),
      kitchenIsland.x,
      0.525,
      kitchenIsland.z,
    ),
    box('stove', 1.6, 0.1, 0.8, mat(COLOR.black, 0.5), kitchenIsland.x, 1.1, kitchenIsland.z),
    pot,
    cyl(
      'burner',
      0.16,
      0.16,
      0.03,
      mat(COLOR.black),
      kitchenIsland.x - 0.45,
      1.17,
      kitchenIsland.z,
    ),
    cyl(
      'burner',
      0.16,
      0.16,
      0.03,
      mat(COLOR.black),
      kitchenIsland.x + 0.05,
      1.17,
      kitchenIsland.z - 0.2,
    ),
    cyl(
      'pan',
      0.22,
      0.2,
      0.06,
      mat(COLOR.black, 0.4, 0.5),
      kitchenIsland.x - 0.45,
      1.22,
      kitchenIsland.z,
    ),
    box('hood', 2, 0.5, 1, mat(COLOR.steel, 0.3, 0.7), kitchenIsland.x, 3.5, kitchenIsland.z),
    box(
      'hood-pipe',
      0.5,
      1.2,
      0.5,
      mat(COLOR.steel, 0.3, 0.7),
      kitchenIsland.x,
      4.4,
      kitchenIsland.z,
    ),
    box('fridge', 1.1, 2.2, 0.9, mat(COLOR.white, 0.3, 0.3), 10.2, 1.1, -4.9),
    box('fridge-handle', 0.05, 0.8, 0.05, mat(COLOR.steelDark, 0.3, 0.8), 9.62, 1.4, -4.42),
    box(
      'prep-counter',
      0.9,
      1.05,
      3.2,
      mat(COLOR.steel, 0.35, 0.6),
      KITCHEN.xMin + 0.55,
      0.525,
      -4,
    ),
    box('prep-board', 0.6, 0.04, 0.9, mat(COLOR.wood, 0.5), KITCHEN.xMin + 0.55, 1.07, -4.2),
    box('kitchen-shelf', 3, 0.05, 0.35, mat(COLOR.steel, 0.35, 0.6), 7.2, 2.2, KITCHEN.zMin + 0.2),
  );
  for (let hung = 0; hung < 5; hung += 1) {
    group.add(
      part(
        'hanging-pan',
        new TorusGeometry(0.15, 0.03, 8, 16),
        mat(COLOR.steelDark, 0.4, 0.7),
        5.2 + hung * 0.6,
        3.1,
        KITCHEN.zMin + 0.1,
      ),
      cyl(
        'pot-on-shelf',
        0.12,
        0.1,
        0.18,
        mat(hung % 2 ? COLOR.steelDark : COLOR.pot, 0.4, 0.5),
        5.6 + hung * 0.5,
        2.33,
        KITCHEN.zMin + 0.2,
      ),
    );
  }
  const dishes = new Group();
  dishes.name = 'dishes';
  dishes.position.set(KITCHEN.xMin - 0.1, 1.08, KITCHEN.hatchZ + 0.62);
  dishes.rotation.y = Math.PI / 2;
  group.add(dishes);

  // Boss office: desk, chair, laptop, lamp, bookshelf, plant, diploma, rug
  group.add(
    box('boss-desk', 1.3, 0.9, 2.8, mat(COLOR.woodDark, 0.45), bossDesk.x, 0.45, bossDesk.z),
    box('boss-chair', 0.7, 0.1, 0.7, mat(COLOR.black, 0.6), -10.2, 0.55, bossDesk.z),
    box('boss-chair-back', 0.1, 0.8, 0.7, mat(COLOR.black, 0.6), -10.55, 0.95, bossDesk.z),
    box(
      'laptop',
      0.35,
      0.02,
      0.5,
      mat(COLOR.steel, 0.3, 0.7),
      bossDesk.x - 0.3,
      0.92,
      bossDesk.z + 0.5,
    ),
    box(
      'laptop-screen',
      0.02,
      0.32,
      0.5,
      mat(COLOR.black, 0.3),
      bossDesk.x - 0.47,
      1.08,
      bossDesk.z + 0.5,
    ),
    cyl(
      'desk-lamp',
      0.12,
      0.14,
      0.04,
      mat(COLOR.gold, 0.4, 0.6),
      bossDesk.x - 0.3,
      0.92,
      bossDesk.z - 0.9,
    ),
    cyl(
      'desk-lamp-arm',
      0.02,
      0.02,
      0.5,
      mat(COLOR.gold, 0.4, 0.6),
      bossDesk.x - 0.3,
      1.15,
      bossDesk.z - 0.9,
      8,
    ),
    cyl('mug', 0.06, 0.05, 0.1, mat(0xd9455f, 0.4), bossDesk.x + 0.2, 0.95, bossDesk.z - 0.3),
    box('bookshelf', 3.4, 2.4, 0.4, mat(COLOR.woodDark, 0.5), -8.6, 1.2, OFFICE.zMin + 0.25),
    box('office-rug', 3.2, 0.01, 2.8, mat(0xb8a47a, 0.95), -8.8, 0.006, bossDesk.z),
  );
  for (let book = 0; book < 12; book += 1) {
    group.add(
      box(
        'book',
        0.14,
        0.4 + (book % 3) * 0.06,
        0.28,
        mat([0xc0504d, 0x4f81bd, 0x9bbb59, 0xf79646, 0x8064a2][book % 5] as number, 0.8),
        -10.1 + book * 0.28,
        0.9,
        OFFICE.zMin + 0.25,
      ),
    );
  }
  const reportPapers = new Group();
  reportPapers.name = 'report-papers';
  reportPapers.position.set(bossDesk.x + 0.15, 0, bossDesk.z + 0.05);
  group.add(reportPapers);

  // Stock shelf along the back wall: two boards on posts. The boxes go in the group on top of it.
  for (const [index, height] of [1, 2].entries()) {
    group.add(
      box(
        `shelf-board-${index + 1}`,
        2.4,
        0.1,
        0.8,
        mat(COLOR.wood, 0.5),
        shelf.x,
        height,
        shelf.z + 0.1,
      ),
    );
  }
  for (const dx of [-1.15, 1.15]) {
    group.add(
      box(
        'shelf-post',
        0.12,
        2.9,
        0.12,
        mat(COLOR.woodDark, 0.6),
        shelf.x + dx,
        1.45,
        shelf.z + 0.1,
      ),
    );
  }
  const shelfBoxes = new Group();
  shelfBoxes.name = 'shelf-boxes';
  shelfBoxes.position.set(shelf.x, 0, shelf.z + 0.1);
  shelfBoxes.rotation.y = Math.PI / 2;
  group.add(shelfBoxes);

  // The customers' tables with their chairs, and a lamp hanging over each; over the counter three more
  for (const [index, table] of TABLES.entries()) {
    group.add(tableWithChairs(index + 1, table.x, table.z), pendantLamp(table.x, table.z));
  }
  for (const dx of [-1.6, 0, 1.6]) group.add(pendantLamp(cx + dx, cz + 0.2, 3.1));
  // a bench along the left wall, with cushions
  group.add(
    box('bench', 0.7, 0.45, 5, mat(0x7d5a3c, 0.7), ROOM.xMin + 0.5, 0.23, 3.6),
    box('bench-back', 0.15, 0.7, 5, mat(0x7d5a3c, 0.7), ROOM.xMin + 0.18, 0.8, 3.6),
  );
  for (let cushion = 0; cushion < 4; cushion += 1) {
    group.add(
      box(
        'cushion',
        0.5,
        0.12,
        0.9,
        mat([0xd9a441, 0x6e8f7d, 0xc0504d, 0x4f81bd][cushion] as number, 0.95),
        ROOM.xMin + 0.5,
        0.52,
        1.5 + cushion * 1.2,
      ),
    );
  }

  // Decoration: paintings, a clock, plants, windows
  group.add(
    frame('painting-1', 1.4, 1, 0x3d6fa5, 4.8, 3.3, ROOM.zMin + 0.08, 'x', 1),
    frame('painting-2', 1, 1.3, 0xc0504d, -5.9, 3.2, ROOM.zMin + 0.08, 'x', 1),
    frame('painting-3', 1.6, 1.1, 0x4a8a5c, 8.6, 3.4, KITCHEN.zMin + 0.08, 'x', 1),
    frame('painting-4', 1.3, 1.6, 0xd99a3d, ROOM.xMin + 0.08, 3, 0.6, 'z', 1),
    frame('painting-5', 1.5, 1, 0x7a5c9e, ROOM.xMax - 0.08, 3.1, 5.2, 'z', -1),
    frame('diploma', 0.8, 0.6, 0xf2e6c8, -9.2, 2.6, OFFICE.zMin + 0.1, 'x', 1),
    plant(-10.3, 0.4, 1.2),
    plant(-10.3, 6.4, 1.2),
    plant(10.3, 6.4, 1.3),
    plant(10.3, 3.6, 1),
    plant(-6.8, -4.9, 1),
  );
  const clock = cyl('clock', 0.4, 0.4, 0.06, mat(COLOR.white, 0.4), 1.7, 3.9, ROOM.zMin + 0.08);
  clock.rotation.x = Math.PI / 2;
  group.add(
    clock,
    box('clock-hand-1', 0.04, 0.3, 0.02, mat(COLOR.black), 1.7, 3.98, ROOM.zMin + 0.12),
    box('clock-hand-2', 0.26, 0.04, 0.02, mat(COLOR.black), 1.8, 3.9, ROOM.zMin + 0.12),
  );
  for (const [x, z, along] of [
    [-8.6, ROOM.zMin + 0.05, 'x'],
    [ROOM.xMax - 0.05, 0.2, 'z'],
    [ROOM.xMin + 0.05, 5.8, 'z'],
  ] as const) {
    const window = new Group();
    window.name = 'window';
    window.position.set(x, 2.9, z);
    if (along === 'z') window.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
    window.add(
      box('window-frame', 2.2, 1.7, 0.08, mat(COLOR.white, 0.5), 0, 0, 0),
      box(
        'window-sky',
        2,
        1.5,
        0.02,
        new MeshStandardMaterial({ color: 0xbfe3f6, emissive: 0x8ccbe8, emissiveIntensity: 0.7 }),
        0,
        0,
        0.04,
      ),
      box('window-bar', 0.06, 1.5, 0.03, mat(COLOR.white, 0.5), 0, 0, 0.06),
      box('window-bar', 2, 0.06, 0.03, mat(COLOR.white, 0.5), 0, 0, 0.06),
    );
    group.add(window);
  }

  return { group, pot, shelfBoxes, reportPapers, dishes };
}
