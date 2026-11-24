import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { AGENT_IDS, AGENT_NAME_ID, type AgentId } from '@cafe/core';
import { t } from '../i18n';
import { agentActivity } from '../state/agent-text';
import { virtualNow, type WorldState } from '../state/world';
import {
  AZIMUTH_START,
  BASE_FOV,
  ELEVATION_START,
  CAMERA_TARGET,
  cameraPosition,
  dragAzimuth,
  dragElevation,
  fovForAspect,
} from './camera';
import { createAvatar, type Avatar } from './avatar';
import { buildStage, lightTheScene } from './environment';
import { LabelLayer } from './labels';
import { agentPose, potTilt } from './pose';
import { visibleCustomers, dishesOnCounter } from './customer';
import { DishesView, PapersView, ShelfView } from './shelf';
import { projectToScreen } from './projection';
import { BOSS_SPOT, WAITING_SPOTS } from './registry';
import { buildRoom } from './room';

// The 3D picture of the cafe (decisions 027 and 028). It only reads the state of the world and draws it:
// every frame the picture is worked out from the state and the virtual time, nothing is remembered between
// frames except the camera angle that the boss chose by dragging.

export interface SceneHandle {
  dispose(): void;
}

/** Builds the scene inside `container` and starts drawing. Throws when the browser has no WebGL. */
export function createScene(
  container: HTMLElement,
  getState: () => WorldState | undefined,
): SceneHandle {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.append(renderer.domElement);

  const scene = new Scene();
  lightTheScene(renderer, scene);
  scene.add(buildStage());

  const room = buildRoom();
  scene.add(room.group);

  // The four characters (hidden until the first snapshot says where they are) and the boss at his desk.
  const avatars = new Map<AgentId, Avatar>();
  for (const id of AGENT_IDS) {
    const avatar = createAvatar(id);
    avatar.object.visible = false;
    scene.add(avatar.object);
    avatars.set(id, avatar);
  }
  const boss = createAvatar('boss');
  boss.object.position.set(BOSS_SPOT.x, 0, BOSS_SPOT.z);
  boss.object.rotation.y = BOSS_SPOT.facing;
  scene.add(boss.object);

  const shelf = new ShelfView(room.shelfBoxes);
  const papers = new PapersView(room.reportPapers);
  const dishes = new DishesView(room.dishes);
  const customerViews = new Map<number, Avatar>();

  const camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 100);
  let azimuth = AZIMUTH_START;
  let elevation = ELEVATION_START;
  const aim = (): void => {
    const position = cameraPosition(azimuth, elevation);
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);
  };
  aim();

  const labels = new LabelLayer(container, 'scene-label');
  labels.set('boss', t('scene.boss'), 'boss');

  let width = 1;
  let height = 1;
  const resize = (): void => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.fov = fovForAspect(camera.aspect);
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  // Dragging swings the camera a little to either side.
  let dragFrom: { x: number; y: number } | undefined;
  const onDown = (event: PointerEvent): void => {
    dragFrom = { x: event.clientX, y: event.clientY };
    container.classList.add('dragging');
  };
  const onMove = (event: PointerEvent): void => {
    if (dragFrom === undefined) return;
    azimuth = dragAzimuth(azimuth, event.clientX - dragFrom.x);
    elevation = dragElevation(elevation, event.clientY - dragFrom.y);
    dragFrom = { x: event.clientX, y: event.clientY };
    aim();
  };
  const onUp = (): void => {
    dragFrom = undefined;
    container.classList.remove('dragging');
  };
  container.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  // The browser may take the WebGL context away (a sleeping GPU, too many tabs): stop drawing and say so,
  // and carry on when it is given back.
  let frame = 0;
  const canvas = renderer.domElement;
  const onContextLost = (event: Event): void => {
    event.preventDefault();
    cancelAnimationFrame(frame);
    labels.set('lost', t('scene.lost'), 'lost');
    labels.place('lost', width / 2, height / 2, true);
  };
  const onContextRestored = (): void => {
    labels.place('lost', 0, 0, false);
    draw();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  const draw = (): void => {
    frame = requestAnimationFrame(draw);
    const nowMs = performance.now();
    const seconds = nowMs / 1000;
    const state = getState();
    if (state) {
      const now = virtualNow(state.clock, nowMs);
      for (const id of AGENT_IDS) {
        const agent = state.agents[id];
        const avatar = avatars.get(id);
        if (!agent || !avatar) continue;
        const pose = agentPose(agent, now);
        avatar.object.visible = true;
        avatar.object.position.set(pose.x, 0, pose.z);
        avatar.object.rotation.y = pose.facing;
        avatar.play(pose.status, seconds, pose.walked);
        labels.set(
          `agent:${id}`,
          `${AGENT_NAME_ID[id]} · ${agentActivity(agent)}`,
          `agent agent-${id}`,
        );
        const at = projectToScreen(camera, { x: pose.x, y: 2.3, z: pose.z }, width, height);
        labels.place(`agent:${id}`, at.x, at.y, at.visible);
      }
      shelf.update(Object.values(state.stock));
      papers.update(state.reports.filter((report) => report.status === 'submitted').length);
      // The customers (the ones on their way to the cashier too): as many as there are places, the rest counted
      const { shown, hidden } = visibleCustomers(state.customers, state.arrivals, now);
      const present = new Set(shown.map((entry) => entry.key));
      for (const [id, view] of customerViews) {
        if (present.has(id)) continue;
        scene.remove(view.object);
        labels.remove(`customer:${id}`);
        customerViews.delete(id);
      }
      for (const { key: id, pose } of shown) {
        let view = customerViews.get(id);
        if (!view) {
          view = createAvatar('customer', id);
          customerViews.set(id, view);
          scene.add(view.object);
        }
        view.object.position.set(pose.x, 0, pose.z);
        view.object.rotation.y = pose.facing;
        view.play(pose.moving ? 'walking' : 'idle', seconds, pose.walked);
        view.sit(pose.seated);
        view.carry(pose.carrying);
        const key = `customer:${id}`;
        if (pose.bubble) {
          labels.set(key, t(`customer.${pose.bubble}`), `bubble bubble-${pose.bubble}`);
          const at = projectToScreen(camera, { x: pose.x, y: 2.2, z: pose.z }, width, height);
          labels.place(key, at.x, at.y, at.visible);
        } else {
          labels.hide(key);
        }
      }
      dishes.update(dishesOnCounter(state.customers, now));
      if (hidden > 0) {
        labels.set('queue-more', `+${hidden} ${t('customer.queueMore')}`, 'queue-more');
        const spot = WAITING_SPOTS[15] as { x: number; z: number };
        const at = projectToScreen(camera, { x: spot.x, y: 1.4, z: spot.z }, width, height);
        labels.place('queue-more', at.x, at.y, at.visible);
      } else {
        labels.hide('queue-more');
      }
      const cook = state.agents.cook;
      room.pot.rotation.z = potTilt(cook?.state === 'working' && cook.label === 'cooking', seconds);
    }
    const bossAt = projectToScreen(
      camera,
      { x: BOSS_SPOT.x, y: 2.3, z: BOSS_SPOT.z },
      width,
      height,
    );
    labels.place('boss', bossAt.x, bossAt.y, bossAt.visible);
    renderer.render(scene, camera);
  };
  draw();

  return {
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      container.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      labels.clear();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
