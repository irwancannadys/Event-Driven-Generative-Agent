import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  type BufferGeometry,
} from 'three';
import { FURNITURE } from './registry';

// The room, from primitives (brief section 11): floor, wall, the desks and the shelf. Sizes and colours
// follow the layout in docs/reference/. Nothing here moves or decides anything; the parts that change
// with the world (the pot, the boxes on the shelf, the papers on the boss desk) are handed back as groups
// for the scene to fill.

const COLORS = {
  floor: 0xd9b98a,
  wall: 0xf1ebdd,
  woodLight: 0x8b6b4a,
  woodDark: 0x6b4f36,
  metal: 0x444441,
  counter: 0xb4b2a9,
  stove: 0x2c2c2a,
  pot: 0x888780,
  tableTop: 0xba7517,
};

export interface Room {
  group: Group;
  /** The pot on the stove, which wobbles while the cook is cooking. */
  pot: Mesh;
  /** The boxes on the stock shelf are put here. */
  shelfBoxes: Group;
  /** The papers on the boss desk are put here. */
  reportPapers: Group;
}

function part(
  name: string,
  geometry: BufferGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
): Mesh {
  const mesh = new Mesh(geometry, new MeshLambertMaterial({ color }));
  mesh.name = name;
  mesh.position.set(x, y, z);
  return mesh;
}

const box = (
  name: string,
  w: number,
  h: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number,
) => part(name, new BoxGeometry(w, h, d), color, x, y, z);

export function buildRoom(): Room {
  const group = new Group();
  group.name = 'room';

  const floor = part('floor', new PlaneGeometry(18, 11), COLORS.floor, 0, 0, 0.5);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor, box('wall', 18, 5, 0.15, COLORS.wall, 0, 2.5, -5));

  // Cashier desk with the till
  const { cashierDesk, kitchen, shelf, bossDesk, tables } = FURNITURE;
  group.add(
    box('cashier-desk', 3, 1, 1, COLORS.woodLight, cashierDesk.x, 0.5, cashierDesk.z),
    box('till', 0.6, 0.4, 0.5, COLORS.metal, cashierDesk.x, 1.2, cashierDesk.z),
  );

  // Kitchen counter, stove and pot
  const pot = part(
    'pot',
    new CylinderGeometry(0.32, 0.32, 0.35, 20),
    COLORS.pot,
    kitchen.x + 0.2,
    1.3,
    kitchen.z,
  );
  group.add(
    box('kitchen-counter', 3, 1, 1, COLORS.counter, kitchen.x, 0.5, kitchen.z),
    box('stove', 1.2, 0.12, 0.8, COLORS.stove, kitchen.x, 1.06, kitchen.z),
    pot,
  );

  // Boss desk, and the place where the papers of the reports lie
  group.add(box('boss-desk', 3, 0.9, 1.2, COLORS.woodDark, bossDesk.x, 0.45, bossDesk.z));
  const reportPapers = new Group();
  reportPapers.name = 'report-papers';
  reportPapers.position.set(bossDesk.x, 0, bossDesk.z);
  group.add(reportPapers);

  // Stock shelf: two boards on four legs, and the group for the boxes
  for (const [index, height] of [1, 2].entries()) {
    group.add(
      box(`shelf-board-${index + 1}`, 1, 0.1, 2.8, COLORS.woodLight, shelf.x, height, shelf.z),
    );
  }
  for (const dx of [-0.45, 0.45]) {
    for (const dz of [-1.3, 1.3]) {
      group.add(
        box('shelf-leg', 0.12, 2.1, 0.12, COLORS.woodDark, shelf.x + dx, 1.05, shelf.z + dz),
      );
    }
  }
  const shelfBoxes = new Group();
  shelfBoxes.name = 'shelf-boxes';
  shelfBoxes.position.set(shelf.x, 0, shelf.z);
  group.add(shelfBoxes);

  // Three customer tables
  for (const [index, table] of tables.entries()) {
    group.add(
      part(
        `table-${index + 1}-top`,
        new CylinderGeometry(0.65, 0.65, 0.08, 24),
        COLORS.tableTop,
        table.x,
        0.78,
        table.z,
      ),
      part(
        `table-${index + 1}-leg`,
        new CylinderGeometry(0.08, 0.08, 0.75, 12),
        COLORS.woodDark,
        table.x,
        0.38,
        table.z,
      ),
    );
  }

  return { group, pot, shelfBoxes, reportPapers };
}
