// The camera of the room: from above and the front, turned a little left or right by dragging. The maths
// is kept apart from Three.js and from the DOM so that it can be tested.

// The camera looks at the room from above and the front. Its distance and field of view were found by
// trying many settings against the places that must stay in the picture (the stations, the door, the
// pick-up spot); a test checks the framing at the sizes the page gives the picture.
/** The vertical field of view on a picture of the shape of a video (16:9) or wider, in degrees. */
export const BASE_FOV = 36;
export const CAMERA_RADIUS = 22;
export const CAMERA_HEIGHT = 18;
/** The camera looks at this point of the room. */
export const CAMERA_TARGET = { x: 0, y: 0.6, z: 1.5 } as const;
/** How far the camera may swing to either side, in radians. */
export const AZIMUTH_LIMIT = 0.3;
export const AZIMUTH_START = 0.15;
/** Radians of swing per pixel of dragging. */
export const DRAG_SPEED = 0.005;

/** Below this aspect ratio the picture is made taller, so that the room keeps its width. */
const WIDE_ASPECT = 16 / 9;
const MAX_FOV = 75;

/**
 * The vertical field of view for a picture of this shape. On a wide picture it is the base one; on a
 * narrower one (a smaller window, a phone) it grows, so that the same width of the room stays in view
 * instead of the sides being cut off.
 */
export function fovForAspect(aspect: number): number {
  if (aspect >= WIDE_ASPECT) return BASE_FOV;
  const half = Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) * (WIDE_ASPECT / aspect));
  return Math.min(MAX_FOV, (half * 360) / Math.PI);
}

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
