import { describe, expect, it } from 'vitest';
import {
  AZIMUTH_LIMIT,
  BASE_FOV,
  CAMERA_HEIGHT,
  CAMERA_RADIUS,
  cameraPosition,
  clampAzimuth,
  dragAzimuth,
  fovForAspect,
} from './camera';

describe('camera', () => {
  it('stands in front of the room, above it, at the radius from the target', () => {
    expect(cameraPosition(0)).toEqual({ x: 0, y: CAMERA_HEIGHT, z: CAMERA_RADIUS });
    const swung = cameraPosition(0.3);
    expect(swung.x).toBeCloseTo(CAMERA_RADIUS * Math.sin(0.3));
    expect(Math.hypot(swung.x, swung.z)).toBeCloseTo(CAMERA_RADIUS);
  });

  it('may swing only a little to either side', () => {
    expect(clampAzimuth(2)).toBe(AZIMUTH_LIMIT);
    expect(clampAzimuth(-2)).toBe(-AZIMUTH_LIMIT);
    expect(clampAzimuth(0.2)).toBe(0.2);
    expect(cameraPosition(9)).toEqual(cameraPosition(AZIMUTH_LIMIT));
  });

  it('swings the room along with the hand, and stops at the limit', () => {
    expect(dragAzimuth(0, 60)).toBeCloseTo(-0.3);
    expect(dragAzimuth(0, -40)).toBeCloseTo(0.2);
    expect(dragAzimuth(0, 1000)).toBe(-AZIMUTH_LIMIT);
    expect(dragAzimuth(0.3, -1000)).toBe(AZIMUTH_LIMIT);
  });
});

describe('fovForAspect', () => {
  it('is the base field of view on a wide picture', () => {
    expect([2, 2.4, 3].map(fovForAspect)).toEqual([BASE_FOV, BASE_FOV, BASE_FOV]);
  });

  it('grows as the picture gets narrower, so the room keeps its width', () => {
    const at = (aspect: number) => fovForAspect(aspect);
    expect(at(1.78)).toBeGreaterThan(BASE_FOV);
    expect(at(1.5)).toBeGreaterThan(at(1.78));
    // the horizontal view is the same as on a picture of aspect 2
    const horizontal = (aspect: number) => Math.tan((at(aspect) * Math.PI) / 360) * aspect;
    expect(horizontal(1.5)).toBeCloseTo(horizontal(2));
    expect(horizontal(1.78)).toBeCloseTo(horizontal(2));
  });

  it('never goes past a wide-angle that would bend the room', () => {
    expect(fovForAspect(0.3)).toBeLessThanOrEqual(75);
  });
});
