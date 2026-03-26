import type { SettingsState } from './types';

export const SCREEN_W = 640;
export const SCREEN_H = 480;
export const TEX_SIZE = 128;
export const TEX_MASK = TEX_SIZE - 1;
export const MAX_VIEW_DIST = 22;
export const COLLISION_R = 0.25;
export const PICKUP_RADIUS = 0.6;
export const BARREL_RADIUS = 0.36;
export const BARREL_HEALTH = 40;
export const BARREL_DAMAGE = 110;
export const BARREL_DAMAGE_RADIUS = 2.9;
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 28;
export const STAMINA_RECOVER = 24;
export const BASE_MOVE_SPEED = 5.6;
export const SPRINT_MULT = 1.35;
export const DASH_COOLDOWN = 1.35;
export const MELEE_COOLDOWN = 0.55;
export const SAVE_VERSION = 1;
export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: SettingsState = {
  version: SETTINGS_VERSION,
  mouseSensitivity: 1,
  fov: 74,
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.8,
  screenShake: 0.9,
  brightness: 1,
  showCrosshair: true,
  showFps: true,
};
