import { Vector3, type Camera } from 'three';

/**
 * Where a point of the room lands on the screen, for the labels above characters and stations.
 * `visible` is false for a point behind the camera.
 */
export function projectToScreen(
  camera: Camera,
  point: { x: number; y: number; z: number },
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  camera.updateMatrixWorld();
  const projected = new Vector3(point.x, point.y, point.z).project(camera);
  return {
    x: ((projected.x + 1) / 2) * width,
    y: ((1 - projected.y) / 2) * height,
    visible: projected.z < 1,
  };
}
