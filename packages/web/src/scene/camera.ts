// The camera of the room: from above and the front, turned a little left or right by dragging. The maths
// is kept apart from Three.js and from the DOM so that it can be tested.

// Wider and further than the prototype (40 degrees, radius 13, height 8) so that the whole room is in the
// picture also at the widest swing and at the sizes of this page; a test checks the framing.
export const CAMERA_FOV = 42;
export const CAMERA_RADIUS = 15;
export const CAMERA_HEIGHT = 8.5;
/** The camera looks at this point of the room. */
export const CAMERA_TARGET = { x: 0, y: 0.6, z: 1 } as const;
/** How far the camera may swing to either side, in radians. */
export const AZIMUTH_LIMIT = 0.5;
export const AZIMUTH_START = 0.15;
/** Radians of swing per pixel of dragging. */
export const DRAG_SPEED = 0.005;

export function clampAzimuth(azimuth: number): number {
  return Math.max(-AZIMUTH_LIMIT, Math.min(AZIMUTH_LIMIT, azimuth));
}

export function cameraPosition(azimuth: number): { x: number; y: number; z: number } {
  const clamped = clampAzimuth(azimuth);
  return {
    x: CAMERA_RADIUS * Math.sin(clamped),
    y: CAMERA_HEIGHT,
    z: CAMERA_RADIUS * Math.cos(clamped),
  };
}

/** Dragging to the right swings the room to the right, as if it is grabbed. */
export function dragAzimuth(azimuth: number, dxPixels: number): number {
  return clampAzimuth(azimuth - dxPixels * DRAG_SPEED);
}
