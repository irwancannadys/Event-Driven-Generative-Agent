import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { BASE_FOV, CAMERA_TARGET, cameraPosition } from './camera';
import { projectToScreen } from './projection';

function camera(azimuth = 0): PerspectiveCamera {
  const view = new PerspectiveCamera(BASE_FOV, 2, 0.1, 100);
  const at = cameraPosition(azimuth);
  view.position.set(at.x, at.y, at.z);
  view.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);
  return view;
}

describe('projectToScreen', () => {
  it('puts the point the camera looks at in the middle of the screen', () => {
    const at = projectToScreen(camera(), CAMERA_TARGET, 800, 400);
    expect(at.visible).toBe(true);
    expect(at.x).toBeCloseTo(400, 0);
    expect(at.y).toBeCloseTo(200, 0);
  });

  it('puts what is to the right of the room on the right of the screen, and what is higher higher', () => {
    const view = camera();
    const centre = projectToScreen(view, { x: 0, y: 1, z: 0 }, 800, 400);
    const right = projectToScreen(view, { x: 5, y: 1, z: 0 }, 800, 400);
    const higher = projectToScreen(view, { x: 0, y: 3, z: 0 }, 800, 400);
    expect(right.x).toBeGreaterThan(centre.x);
    expect(higher.y).toBeLessThan(centre.y); // screen y grows downwards
  });

  it('knows a point behind the camera is not to be shown', () => {
    const view = camera();
    const behind = projectToScreen(view, { x: 0, y: 8, z: 40 }, 800, 400);
    expect(behind.visible).toBe(false);
  });
});
