import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { agent, snapshot } from '../state/test-fixtures';
import { applySnapshot, type WorldState } from '../state/world';
import { FakeNode, installFakeDom } from '../panels/fake-dom';
import { AZIMUTH_LIMIT, CAMERA_FOV, CAMERA_TARGET, cameraPosition } from './camera';
import { createScene } from './index';
import { projectToScreen } from './projection';
import { FURNITURE, STATION_SPOTS, standingPoint } from './registry';

// The real renderer needs WebGL, so a stand-in takes its place; everything else (the room, the
// characters, the labels, the loop) runs for real.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  const { FakeNode: Fake } = await import('../panels/fake-dom');
  class FakeRenderer {
    domElement = new Fake('canvas');
    rendered = 0;
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {
      this.rendered += 1;
    }
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

let frames: ((time: number) => void)[] = [];
let cancelled: number[] = [];
const windowListeners = new Map<string, unknown>();

beforeEach(() => {
  installFakeDom();
  frames = [];
  cancelled = [];
  windowListeners.clear();
  vi.stubGlobal('window', {
    devicePixelRatio: 2,
    addEventListener: (type: string, listener: unknown) => windowListeners.set(type, listener),
    removeEventListener: (type: string) => windowListeners.delete(type),
  });
  vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) =>
    frames.push(callback),
  );
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => cancelled.push(handle));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const world = (): WorldState =>
  applySnapshot(
    snapshot({
      agents: [
        agent('cashier', 'cashier'),
        {
          ...agent('cook', 'kitchen'),
          state: 'working',
          task: {
            id: 1,
            kind: 'work',
            label: 'cooking',
            station: null,
            started_at_sim: 29_000,
            ends_at_sim: 30_500,
          },
        },
        {
          ...agent('stock_admin', 'boss_desk'),
          state: 'walking',
          from_station: 'stock_shelf',
          task: {
            id: 2,
            kind: 'goto',
            label: null,
            station: 'boss_desk',
            started_at_sim: 29_900,
            ends_at_sim: 30_150,
          },
        },
        agent('waiter', 'table_2'),
      ],
    }),
    performance.now(),
  );

const container = () => new FakeNode('section');
const frame = () => frames.at(-1)?.(0);
const labelTexts = (root: FakeNode) =>
  root.findAll((node) => node.className.includes('scene-label')).map((node) => node.textContent);

describe('createScene', () => {
  it('draws on its own and labels the stations and the boss from the start', () => {
    const slot = container();
    createScene(slot as unknown as HTMLElement, () => undefined);
    frame();
    const texts = labelTexts(slot);
    for (const text of [
      'Kasir',
      'Dapur',
      'Rak Stok',
      'Meja Bos',
      'Meja 1',
      'Meja 2',
      'Meja 3',
      'Bos (kamu)',
    ]) {
      expect(texts, text).toContain(text);
    }
    expect(texts.some((text) => text.includes('·'))).toBe(false); // no characters before the first snapshot
  });

  it('labels each character with the name and what they are doing, once it has the world', () => {
    const slot = container();
    createScene(slot as unknown as HTMLElement, () => world());
    frame();
    const texts = labelTexts(slot);
    expect(texts).toContain('Kasir · menganggur');
    expect(texts).toContain('Koki · bekerja: memasak');
    expect(texts).toContain('Admin Stok · berjalan ke Meja Bos');
    expect(texts).toContain('Rina (pelayan) · menganggur');
  });

  it('places every label at a real spot on the screen, and keeps going frame after frame', () => {
    const slot = container();
    createScene(slot as unknown as HTMLElement, () => world());
    for (let index = 0; index < 5; index += 1) frame();
    for (const label of slot.findAll((node) => node.className.includes('scene-label'))) {
      expect(Number.isFinite(parseFloat(label.style.left ?? 'x')), label.textContent).toBe(true);
      expect(Number.isFinite(parseFloat(label.style.top ?? 'x')), label.textContent).toBe(true);
    }
    expect(frames.length).toBeGreaterThanOrEqual(6); // each frame asks for the next one
  });

  it('stops drawing and takes its own parts away when it is disposed', () => {
    const slot = container();
    const scene = createScene(slot as unknown as HTMLElement, () => world());
    frame();
    expect(windowListeners.has('pointermove')).toBe(true);
    scene.dispose();
    expect(cancelled).toHaveLength(1);
    expect(windowListeners.size).toBe(0);
    expect(labelTexts(slot).filter((text) => text !== '')).toHaveLength(0);
  });
});

describe('framing', () => {
  // The room must fit the picture at the sizes the page gives it (aspect ratio 2 to 3), also with the
  // camera swung to either side: every place a character stands, and every piece of furniture.
  const points = [
    ...Object.values(STATION_SPOTS).map((spot) => ({ x: spot.x, y: 1.9, z: spot.z })), // heads
    ...Object.values(STATION_SPOTS).map((spot) => ({ x: spot.x, y: 0, z: spot.z })), // feet
    standingPoint('boss_desk', 'cashier'),
    standingPoint('boss_desk', 'waiter'),
    { x: FURNITURE.shelf.x, y: 2.7, z: FURNITURE.shelf.z },
    { x: FURNITURE.cashierDesk.x - 1.5, y: 0.5, z: FURNITURE.cashierDesk.z },
    { x: -9, y: 0, z: 0.5 },
  ].map((point) => ({ x: point.x, y: 'y' in point ? point.y : 0, z: point.z }));

  it.each([2, 2.6, 3])(
    'keeps everybody and everything inside the picture at aspect %s',
    (aspect) => {
      for (const azimuth of [-AZIMUTH_LIMIT, 0, 0.15, AZIMUTH_LIMIT]) {
        const camera = new PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 100);
        const at = cameraPosition(azimuth);
        camera.position.set(at.x, at.y, at.z);
        camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);
        for (const point of points) {
          const screen = projectToScreen(camera, point, 1000, 1000 / aspect);
          const where = `${JSON.stringify(point)} azimuth ${azimuth}: ${Math.round(screen.x)},${Math.round(screen.y)}`;
          expect(screen.visible, where).toBe(true);
          expect(screen.x, where).toBeGreaterThan(0);
          expect(screen.x, where).toBeLessThan(1000);
          expect(screen.y, where).toBeGreaterThan(0);
          expect(screen.y, where).toBeLessThan(1000 / aspect);
        }
      }
    },
  );
});
