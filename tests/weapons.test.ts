import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../src/game/data/weapons';

describe('weapon roles', () => {
  it('keeps pistol as the most accurate fallback', () => {
    expect(WEAPONS.pistol.spread).toBeLessThan(WEAPONS.machinegun.spread);
    expect(WEAPONS.pistol.spread).toBeLessThan(WEAPONS.shotgun.spread);
  });

  it('keeps shotgun as the strongest close-range burst option', () => {
    const shotgunBurst = WEAPONS.shotgun.damage * WEAPONS.shotgun.pellets;
    const rifleBurst = WEAPONS.machinegun.damage * WEAPONS.machinegun.pellets;
    expect(shotgunBurst).toBeGreaterThan(rifleBurst);
    expect(WEAPONS.shotgun.magSize).toBeLessThan(WEAPONS.machinegun.magSize);
  });

  it('keeps plasma as the splash weapon', () => {
    expect(WEAPONS.plasma.projectile).toBe(true);
    expect(WEAPONS.plasma.splashRadius).toBeGreaterThan(1);
    expect(WEAPONS.plasma.ammoPerShot).toBeGreaterThan(WEAPONS.pistol.ammoPerShot);
  });
});
