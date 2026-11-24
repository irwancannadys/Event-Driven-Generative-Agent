import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import type { StockLevel } from '@cafe/core';

// The stock shelf shows the real stock (brief section 11): every ingredient has a place on one of the
// two boards, and the number of boxes there says how full its stock is. The same goes for the papers
// of the reports on the boss desk. The plans are plain data (tested), `ShelfView` and `PapersView` only
// put them in the scene.

/** The most boxes an ingredient can have: two side by side, two high. */
export const MAX_BOXES = 4;
/** Ingredients per board. */
const SLOTS_PER_BOARD = 4;
const SLOT_SPACING = 0.7;
const BOX = { width: 0.4, height: 0.35, depth: 0.4 };
const BOARD_TOPS = [1.05, 2.05]; // the two boards of the room are at 1 and 2, 0.1 thick
const COLORS = { ok: 0xba7517, low: 0xe0602a, paper: 0xffffff };

export interface BoxPlacement {
  ingredient: string;
  x: number;
  y: number;
  z: number;
  low: boolean;
}

/** How many boxes the stock of one ingredient gets: none when it is gone, at least one while it is not. */
export function boxCount(qty: number, capacity: number): number {
  if (qty <= 0 || capacity <= 0) return 0;
  return Math.max(1, Math.min(MAX_BOXES, Math.ceil((qty / capacity) * MAX_BOXES)));
}

/**
 * Where every box goes, relative to the shelf. Ingredients keep a fixed place (they are put in order of
 * their id), four on the lower board and four on the upper one, along the length of the board.
 */
export function shelfPlacements(stock: StockLevel[]): BoxPlacement[] {
  const ordered = [...stock].sort((a, b) => a.ingredient_id.localeCompare(b.ingredient_id));
  const placements: BoxPlacement[] = [];
  for (const [index, row] of ordered.entries()) {
    const board = Math.floor(index / SLOTS_PER_BOARD);
    const slot = index % SLOTS_PER_BOARD;
    const z = (slot - (SLOTS_PER_BOARD - 1) / 2) * SLOT_SPACING;
    const top = BOARD_TOPS[board] ?? (BOARD_TOPS.at(-1) as number);
    for (let box = 0; box < boxCount(row.qty, row.capacity_qty); box += 1) {
      placements.push({
        ingredient: row.ingredient_id,
        x: box % 2 === 0 ? -0.22 : 0.22,
        y: top + BOX.height / 2 + Math.floor(box / 2) * (BOX.height + 0.02),
        z,
        low: row.low || row.out,
      });
    }
  }
  return placements;
}

/** Keeps the boxes in `group` equal to the stock, and only touches the scene when the stock changed. */
export class ShelfView {
  private readonly geometry = new BoxGeometry(BOX.width, BOX.height, BOX.depth);
  private readonly materials = {
    ok: new MeshLambertMaterial({ color: COLORS.ok }),
    low: new MeshLambertMaterial({ color: COLORS.low }),
  };
  private last = '';

  constructor(private readonly group: Group) {}

  update(stock: StockLevel[]): void {
    const placements = shelfPlacements(stock);
    const key = JSON.stringify(placements);
    if (key === this.last) return;
    this.last = key;
    this.group.clear();
    for (const placement of placements) {
      const mesh = new Mesh(this.geometry, placement.low ? this.materials.low : this.materials.ok);
      mesh.name = `box-${placement.ingredient}`;
      mesh.position.set(placement.x, placement.y, placement.z);
      this.group.add(mesh);
    }
  }
}

/** The most papers drawn on the boss desk, however many reports wait. */
export const MAX_PAPERS = 4;

export function paperCount(waitingReports: number): number {
  return Math.max(0, Math.min(MAX_PAPERS, waitingReports));
}

/** A paper for every report that waits on the boss desk, up to four. */
export class PapersView {
  private readonly geometry = new BoxGeometry(0.7, 0.05, 0.5);
  private readonly material = new MeshLambertMaterial({ color: COLORS.paper });
  private shown = -1;

  constructor(private readonly group: Group) {}

  update(waitingReports: number): void {
    const count = paperCount(waitingReports);
    if (count === this.shown) return;
    this.shown = count;
    this.group.clear();
    for (let index = 0; index < count; index += 1) {
      const paper = new Mesh(this.geometry, this.material);
      paper.name = 'paper';
      paper.position.set(0, 0.95 + index * 0.06, 0);
      this.group.add(paper);
    }
  }
}
