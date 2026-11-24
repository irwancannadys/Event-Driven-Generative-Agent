import { describe, expect, it } from 'vitest';
import {
  AZIMUTH_LIMIT,
  CAMERA_HEIGHT,
  CAMERA_RADIUS,
  cameraPosition,
  clampAzimuth,
  dragAzimuth,
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
    expect(dragAzimuth(0, 100)).toBeCloseTo(-0.5);
    expect(dragAzimuth(0, -40)).toBeCloseTo(0.2);
    expect(dragAzimuth(0.4, -1000)).toBe(AZIMUTH_LIMIT);
  });
});
