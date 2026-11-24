import { describe, expect, it } from 'vitest';
import { FURNITURE } from './registry';
import { buildRoom } from './room';

// The picture itself needs a browser, but the room can be built without one: the objects and where they
// stand are plain data.
describe('buildRoom', () => {
  const room = buildRoom();

  it('has the floor, the wall, the desks, the stove, the shelf and three tables', () => {
    for (const name of [
      'floor',
      'wall',
      'cashier-desk',
      'till',
      'kitchen-counter',
      'stove',
      'pot',
      'boss-desk',
      'shelf-board-1',
      'shelf-board-2',
      'table-1-top',
      'table-2-top',
      'table-3-top',
    ]) {
      expect(room.group.getObjectByName(name), name).toBeDefined();
    }
  });

  it('hands back the parts that change with the world, standing where the furniture is', () => {
    expect(room.group.getObjectByName('pot')).toBe(room.pot);
    expect(room.shelfBoxes.position.x).toBe(FURNITURE.shelf.x);
    expect(room.shelfBoxes.position.z).toBe(FURNITURE.shelf.z);
    expect(room.reportPapers.position.x).toBe(FURNITURE.bossDesk.x);
    expect(room.shelfBoxes.children).toHaveLength(0);
    expect(room.reportPapers.children).toHaveLength(0);
    expect(room.dishes.children).toHaveLength(0);
    expect(room.dishes.position.x).toBeLessThan(FURNITURE.kitchen.x); // the near end of the counter
    expect(room.dishes.position.y).toBe(1); // on the counter top
  });

  it('keeps everything inside a box around the room, with no broken numbers', () => {
    room.group.updateMatrixWorld(true);
    room.group.traverse((object) => {
      const { x, y, z } = object.position;
      expect(Number.isFinite(x + y + z), object.name).toBe(true);
      expect(Math.abs(x)).toBeLessThan(10);
      expect(Math.abs(z)).toBeLessThan(6);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(5);
    });
  });

  it('is built fresh each time, so two rooms do not share their parts', () => {
    expect(buildRoom().pot).not.toBe(room.pot);
  });
});
