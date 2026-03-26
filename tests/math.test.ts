import { describe, expect, it } from 'vitest';
import { clamp, formatTime, normalizeAngle, planeFromFov, pointInZone } from '../src/game/core/math';

describe('math helpers', () => {
  it('clamps values into range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('normalizes angles around PI', () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI);
  });

  it('formats time as mm:ss', () => {
    expect(formatTime(5)).toBe('00:05');
    expect(formatTime(125)).toBe('02:05');
  });

  it('builds a valid projection plane from FOV', () => {
    expect(planeFromFov(60)).toBeLessThan(planeFromFov(90));
  });

  it('checks points inside zones', () => {
    expect(pointInZone(4, 4, { x: 3, y: 3, w: 2, h: 2 })).toBe(true);
    expect(pointInZone(6.2, 4, { x: 3, y: 3, w: 2, h: 2 })).toBe(false);
  });
});
