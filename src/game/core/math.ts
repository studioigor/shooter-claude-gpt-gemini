export function rgbToABGR(r: number, g: number, b: number): number {
  return (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function distSq(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

export function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function hash2d(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return (h ^ (h >> 16)) & 255;
}

export function planeFromFov(fovDegrees: number): number {
  return Math.tan((fovDegrees * Math.PI) / 360);
}

export function pointInZone(x: number, y: number, zone: { x: number; y: number; w: number; h: number }): boolean {
  return x >= zone.x && y >= zone.y && x <= zone.x + zone.w && y <= zone.y + zone.h;
}
