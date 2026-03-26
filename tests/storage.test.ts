import { beforeEach, describe, expect, it } from 'vitest';
import { loadCheckpoint, loadSettings, saveCheckpoint, saveSettings } from '../src/game/save/storage';
import type { SaveState } from '../src/game/core/types';

function createLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

describe('storage', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: createLocalStorage() },
      configurable: true,
      writable: true,
    });
  });

  it('loads default settings when storage is empty', () => {
    const settings = loadSettings();
    expect(settings.fov).toBeGreaterThan(60);
    expect(settings.mouseSensitivity).toBeGreaterThan(0);
  });

  it('round-trips settings and checkpoints', () => {
    saveSettings({
      version: 1,
      mouseSensitivity: 1.25,
      fov: 82,
      masterVolume: 0.9,
      musicVolume: 0.4,
      sfxVolume: 0.7,
      screenShake: 1,
      showCrosshair: true,
      showFps: false,
    });
    expect(loadSettings().fov).toBe(82);

    const saveState: SaveState = {
      version: 1,
      savedAt: Date.now(),
      actIndex: 2,
      checkpointId: 'a3-mid',
      currentObjectiveId: 'a3-exit',
      player: {
        x: 1,
        y: 2,
        angle: 0,
        health: 90,
        armor: 20,
        stamina: 50,
        weapon: 'machinegun',
        ammo: { pistol: 10, shotgun: 4, machinegun: 40, plasma: 0 },
        totalAmmo: { pistol: 30, shotgun: 8, machinegun: 90, plasma: 0 },
        hasWeapon: { pistol: true, shotgun: true, machinegun: true, plasma: false },
        keys: { red: true, blue: true, yellow: false },
        dashCooldown: 0,
        meleeCooldown: 0,
      },
      enemies: [],
      pickups: [],
      barrels: [],
      generators: [],
      doors: [],
      firedTriggers: ['a3-lattice-clear'],
      extractionUnlocked: true,
      bossPhase: 0,
      escapeTimeLeft: null,
      stats: {
        elapsedTime: 120,
        shotsFired: 50,
        shotsHit: 20,
        kills: 12,
        deaths: 1,
      },
    };
    saveCheckpoint(saveState);
    expect(loadCheckpoint()).toMatchObject({
      actIndex: 2,
      checkpointId: 'a3-mid',
      currentObjectiveId: 'a3-exit',
    });
  });
});
