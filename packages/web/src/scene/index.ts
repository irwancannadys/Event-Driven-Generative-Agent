import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { STATION_NAME_ID } from '@cafe/core';
import type { WorldState } from '../state/world';
import { AZIMUTH_START, CAMERA_FOV, CAMERA_TARGET, cameraPosition, dragAzimuth } from './camera';
import { LabelLayer } from './labels';
import { projectToScreen } from './projection';
import { FURNITURE } from './registry';
import { buildRoom } from './room';

// The 3D picture of the cafe (decisions 027 and 028). It only reads the state of the world and draws it:
// every frame the picture is worked out from the state and the virtual time, nothing is remembered between
// frames except the camera angle that the boss chose by dragging.

export interface SceneHandle {
  dispose(): void;
}

/** Labels above the furniture: (text, x, height, z). */
const STATION_LABELS: [string, number, number, number][] = [
  [STATION_NAME_ID.cashier, FURNITURE.cashierDesk.x, 2.1, FURNITURE.cashierDesk.z],
  [STATION_NAME_ID.kitchen, FURNITURE.kitchen.x, 2.1, FURNITURE.kitchen.z],
  [STATION_NAME_ID.stock_shelf, FURNITURE.shelf.x, 2.7, FURNITURE.shelf.z],
  [STATION_NAME_ID.boss_desk, FURNITURE.bossDesk.x, 1.5, FURNITURE.bossDesk.z + 0.4],
  ...FURNITURE.tables.map((table, index): [string, number, number, number] => [
    STATION_NAME_ID[`table_${index + 1}` as 'table_1'],
    table.x,
    1.4,
    table.z,
  ]),
];

/** Builds the scene inside `container` and starts drawing. Throws when the browser has no WebGL. */
export function createScene(
  container: HTMLElement,
  getState: () => WorldState | undefined,
): SceneHandle {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.append(renderer.domElement);

  const scene = new Scene();
  // Lights are physically based since three r155: the intensities of the prototype (0.8 and 0.6, made for
  // r128) are multiplied by pi to give the same brightness.
  scene.add(new AmbientLight(0xffffff, 0.8 * Math.PI));
  const sun = new DirectionalLight(0xffffff, 0.6 * Math.PI);
  sun.position.set(5, 12, 9);
  scene.add(sun);

  const room = buildRoom();
  scene.add(room.group);

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  let azimuth = AZIMUTH_START;
  const aim = (): void => {
    const position = cameraPosition(azimuth);
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);
  };
  aim();

  const labels = new LabelLayer(container, 'scene-label');
  for (const [text] of STATION_LABELS) labels.set(`station:${text}`, text, 'station');

  let width = 1;
  let height = 1;
  const resize = (): void => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  // Dragging swings the camera a little to either side.
  let dragFrom: number | undefined;
  const onDown = (event: PointerEvent): void => {
    dragFrom = event.clientX;
    container.classList.add('dragging');
  };
  const onMove = (event: PointerEvent): void => {
    if (dragFrom === undefined) return;
    azimuth = dragAzimuth(azimuth, event.clientX - dragFrom);
    dragFrom = event.clientX;
    aim();
  };
  const onUp = (): void => {
    dragFrom = undefined;
    container.classList.remove('dragging');
  };
  container.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  let frame = 0;
  const draw = (): void => {
    frame = requestAnimationFrame(draw);
    void getState(); // the characters and the shelf are drawn from this state in the next steps
    for (const [text, x, y, z] of STATION_LABELS) {
      const at = projectToScreen(camera, { x, y, z }, width, height);
      labels.place(`station:${text}`, at.x, at.y, at.visible);
    }
    renderer.render(scene, camera);
  };
  draw();

  return {
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      labels.clear();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
