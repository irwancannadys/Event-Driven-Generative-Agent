import { describe, expect, it } from 'vitest';
import { FURNITURE, KITCHEN, OFFICE, ROOM, TABLES } from './registry';
import { buildRoom } from './room';

// The picture itself needs a browser, but the room can be built without one: the objects and where they
// stand are plain data.
describe('buildRoom', () => {
  const room = buildRoom();
  const named = (name: string) => room.group.getObjectByName(name);

  it('has the hall, the walls, the counters, the stove, the shelf, the desk and the seven tables', () => {
    const names = [
      'floor',
      'kitchen-floor',
      'office-floor',
      'wall-back',
      'wall-left-1',
      'wall-right-1',
      'cashier-counter',
      'espresso-machine',
      'pastry-case',
      'menu-board',
      'kitchen-island',
      'stove',
      'pot',
      'fridge',
      'boss-desk',
      'bookshelf',
      'laptop',
      'shelf-board-1',
      'shelf-board-2',
      'hatch-sill',
    ];
    for (const name of [...names, ...TABLES.map((_, index) => `table-${index + 1}`)]) {
      expect(named(name), name).toBeDefined();
    }
  });

  it('has a door for the entrance, the office, the kitchen, the side and the toilet', () => {
    for (const name of ['door-entrance', 'door-office', 'door-kitchen', 'door-side', 'door-wc']) {
      expect(named(name), name).toBeDefined();
    }
  });

  it('separates the kitchen and the office from the hall with walls of wood and glass', () => {
    for (const name of [
      'office-front',
      'office-side-1',
      'office-side-2',
      'kitchen-side',
      'kitchen-front-1',
      'kitchen-front-2',
    ]) {
      for (const layer of ['wood', 'glass', 'rail'])
        expect(named(`${name}-${layer}`), `${name}-${layer}`).toBeDefined();
    }
  });

  it('has seven tables, each with chairs and something on it', () => {
    expect(TABLES).toHaveLength(7);
    for (let index = 1; index <= 7; index += 1) {
      const table = named(`table-${index}`);
      expect(table?.children.filter((child) => child.name === 'chair')).toHaveLength(4);
      for (const name of ['plate', 'cup', 'vase'])
        expect(table?.getObjectByName(name), name).toBeDefined();
    }
  });

  it('is decorated: paintings, a clock, plants, windows and lamps over the tables', () => {
    const count = (name: string) =>
      room.group.children.filter((child) => child.name === name).length;
    expect(count('plant')).toBeGreaterThanOrEqual(4);
    expect(count('window')).toBeGreaterThanOrEqual(3);
    expect(count('pendant-lamp')).toBe(TABLES.length + 3); // one over each table, three over the counter
    for (const name of ['painting-1', 'painting-2', 'painting-3', 'diploma', 'clock'])
      expect(named(name), name).toBeDefined();
  });

  it('hands back the parts that change with the world, standing where they belong', () => {
    expect(named('pot')).toBe(room.pot);
    expect(room.shelfBoxes.position.x).toBe(FURNITURE.shelf.x);
    expect(room.reportPapers.position.z).toBeCloseTo(FURNITURE.bossDesk.z, 0);
    expect(room.dishes.position.x).toBeLessThan(KITCHEN.xMin + 0.5); // at the hatch of the kitchen wall
    expect(room.dishes.position.y).toBeGreaterThan(1); // on the sill
    for (const group of [room.shelfBoxes, room.reportPapers, room.dishes])
      expect(group.children).toHaveLength(0);
  });

  it('keeps the office and the kitchen inside the room', () => {
    expect(OFFICE.xMin).toBeGreaterThanOrEqual(ROOM.xMin);
    expect(OFFICE.zMax).toBeLessThanOrEqual(ROOM.zMax);
    expect(KITCHEN.xMax).toBeLessThanOrEqual(ROOM.xMax);
    expect(KITCHEN.zMin).toBeGreaterThanOrEqual(ROOM.zMin);
  });

  it('keeps everything inside a box around the room, with no broken numbers', () => {
    room.group.updateMatrixWorld(true);
    room.group.traverse((object) => {
      const { x, y, z } = object.position;
      expect(Number.isFinite(x + y + z), object.name).toBe(true);
      expect(Math.abs(x)).toBeLessThan(12);
      expect(z).toBeGreaterThan(-6.5);
      expect(z).toBeLessThan(8.5);
      expect(y).toBeGreaterThanOrEqual(-0.5); // the slab under the floor
      expect(y).toBeLessThan(6);
    });
  });

  it('is built fresh each time, so two rooms do not share their parts', () => {
    expect(buildRoom().pot).not.toBe(room.pot);
  });
});
