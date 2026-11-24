import { describe, expect, it } from 'vitest';
import {
  AZIMUTH_LIMIT,
  BASE_FOV,
  CAMERA_DISTANCE,
  ELEVATION_MAX,
  ELEVATION_MIN,
  ELEVATION_START,
  cameraPosition,
  clampAzimuth,
  clampElevation,
  dragAzimuth,
  dragElevation,
  fovForAspect,
} from './camera';

describe('camera', () => {
  it('stands in front of the room and above it, at the same distance from the middle at every angle', () => {
    const start = cameraPosition(0);
    expect(start.x).toBeCloseTo(0);
    expect(start.y).toBeCloseTo(18); // the angle the page starts with
    expect(start.z).toBeCloseTo(22);
    for (const [swing, lift] of [
      [0.3, ELEVATION_START],
      [-0.2, ELEVATION_MIN],
      [0.1, ELEVATION_MAX],
    ] as const) {
      const at = cameraPosition(swing, lift);
      expect(Math.hypot(at.x, at.y, at.z)).toBeCloseTo(CAMERA_DISTANCE);
    }
  });

  it('may swing only a little to either side', () => {
    expect(clampAzimuth(2)).toBe(AZIMUTH_LIMIT);
    expect(clampAzimuth(-2)).toBe(-AZIMUTH_LIMIT);
    expect(clampAzimuth(0.2)).toBe(0.2);
    expect(cameraPosition(9)).toEqual(cameraPosition(AZIMUTH_LIMIT));
  });

  it('may go from a low view of the room to almost straight above it, and no further', () => {
    expect(clampElevation(0)).toBe(ELEVATION_MIN);
    expect(clampElevation(3)).toBe(ELEVATION_MAX);
    expect(cameraPosition(0, ELEVATION_MAX).y).toBeGreaterThan(cameraPosition(0, ELEVATION_MIN).y);
    expect(cameraPosition(0, 9)).toEqual(cameraPosition(0, ELEVATION_MAX));
    expect(cameraPosition(0, ELEVATION_MIN).y).toBeGreaterThan(5); // never below the floor
  });

  it('swings the room along with the hand, and stops at the limit', () => {
    expect(dragAzimuth(0, 40)).toBeCloseTo(-0.2);
    expect(dragAzimuth(0, -30)).toBeCloseTo(0.15);
    expect(dragAzimuth(0, 1000)).toBe(-AZIMUTH_LIMIT);
    expect(dragAzimuth(0.3, -1000)).toBe(AZIMUTH_LIMIT);
  });

  it('lifts the camera when dragged down and lowers it when dragged up, up to the limits', () => {
    expect(dragElevation(ELEVATION_START, 40)).toBeCloseTo(ELEVATION_START + 0.2);
    expect(dragElevation(ELEVATION_START, -40)).toBeCloseTo(ELEVATION_START - 0.2);
    expect(dragElevation(ELEVATION_START, 5000)).toBe(ELEVATION_MAX);
    expect(dragElevation(ELEVATION_START, -5000)).toBe(ELEVATION_MIN);
  });
});

describe('fovForAspect', () => {
  it('is the base field of view on a wide picture', () => {
    expect([16 / 9, 2.4, 3].map(fovForAspect)).toEqual([BASE_FOV, BASE_FOV, BASE_FOV]);
  });

  it('grows as the picture gets narrower, so the room keeps its width', () => {
    const at = (aspect: number) => fovForAspect(aspect);
    expect(at(1.5)).toBeGreaterThan(BASE_FOV);
    expect(at(1.2)).toBeGreaterThan(at(1.5));
    // the horizontal view is the same as on a picture of the shape of a video
    const horizontal = (aspect: number) => Math.tan((at(aspect) * Math.PI) / 360) * aspect;
    expect(horizontal(1.5)).toBeCloseTo(horizontal(16 / 9));
    expect(horizontal(1.2)).toBeCloseTo(horizontal(16 / 9));
  });

  it('never goes past a wide-angle that would bend the room', () => {
    expect(fovForAspect(0.3)).toBeLessThanOrEqual(75);
  });
});
