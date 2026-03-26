import Phaser from 'phaser';
import { MusicManager } from '../audio/MusicManager';
import { SoundManager } from '../audio/SoundManager';
import {
  BARREL_DAMAGE,
  BARREL_DAMAGE_RADIUS,
  BARREL_HEALTH,
  BARREL_RADIUS,
  BASE_MOVE_SPEED,
  COLLISION_R,
  DASH_COOLDOWN,
  MAX_VIEW_DIST,
  MELEE_COOLDOWN,
  PICKUP_RADIUS,
  SCREEN_H,
  SCREEN_W,
  SPRINT_MULT,
  STAMINA_DRAIN,
  STAMINA_MAX,
  STAMINA_RECOVER,
  TEX_MASK,
  TEX_SIZE,
} from '../core/config';
import {
  clamp,
  distSq,
  formatTime,
  lerp,
  normalizeAngle,
  planeFromFov,
  pointInZone,
  rgbToABGR,
} from '../core/math';
import type { BootPayload, RuntimeHooks } from '../core/runtime';
import type {
  BarrelDefinition,
  DoorSaveState,
  EnemyArchetypeKey,
  EnemySaveState,
  GeneratorDefinition,
  GeneratorSaveState,
  HudSnapshot,
  LevelDefinition,
  PickupDefinition,
  PickupSaveState,
  PlayerSnapshot,
  PropDefinition,
  SaveState,
  SettingsState,
  SpawnDefinition,
  TriggerDefinition,
  WeaponKey,
} from '../core/types';
import { ENEMY_ARCHETYPES } from '../data/enemies';
import { LEVELS } from '../data/levels';
import { WEAPONS } from '../data/weapons';
import { generateSprites, type PixelSprite } from '../render/generatedSprites';
import { generateTextures } from '../render/generatedTextures';

type EnemyState = 'idle' | 'patrol' | 'chase' | 'windup' | 'pain' | 'search' | 'charge';

interface PlayerRuntime {
  x: number;
  y: number;
  z: number;
  velZ: number;
  pitch: number;
  dirX: number;
  dirY: number;
  planeX: number;
  planeY: number;
  velX: number;
  velY: number;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  stamina: number;
  maxStamina: number;
  weapon: WeaponKey;
  ammo: Record<WeaponKey, number>;
  totalAmmo: Record<WeaponKey, number>;
  hasWeapon: Record<WeaponKey, boolean>;
  keys: {
    red: boolean;
    blue: boolean;
    yellow: boolean;
  };
  dashCooldown: number;
  meleeCooldown: number;
}

interface WeaponAnimState {
  firing: boolean;
  timer: number;
  frame: number;
  switching: boolean;
  switchTimer: number;
  reloading: boolean;
  reloadTimer: number;
  reloadDuration: number;
  recoil: number;
}

interface EnemyRuntime extends SpawnDefinition {
  health: number;
  maxHealth: number;
  homeX: number;
  homeY: number;
  goalX: number;
  goalY: number;
  lastKnownX: number;
  lastKnownY: number;
  state: EnemyState;
  stateTimer: number;
  hurtTimer: number;
  attackCooldown: number;
  alertTimer: number;
  patrolTimer: number;
  strafeDir: number;
  muzzleTimer: number;
  dead: boolean;
  burstRemaining: number;
  burstTimer: number;
  bobOffset: number;
}

interface PickupRuntime extends PickupDefinition {
  collected: boolean;
}

interface BarrelRuntime extends BarrelDefinition {
  health: number;
  exploded: boolean;
  blastTimer: number;
}

interface GeneratorRuntime extends GeneratorDefinition {
  active: boolean;
  destroyed: boolean;
}

interface PropRuntime extends PropDefinition {}

interface DoorRuntime {
  key: string;
  x: number;
  y: number;
  open: number;
  state: 'closed' | 'opening' | 'open' | 'closing';
  color?: 'red' | 'blue' | 'yellow';
  unlocked: boolean;
  arenaLocked: boolean;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  type: 'flash' | 'casing' | 'spark' | 'debris' | 'blood' | 'explosion' | 'fire' | 'smoke' | 'tracer';
  size: number;
  tx?: number;
  ty?: number;
  tz?: number;
}

interface DamageNumber {
  x: number;
  y: number;
  z: number;
  text: string;
  life: number;
  maxLife: number;
  color: string;
  obj: Phaser.GameObjects.Text;
}

interface PlasmaProjectile {
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  damage: number;
  life: number;
  radius: number;
}

type LightZoneRuntime = LevelDefinition['lightZones'][number] & { _idx: number };
type KeyBindings = {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
  E: Phaser.Input.Keyboard.Key;
  R: Phaser.Input.Keyboard.Key;
  Q: Phaser.Input.Keyboard.Key;
  SPACE: Phaser.Input.Keyboard.Key;
  ONE: Phaser.Input.Keyboard.Key;
  TWO: Phaser.Input.Keyboard.Key;
  THREE: Phaser.Input.Keyboard.Key;
  FOUR: Phaser.Input.Keyboard.Key;
  SHIFT: Phaser.Input.Keyboard.Key;
  ESC: Phaser.Input.Keyboard.Key;
  LEFT: Phaser.Input.Keyboard.Key;
  RIGHT: Phaser.Input.Keyboard.Key;
  UP: Phaser.Input.Keyboard.Key;
  DOWN: Phaser.Input.Keyboard.Key;
};

export class GameScene extends Phaser.Scene {
  private readonly hooks: RuntimeHooks;
  private readonly payload: BootPayload;

  private settings!: SettingsState;
  private textures_ = generateTextures();
  private sprites_ = generateSprites();
  private sound_ = new SoundManager();
  private music_ = new MusicManager();

  private imageData!: ImageData;
  private buf!: Uint32Array;
  private zBuf!: Float64Array;
  private renderTex!: Phaser.Textures.CanvasTexture;
  private renderImage!: Phaser.GameObjects.Image;
  private hudCrosshair!: Phaser.GameObjects.Graphics;
  private hudCompass!: Phaser.GameObjects.Graphics;
  private minimapBg!: Phaser.GameObjects.Graphics;
  private minimap!: Phaser.GameObjects.Graphics;
  private fxGfx!: Phaser.GameObjects.Graphics;

  private vignetteTable = new Float32Array(SCREEN_W * SCREEN_H);
  private colorLut = new Uint8Array(256);
  private player!: PlayerRuntime;
  private weaponAnim: WeaponAnimState = {
    firing: false,
    timer: 0,
    frame: 0,
    switching: false,
    switchTimer: 0,
    reloading: false,
    reloadTimer: 0,
    reloadDuration: 0,
    recoil: 0,
  };

  private levelMap: number[][] = [];
  private mapW = 0;
  private mapH = 0;
  private lightZones: LightZoneRuntime[] = [];
  private enemies: EnemyRuntime[] = [];
  private pickups: PickupRuntime[] = [];
  private barrels: BarrelRuntime[] = [];
  private generators: GeneratorRuntime[] = [];
  private props: PropRuntime[] = [];
  private doors: Record<string, DoorRuntime> = {};
  private firedTriggers = new Set<string>();
  private currentLevel = 0;
  private currentObjectiveId = '';
  private exitPos = { x: 0, y: 0 };
  private activeCheckpointId = '';
  private pendingNextLevel: number | null = null;
  private extractionUnlocked = false;
  private escapeTimer: number | null = null;
  private bossPhase = 0;

  private particles: Particle[] = [];
  private dynamicLights: Array<{ x: number; y: number; r: number; g: number; b: number; radius: number; life: number; maxLife: number }> = [];
  private plasmaProjectiles: PlasmaProjectile[] = [];
  private flickerValues = new Float32Array(32);
  private flickerCounter = 0;
  private damageNumbers: DamageNumber[] = [];

  private pointerLocked = false;
  private mouseDown = false;
  private mouseDX = 0;
  private mouseDY = 0;
  private paused = false;
  private gameOver = false;
  private gameWon = false;
  private isSprinting = false;
  private walkCycle = 0;
  private viewBob = 0;
  private footstepTimer = 0;
  private crosshairSpread = 4;
  private hitMarkerTimer = 0;
  private lastFireTime = 0;
  private damageFlash = 0;
  private damageDir = 0;
  private messageText = '';
  private messageTimer = 0;
  private contextPrompt = '';
  private objectivePulse = 0;
  private currentFps = 0;
  private fpsFrames = 0;
  private fpsTimer = 0;
  private lastMouseRot = 0;
  private swayAmount = 0;

  private elapsedTime = 0;
  private shotsFired = 0;
  private shotsHit = 0;
  private killCount = 0;
  private deathCount = 0;

  private keys!: KeyBindings;

  private handleCanvasClick!: () => void;
  private handlePointerLockChange!: () => void;
  private handleMouseMove!: (event: MouseEvent) => void;
  private handleMouseDown!: (event: MouseEvent) => void;
  private handleMouseUp!: (event: MouseEvent) => void;
  private handleMouseWheel!: (event: WheelEvent) => void;

  constructor(hooks: RuntimeHooks, payload: BootPayload) {
    super('GameScene');
    this.hooks = hooks;
    this.payload = payload;
  }

  create(): void {
    this.settings = this.hooks.getSettings();
    this.sound_.init(this.settings);
    this.sound_.resume();

    this.imageData = new ImageData(SCREEN_W, SCREEN_H);
    this.buf = new Uint32Array(this.imageData.data.buffer);
    this.zBuf = new Float64Array(SCREEN_W);
    this.initPostFxTables();

    const createdRenderTex = this.textures.createCanvas('renderTex', SCREEN_W, SCREEN_H);
    if (!createdRenderTex) throw new Error('Failed to create render texture');
    this.renderTex = createdRenderTex;
    this.renderImage = this.add.image(SCREEN_W / 2, SCREEN_H / 2, 'renderTex');
    this.hudCrosshair = this.add.graphics().setDepth(10);
    this.hudCompass = this.add.graphics().setDepth(10);
    this.minimapBg = this.add.graphics().setDepth(8);
    this.minimap = this.add.graphics().setDepth(9);
    this.fxGfx = this.add.graphics().setDepth(9);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input unavailable');
    this.keys = keyboard.addKeys({
      W: 'W',
      A: 'A',
      S: 'S',
      D: 'D',
      E: 'E',
      R: 'R',
      Q: 'Q',
      SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE,
      ONE: 'ONE',
      TWO: 'TWO',
      THREE: 'THREE',
      FOUR: 'FOUR',
      SHIFT: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      ESC: Phaser.Input.Keyboard.KeyCodes.ESC,
      LEFT: Phaser.Input.Keyboard.KeyCodes.LEFT,
      RIGHT: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      UP: Phaser.Input.Keyboard.KeyCodes.UP,
      DOWN: Phaser.Input.Keyboard.KeyCodes.DOWN,
    }) as KeyBindings;

    this.player = this.createDefaultPlayer();
    this.registerPointerLock();

    const restore = this.payload.checkpoint;
    if (restore) {
      this.restoreFromCheckpoint(restore);
    } else {
      this.loadLevel(this.payload.startActIndex, false);
    }

    if (this.sound_.ctx) this.music_.start(this.sound_.ctx, this.settings);
    this.hooks.ui.showHud();
    this.hooks.ui.hidePause();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unregisterPointerLock();
      this.music_.stop();
    });
  }

  private initPostFxTables(): void {
    const cx = SCREEN_W / 2;
    const cy = SCREEN_H / 2;
    for (let y = 0; y < SCREEN_H; y++) {
      for (let x = 0; x < SCREEN_W; x++) {
        const dx = (x - cx) / cx;
        const dy = (y - cy) / cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        this.vignetteTable[y * SCREEN_W + x] = clamp(1 - d * d * 0.38, 0.35, 1);
      }
    }
    for (let index = 0; index < 256; index++) {
      const normalized = index / 255;
      // S-curve contrast with slight highlight lift
      const curved = normalized * normalized * (3 - 2 * normalized);
      const contrasted = clamp((curved - 0.5) * 1.3 + 0.5, 0, 1);
      this.colorLut[index] = Math.round(contrasted * 255);
    }
    for (let index = 0; index < this.flickerValues.length; index++) this.flickerValues[index] = Math.random();
  }

  private createDefaultPlayer(): PlayerRuntime {
    return {
      x: 2.5,
      y: 2.5,
      z: 0.5,
      velZ: 0,
      pitch: 0,
      dirX: 1,
      dirY: 0,
      planeX: 0,
      planeY: planeFromFov(this.settings.fov),
      velX: 0,
      velY: 0,
      health: 100,
      maxHealth: 100,
      armor: 0,
      maxArmor: 100,
      stamina: STAMINA_MAX,
      maxStamina: STAMINA_MAX,
      weapon: 'pistol',
      ammo: { pistol: 14, shotgun: 0, machinegun: 0, plasma: 0 },
      totalAmmo: { pistol: 56, shotgun: 0, machinegun: 0, plasma: 0 },
      hasWeapon: { pistol: true, shotgun: false, machinegun: false, plasma: false },
      keys: { red: false, blue: false, yellow: false },
      dashCooldown: 0,
      meleeCooldown: 0,
    };
  }

  private registerPointerLock(): void {
    const canvas = this.sys.game.canvas;
    this.handleCanvasClick = () => {
      if (!this.gameOver && !this.gameWon && !this.paused) {
        void canvas.requestPointerLock();
      }
    };
    this.handlePointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    };
    this.handleMouseMove = (event: MouseEvent) => {
      if (this.pointerLocked && !this.paused) {
        this.mouseDX += event.movementX;
        this.mouseDY += event.movementY;
      }
    };
    this.handleMouseDown = (event: MouseEvent) => {
      if (event.button === 0) this.mouseDown = true;
    };
    this.handleMouseUp = (event: MouseEvent) => {
      if (event.button === 0) this.mouseDown = false;
    };
    this.handleMouseWheel = (event: WheelEvent) => {
      if (this.paused || this.gameOver || this.gameWon) return;
      if (event.deltaY > 0) this.switchWeapon(1);
      else this.switchWeapon(-1);
    };

    canvas.addEventListener('click', this.handleCanvasClick);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('wheel', this.handleMouseWheel, { passive: true });
  }

  private unregisterPointerLock(): void {
    const canvas = this.sys.game.canvas;
    canvas.removeEventListener('click', this.handleCanvasClick);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('wheel', this.handleMouseWheel);
  }

  applySettings(settings: SettingsState): void {
    this.settings = settings;
    this.sound_.updateSettings(settings);
    this.hooks.persistSettings(settings);
    const angle = Math.atan2(this.player.dirY, this.player.dirX);
    this.updateDirection(angle);
  }

  getLevelDefinition(index = this.currentLevel): LevelDefinition | null {
    return LEVELS[index] ?? null;
  }

  getPendingNextLevel(): number | null {
    return this.pendingNextLevel;
  }

  advanceToPendingAct(): void {
    if (this.pendingNextLevel === null) return;
    this.gameWon = false;
    this.gameOver = false;
    this.paused = false;
    this.loadLevel(this.pendingNextLevel, true);
    this.hooks.ui.showHud();
    if (this.sound_.ctx) this.music_.start(this.sound_.ctx, this.settings);
    void this.sys.game.canvas.requestPointerLock();
  }

  private restoreFromCheckpoint(saveState: SaveState): void {
    this.elapsedTime = saveState.stats.elapsedTime;
    this.shotsFired = saveState.stats.shotsFired;
    this.shotsHit = saveState.stats.shotsHit;
    this.killCount = saveState.stats.kills;
    this.deathCount = saveState.stats.deaths;
    this.loadLevel(saveState.actIndex, false, saveState);
  }

  private loadLevel(index: number, carryLoadout: boolean, restore?: SaveState): void {
    const level = LEVELS[index];
    this.currentLevel = index;
    this.pendingNextLevel = level.nextLevel;
    this.levelMap = level.map.map((row) => [...row]);
    this.mapW = this.levelMap[0].length;
    this.mapH = this.levelMap.length;
    this.exitPos = { x: level.exit.x, y: level.exit.y };
    this.currentObjectiveId = restore?.currentObjectiveId ?? level.objectiveStart;
    this.firedTriggers = new Set(restore?.firedTriggers ?? []);
    this.extractionUnlocked = restore?.extractionUnlocked ?? false;
    this.escapeTimer = restore?.escapeTimeLeft ?? null;
    this.bossPhase = restore?.bossPhase ?? (level.id === 'reactor-core' ? 1 : 0);
    const baseLightZones = level.lightZones.map((zone, indexLight) => ({ ...zone, _idx: indexLight % this.flickerValues.length }));
    this.lightZones = [...baseLightZones, ...this.buildAmbientLightZones(level, baseLightZones.length)];

    this.doors = {};
    for (let y = 0; y < this.mapH; y++) {
      for (let x = 0; x < this.mapW; x++) {
        if (this.levelMap[y][x] !== 9) continue;
        const def = level.lockedDoors.find((door) => door.x === x && door.y === y);
        const savedDoor = restore?.doors.find((door) => door.x === x && door.y === y);
        const key = `${x},${y}`;
        this.doors[key] = savedDoor
          ? {
              key,
              x,
              y,
              open: savedDoor.open,
              state: savedDoor.state,
              color: savedDoor.color,
              unlocked: savedDoor.unlocked,
              arenaLocked: savedDoor.arenaLocked,
            }
          : {
              key,
              x,
              y,
              open: 0,
              state: 'closed',
              color: def?.color,
              unlocked: def?.initiallyUnlocked ?? !def?.color,
              arenaLocked: Boolean(def?.arenaLocked),
            };
      }
    }

    this.enemies = restore?.enemies.map((enemy) => this.createEnemyRuntime(enemy)) ?? level.entities.enemies.map((enemy) => this.createEnemyRuntime(enemy));
    this.pickups = restore?.pickups.map((pickupState) => ({ ...pickupState })) ?? level.entities.pickups.map((pickupDef) => ({ ...pickupDef, collected: false }));
    this.barrels = restore?.barrels.map((barrelState) => ({ ...barrelState, blastTimer: 0 })) ?? level.entities.barrels.map((barrelDef) => ({ ...barrelDef, health: BARREL_HEALTH, exploded: false, blastTimer: 0 }));
    this.generators = restore?.generators.map((state) => ({ ...state })) ?? level.entities.generators.map((generatorDef) => ({ ...generatorDef, active: Boolean(generatorDef.activeOnStart), destroyed: false }));
    this.props = (level.entities.props ?? []).map((p) => ({ ...p }));
    this.particles = [];
    this.dynamicLights = [];
    this.plasmaProjectiles = [];

    if (restore) {
      this.applyPlayerSnapshot(restore.player);
      this.activeCheckpointId = restore.checkpointId;
    } else {
      if (!carryLoadout || index === 0) {
        this.player = this.createDefaultPlayer();
      } else {
        this.player.health = Math.max(this.player.health, 85);
        this.player.armor = Math.max(this.player.armor, 25);
        this.player.stamina = STAMINA_MAX;
        this.player.dashCooldown = 0;
        this.player.meleeCooldown = 0;
        this.player.velX = 0;
        this.player.velY = 0;
      }
      this.activeCheckpointId = level.checkpoints[0]?.id ?? '';
      this.player.x = level.playerStart.x;
      this.player.y = level.playerStart.y;
      this.updateDirection(level.playerStart.angle);
      if (index === 0) {
        this.elapsedTime = 0;
        this.shotsFired = 0;
        this.shotsHit = 0;
        this.killCount = 0;
        this.deathCount = 0;
      }
    }

    this.weaponAnim = {
      firing: false,
      timer: 0,
      frame: 0,
      switching: false,
      switchTimer: 0,
      reloading: false,
      reloadTimer: 0,
      reloadDuration: 0,
      recoil: 0,
    };
    this.walkCycle = 0;
    this.viewBob = 0;
    this.crosshairSpread = 4;
    this.hitMarkerTimer = 0;
    this.damageFlash = 0;
    this.messageText = '';
    this.messageTimer = 0;
    this.contextPrompt = '';
    this.objectivePulse = 0;
    this.paused = false;
    this.gameOver = false;
    this.gameWon = false;
    this.lastFireTime = 0;
    this.hooks.ui.setCheckpointText(this.describeCheckpoint(this.activeCheckpointId));
  }

  private buildAmbientLightZones(level: LevelDefinition, offset: number): LightZoneRuntime[] {
    const derived: Array<Omit<LightZoneRuntime, '_idx'>> = [];

    for (const prop of level.entities.props ?? []) {
      if (prop.type === 'lamp') {
        derived.push({ x: prop.x, y: prop.y, radius: 4.1, r: 0.55, g: 0.44, b: 0.2, flicker: true });
      } else if (prop.type === 'terminal') {
        derived.push({ x: prop.x, y: prop.y, radius: 3.1, r: 0.12, g: 0.42, b: 0.62, flicker: false });
      }
    }

    for (const checkpoint of level.checkpoints) {
      derived.push({ x: checkpoint.beacon.x, y: checkpoint.beacon.y, radius: 2.4, r: 0.12, g: 0.34, b: 0.46, flicker: false });
    }

    for (const generator of level.entities.generators) {
      derived.push({ x: generator.x, y: generator.y, radius: 2.9, r: 0.1, g: 0.24, b: 0.34, flicker: false });
    }

    if (level.id === 'reactor-core') {
      derived.push({ x: 12.5, y: 12.5, radius: 8.4, r: 0.38, g: 0.08, b: 0.1, flicker: true });
    }

    return derived.map((zone, indexLight) => ({
      ...zone,
      _idx: (offset + indexLight) % this.flickerValues.length,
    }));
  }

  private createEnemyRuntime(enemy: SpawnDefinition | EnemySaveState): EnemyRuntime {
    const archetypeKey = enemy.archetype;
    const arch = ENEMY_ARCHETYPES[archetypeKey];
    const saved = enemy as EnemySaveState;
    const health = saved.health ?? arch.health;
    const dead = saved.dead ?? false;
    return {
      id: enemy.id,
      archetype: archetypeKey,
      x: enemy.x,
      y: enemy.y,
      encounterTag: enemy.encounterTag,
      health,
      maxHealth: arch.health,
      homeX: enemy.x,
      homeY: enemy.y,
      goalX: enemy.x,
      goalY: enemy.y,
      lastKnownX: enemy.x,
      lastKnownY: enemy.y,
      state: dead ? 'pain' : 'idle',
      stateTimer: 0,
      hurtTimer: 0,
      attackCooldown: 0,
      alertTimer: 0,
      patrolTimer: 0.7 + Math.random() * 1.2,
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      muzzleTimer: 0,
      dead,
      burstRemaining: 0,
      burstTimer: 0,
      bobOffset: Math.random() * Math.PI * 2,
    };
  }

  private applyPlayerSnapshot(snapshot: PlayerSnapshot): void {
    this.player = {
      ...this.player,
      x: snapshot.x,
      y: snapshot.y,
      z: 0.5,
      velZ: 0,
      pitch: 0,
      dirX: Math.cos(snapshot.angle),
      dirY: Math.sin(snapshot.angle),
      planeX: -Math.sin(snapshot.angle) * planeFromFov(this.settings.fov),
      planeY: Math.cos(snapshot.angle) * planeFromFov(this.settings.fov),
      velX: 0,
      velY: 0,
      health: snapshot.health,
      maxHealth: 100,
      armor: snapshot.armor,
      maxArmor: 100,
      stamina: snapshot.stamina,
      maxStamina: STAMINA_MAX,
      weapon: snapshot.weapon,
      ammo: { ...snapshot.ammo },
      totalAmmo: { ...snapshot.totalAmmo },
      hasWeapon: { ...snapshot.hasWeapon },
      keys: { ...snapshot.keys },
      dashCooldown: snapshot.dashCooldown,
      meleeCooldown: snapshot.meleeCooldown,
    };
  }

  private updateDirection(angle: number): void {
    const plane = planeFromFov(this.settings.fov);
    this.player.dirX = Math.cos(angle);
    this.player.dirY = Math.sin(angle);
    this.player.planeX = -Math.sin(angle) * plane;
    this.player.planeY = Math.cos(angle) * plane;
  }

  private describeCheckpoint(checkpointId: string): string {
    const label = LEVELS[this.currentLevel]?.checkpoints.find((checkpoint) => checkpoint.id === checkpointId)?.label;
    return label ? `Checkpoint armed: ${label}` : 'No checkpoint armed';
  }

  togglePause(forceState?: boolean): void {
    if (this.gameOver || this.gameWon) return;
    this.paused = forceState === undefined ? !this.paused : forceState;
    if (this.paused) {
      document.exitPointerLock();
      this.mouseDown = false;
      this.music_.stop();
      this.hooks.ui.showPause(
        `${LEVELS[this.currentLevel].actTitle}\nKills ${this.killCount} | Accuracy ${this.getAccuracy()}% | Time ${formatTime(this.elapsedTime)}`,
      );
    } else {
      this.hooks.ui.hidePause();
      if (this.sound_.ctx) this.music_.start(this.sound_.ctx, this.settings);
      void this.sys.game.canvas.requestPointerLock();
    }
  }

  update(time: number, delta: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) this.togglePause();
    if (this.gameOver || this.gameWon || this.paused) return;

    const dt = Math.min(delta / 1000, 0.05);
    this.elapsedTime += dt;
    this.objectivePulse += dt * 4;

    this.fpsFrames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 1) {
      this.currentFps = this.fpsFrames;
      this.fpsFrames = 0;
      this.fpsTimer -= 1;
    }

    this.flickerCounter++;
    if (this.flickerCounter >= 3) {
      this.flickerCounter = 0;
      for (let index = 0; index < this.flickerValues.length; index++) {
        this.flickerValues[index] = 0.5 + Math.random() * 0.5;
      }
    }

    if (this.escapeTimer !== null) {
      this.escapeTimer -= dt;
      if (this.escapeTimer <= 0) {
        this.finishRun(false, 'Core collapse overtook the evac route.');
        return;
      }
    }

    this.player.dashCooldown = Math.max(0, this.player.dashCooldown - dt);
    this.player.meleeCooldown = Math.max(0, this.player.meleeCooldown - dt);

    const combatIntensity = clamp(this.enemies.filter((enemy) => !enemy.dead && (enemy.state === 'chase' || enemy.state === 'windup' || enemy.state === 'charge')).length / 6, 0, 1);
    this.music_.update(this.settings, combatIntensity, this.bossPhase);

    this.handleInput(dt, time);
    this.updateDoors(dt);
    this.updateEnemies(dt);
    this.updatePlasmaProjectiles(dt);
    this.updatePickups();
    this.updateCheckpoints();
    this.updateTriggers();
    this.updateParticles(dt);
    this.updateFloatingTexts(dt);
    this.updateWeaponAnim(dt);
    this.updateContextPrompt();

    if (pointInZone(this.player.x, this.player.y, LEVELS[this.currentLevel].exit.zone) && this.extractionUnlocked) {
      this.finishRun(true);
      return;
    }

    this.renderScene();
    this.renderTex.refresh();
    this.updateHud(dt);
  }

  private handleInput(dt: number, time: number): void {
    const justDown = Phaser.Input.Keyboard.JustDown;
    const player = this.player;
    let moved = false;

    if (this.mouseDX !== 0 || this.mouseDY !== 0) {
      if (this.mouseDX !== 0) {
        this.rotatePlayer(this.mouseDX * 0.0025 * this.settings.mouseSensitivity);
        this.mouseDX = 0;
      }
      if (this.mouseDY !== 0) {
        player.pitch = clamp(player.pitch - this.mouseDY * 0.8 * this.settings.mouseSensitivity, -300, 300);
        this.mouseDY = 0;
      }
    }

    if (this.keys.LEFT.isDown) this.rotatePlayer(-2.5 * dt);
    if (this.keys.RIGHT.isDown) this.rotatePlayer(2.5 * dt);

    let inputX = 0;
    let inputY = 0;
    if (this.keys.W.isDown || this.keys.UP.isDown) {
      inputX += player.dirX;
      inputY += player.dirY;
    }
    if (this.keys.S.isDown || this.keys.DOWN.isDown) {
      inputX -= player.dirX;
      inputY -= player.dirY;
    }
    if (this.keys.A.isDown) {
      inputX += player.dirY;
      inputY -= player.dirX;
    }
    if (this.keys.D.isDown) {
      inputX -= player.dirY;
      inputY += player.dirX;
    }

    const moving = inputX !== 0 || inputY !== 0;
    if (moving) {
      const len = Math.sqrt(inputX * inputX + inputY * inputY);
      inputX /= len;
      inputY /= len;
    }

    const wantsSprint = this.keys.SHIFT.isDown && moving && player.stamina > 8 && !this.weaponAnim.reloading;
    const targetSpeed = BASE_MOVE_SPEED * (wantsSprint ? SPRINT_MULT : 1);
    const accel = moving ? (wantsSprint ? 14 : 11) : 8;
    player.velX = lerp(player.velX, inputX * targetSpeed, Math.min(1, dt * accel));
    player.velY = lerp(player.velY, inputY * targetSpeed, Math.min(1, dt * accel));
    if (!moving) {
      player.velX = lerp(player.velX, 0, Math.min(1, dt * 10));
      player.velY = lerp(player.velY, 0, Math.min(1, dt * 10));
    }

    if (justDown(this.keys.SPACE) && player.z <= 0.5) {
      if (player.dashCooldown <= 0) {
        let dashX = inputX;
        let dashY = inputY;
        if (!moving) {
          dashX = player.dirX;
          dashY = player.dirY;
        }
        const dashLen = Math.sqrt(dashX * dashX + dashY * dashY) || 1;
        player.velX += (dashX / dashLen) * 8.2;
        player.velY += (dashY / dashLen) * 8.2;
        player.dashCooldown = DASH_COOLDOWN;
        player.stamina = Math.max(0, player.stamina - 18);
        this.sound_.dash();
        this.shakeCamera(90, 0.0024);
        this.showMessage('Dash committed. Break the angle.');
      }
      player.velZ = 2.4;
    }

    if (player.z > 0.5 || player.velZ !== 0) {
      player.velZ -= 9.8 * dt;
      player.z += player.velZ * dt;
      if (player.z <= 0.5) {
        player.z = 0.5;
        player.velZ = 0;
      }
    }

    if (justDown(this.keys.Q) && player.meleeCooldown <= 0) {
      this.performMelee();
      player.meleeCooldown = MELEE_COOLDOWN;
      this.sound_.melee();
    }

    const moveX = player.velX * dt;
    const moveY = player.velY * dt;
    if (moveX !== 0 || moveY !== 0) {
      const nextX = player.x + moveX;
      const nextY = player.y + moveY;
      if (this.canWalk(nextX, player.y)) {
        player.x = nextX;
        moved = true;
      } else {
        player.velX *= 0.25;
      }
      if (this.canWalk(player.x, nextY)) {
        player.y = nextY;
        moved = true;
      } else {
        player.velY *= 0.25;
      }
    }

    if (moved) {
      this.walkCycle += dt * (wantsSprint ? 12 : 8);
      this.viewBob = Math.sin(this.walkCycle) * (wantsSprint ? 3.5 : 1.8);
      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        this.sound_.footstep();
        this.footstepTimer = wantsSprint ? 0.22 : 0.34;
      }
      if (wantsSprint) player.stamina = Math.max(0, player.stamina - STAMINA_DRAIN * dt);
      else player.stamina = Math.min(player.maxStamina, player.stamina + STAMINA_RECOVER * 0.55 * dt);
    } else {
      this.walkCycle *= 0.9;
      this.viewBob = lerp(this.viewBob, 0, dt * 8);
      player.stamina = Math.min(player.maxStamina, player.stamina + STAMINA_RECOVER * dt);
    }
    this.isSprinting = moved && wantsSprint;

    if (this.mouseDown && this.pointerLocked) this.tryFire(time);
    if (justDown(this.keys.E)) this.tryOpenDoor();
    if (justDown(this.keys.ONE) && player.hasWeapon.pistol) this.setWeapon('pistol');
    if (justDown(this.keys.TWO) && player.hasWeapon.shotgun) this.setWeapon('shotgun');
    if (justDown(this.keys.THREE) && player.hasWeapon.machinegun) this.setWeapon('machinegun');
    if (justDown(this.keys.FOUR) && player.hasWeapon.plasma) this.setWeapon('plasma');
    if (justDown(this.keys.R)) this.tryReload();
  }

  private rotatePlayer(rotation: number): void {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const dirX = this.player.dirX * cos - this.player.dirY * sin;
    const dirY = this.player.dirX * sin + this.player.dirY * cos;
    this.player.dirX = dirX;
    this.player.dirY = dirY;
    const planeX = this.player.planeX * cos - this.player.planeY * sin;
    const planeY = this.player.planeX * sin + this.player.planeY * cos;
    this.player.planeX = planeX;
    this.player.planeY = planeY;
  }

  private performMelee(): void {
    const originX = this.player.x + this.player.dirX * 0.75;
    const originY = this.player.y + this.player.dirY * 0.75;
    let hitSomething = false;

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const arch = ENEMY_ARCHETYPES[enemy.archetype];
      const dist = Math.sqrt(distSq(originX, originY, enemy.x, enemy.y));
      if (dist > 1.15) continue;
      this.damageEnemy(enemy, arch.weakToMelee ? 75 : 45);
      enemy.x += this.player.dirX * 0.12;
      enemy.y += this.player.dirY * 0.12;
      hitSomething = true;
      break;
    }

    if (!hitSomething) {
      for (const generator of this.generators) {
        if (!generator.active || generator.destroyed) continue;
        const dist = Math.sqrt(distSq(originX, originY, generator.x, generator.y));
        if (dist > 1.2) continue;
        this.damageGenerator(generator, 55);
        hitSomething = true;
        break;
      }
    }

    if (!hitSomething) {
      for (const barrel of this.barrels) {
        if (barrel.exploded) continue;
        const dist = Math.sqrt(distSq(originX, originY, barrel.x, barrel.y));
        if (dist > 1.2) continue;
        this.damageBarrel(barrel, BARREL_HEALTH);
        hitSomething = true;
        break;
      }
    }

    if (hitSomething) {
      this.hitMarkerTimer = 0.08;
      this.shakeCamera(50, 0.0018);
    }
  }

  private canWalk(x: number, y: number): boolean {
    for (const [ox, oy] of [[-COLLISION_R, -COLLISION_R], [COLLISION_R, -COLLISION_R], [-COLLISION_R, COLLISION_R], [COLLISION_R, COLLISION_R]]) {
      const mx = Math.floor(x + ox);
      const my = Math.floor(y + oy);
      if (mx < 0 || my < 0 || mx >= this.mapW || my >= this.mapH) return false;
      const tile = this.levelMap[my][mx];
      if (tile > 0 && tile !== 5 && tile !== 9) return false;
      if (tile === 9) {
        const door = this.doors[`${mx},${my}`];
        if (!door || door.open < 0.8) return false;
      }
    }

    for (const barrel of this.barrels) {
      if (barrel.exploded) continue;
      if (distSq(x, y, barrel.x, barrel.y) < (COLLISION_R + BARREL_RADIUS) ** 2) return false;
    }
    for (const generator of this.generators) {
      if (!generator.active || generator.destroyed) continue;
      if (distSq(x, y, generator.x, generator.y) < 0.45) return false;
    }
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const arch = ENEMY_ARCHETYPES[enemy.archetype];
      if (distSq(x, y, enemy.x, enemy.y) < (COLLISION_R + arch.hitRadius * 0.7) ** 2) return false;
    }
    return true;
  }

  private tryOpenDoor(): void {
    const lookX = Math.floor(this.player.x + this.player.dirX * 1.4);
    const lookY = Math.floor(this.player.y + this.player.dirY * 1.4);
    const candidates = [
      `${lookX},${lookY}`,
      `${Math.floor(this.player.x + 1)},${Math.floor(this.player.y)}`,
      `${Math.floor(this.player.x - 1)},${Math.floor(this.player.y)}`,
      `${Math.floor(this.player.x)},${Math.floor(this.player.y + 1)}`,
      `${Math.floor(this.player.x)},${Math.floor(this.player.y - 1)}`,
    ];

    for (const key of candidates) {
      const door = this.doors[key];
      if (!door) continue;
      if (door.arenaLocked) {
        this.showMessage('Arena lock engaged. Clear the sector.');
        this.sound_.doorDenied();
        return;
      }
      if (door.color && !door.unlocked) {
        const hasKey = this.player.keys[door.color];
        if (!hasKey) {
          this.showMessage(`Need ${door.color} keycard`);
          this.sound_.doorDenied();
          return;
        }
        door.unlocked = true;
        this.showMessage(`${door.color[0].toUpperCase() + door.color.slice(1)} door unlocked`);
        this.sound_.doorOpen();
      }
      if (door.state === 'closed') {
        door.state = 'opening';
        this.sound_.doorOpen();
      } else if (door.state === 'open') {
        door.state = 'closing';
      }
      return;
    }
  }

  private updateDoors(dt: number): void {
    Object.values(this.doors).forEach((door) => {
      if (door.state === 'opening') {
        door.open = Math.min(1, door.open + dt * 2.3);
        if (door.open >= 1) {
          door.state = 'open';
        }
      } else if (door.state === 'closing') {
        if (Math.floor(this.player.x) === door.x && Math.floor(this.player.y) === door.y) {
          door.state = 'open';
          return;
        }
        door.open = Math.max(0, door.open - dt * 2.3);
        if (door.open <= 0) door.state = 'closed';
      }
    });
  }

  private tryFire(time: number): void {
    const weapon = WEAPONS[this.player.weapon];
    if (time - this.lastFireTime < weapon.fireRate) return;
    if (this.weaponAnim.switching || this.weaponAnim.reloading) return;

    if (this.player.ammo[this.player.weapon] < weapon.ammoPerShot) {
      if (this.player.totalAmmo[this.player.weapon] > 0) this.tryReload();
      else this.sound_.emptyGun();
      this.lastFireTime = time;
      return;
    }

    this.player.ammo[this.player.weapon] -= weapon.ammoPerShot;
    this.lastFireTime = time;
    this.weaponAnim.firing = true;
    this.weaponAnim.timer = 0;
    this.weaponAnim.frame = 0;
    this.weaponAnim.recoil = Math.min(24, this.weaponAnim.recoil + weapon.recoil);
    this.crosshairSpread = Math.min(18, this.crosshairSpread + weapon.recoil * 0.45);
    this.player.pitch += weapon.recoil * 3.5;
    this.shakeCamera(110, weapon.shake * 1.6);
    this.shotsFired++;

    if (this.player.weapon === 'pistol') this.sound_.pistolShot();
    else if (this.player.weapon === 'shotgun') this.sound_.shotgunShot();
    else if (this.player.weapon === 'machinegun') this.sound_.machinegunShot();
    else this.sound_.plasmaFire();

    this.dynamicLights.push({
      x: this.player.x,
      y: this.player.y,
      r: this.player.weapon === 'plasma' ? 80 : 255,
      g: this.player.weapon === 'plasma' ? 200 : 200,
      b: this.player.weapon === 'plasma' ? 255 : 120,
      radius: 4,
      life: 0.08,
      maxLife: 0.08,
    });
    this.particles.push({
      x: this.player.x + this.player.dirX * 0.5,
      y: this.player.y + this.player.dirY * 0.5,
      z: 0.5,
      vx: 0, vy: 0, vz: 0,
      life: 0.06,
      maxLife: 0.06,
      type: 'flash',
      size: 22,
    });
    if (this.player.weapon !== 'plasma') {
      const sideX = -this.player.dirY;
      const sideY = this.player.dirX;
      this.particles.push({
        x: this.player.x + this.player.dirX * 0.3 + sideX * 0.15,
        y: this.player.y + this.player.dirY * 0.3 + sideY * 0.15,
        z: 0.45,
        vx: sideX * (1.5 + Math.random()) + (Math.random() - 0.5) * 0.5,
        vy: sideY * (1.5 + Math.random()) + (Math.random() - 0.5) * 0.5,
        vz: 1.2 + Math.random() * 1.5,
        life: 0.85,
        maxLife: 0.85,
        type: 'casing',
        size: 3,
      });
    }

    this.alertEnemiesAround(this.player.x, this.player.y, weapon.alertRadius);

    if (weapon.projectile) {
      const spread = (Math.random() - 0.5) * weapon.spread;
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      const dirX = this.player.dirX * cos - this.player.dirY * sin;
      const dirY = this.player.dirX * sin + this.player.dirY * cos;
      this.plasmaProjectiles.push({
        x: this.player.x + this.player.dirX * 0.5,
        y: this.player.y + this.player.dirY * 0.5,
        dx: dirX,
        dy: dirY,
        speed: 16,
        damage: weapon.damage,
        life: 2,
        radius: weapon.splashRadius ?? 1.5,
      });
      return;
    }

    let connected = false;
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const spread = (Math.random() - 0.5) * weapon.spread;
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      const dirX = this.player.dirX * cos - this.player.dirY * sin;
      const dirY = this.player.dirX * sin + this.player.dirY * cos;
      const wallDist = this.castSingleRay(this.player.x, this.player.y, dirX, dirY);
      const hit = this.findShotHit(this.player.x, this.player.y, dirX, dirY, wallDist);
      if (hit.type === 'enemy') {
        connected = true;
        this.damageEnemy(hit.enemy, weapon.damage);
      } else if (hit.type === 'barrel') {
        connected = true;
        this.damageBarrel(hit.barrel, weapon.damage);
      } else if (hit.type === 'generator') {
        connected = true;
        this.damageGenerator(hit.generator, weapon.damage);
      } else {
        const hx = this.player.x + dirX * (wallDist - 0.05);
        const hy = this.player.y + dirY * (wallDist - 0.05);
        for (let index = 0; index < 4; index++) {
          this.particles.push({
            x: hx,
            y: hy,
            z: 0.5 + (Math.random() - 0.5) * 0.2,
            vx: (Math.random() - 0.5) * 2.5,
            vy: (Math.random() - 0.5) * 2.5,
            vz: (Math.random() - 0.5) * 2.5,
            life: 0.35,
            maxLife: 0.35,
            type: 'spark',
            size: 2.2,
          });
        }
      }
    }
    if (connected) {
      this.shotsHit++;
      this.hitMarkerTimer = 0.12;
    }
  }

  private findShotHit(ox: number, oy: number, rayDirX: number, rayDirY: number, wallDist: number):
    | { type: 'wall' }
    | { type: 'enemy'; enemy: EnemyRuntime }
    | { type: 'barrel'; barrel: BarrelRuntime }
    | { type: 'generator'; generator: GeneratorRuntime } {
    let result: { type: 'wall' | 'enemy' | 'barrel' | 'generator'; dist: number; enemy?: EnemyRuntime; barrel?: BarrelRuntime; generator?: GeneratorRuntime } = {
      type: 'wall',
      dist: wallDist,
    };

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const arch = ENEMY_ARCHETYPES[enemy.archetype];
      const dx = enemy.x - ox;
      const dy = enemy.y - oy;
      const dot = dx * rayDirX + dy * rayDirY;
      if (dot < 0.25 || dot > result.dist) continue;
      const perpX = dx - rayDirX * dot;
      const perpY = dy - rayDirY * dot;
      if (Math.sqrt(perpX * perpX + perpY * perpY) < arch.hitRadius) {
        result = { type: 'enemy', dist: dot, enemy };
      }
    }

    for (const barrel of this.barrels) {
      if (barrel.exploded) continue;
      const dx = barrel.x - ox;
      const dy = barrel.y - oy;
      const dot = dx * rayDirX + dy * rayDirY;
      if (dot < 0.25 || dot > result.dist) continue;
      const perpX = dx - rayDirX * dot;
      const perpY = dy - rayDirY * dot;
      if (Math.sqrt(perpX * perpX + perpY * perpY) < BARREL_RADIUS) {
        result = { type: 'barrel', dist: dot, barrel };
      }
    }

    for (const generator of this.generators) {
      if (!generator.active || generator.destroyed) continue;
      const dx = generator.x - ox;
      const dy = generator.y - oy;
      const dot = dx * rayDirX + dy * rayDirY;
      if (dot < 0.25 || dot > result.dist) continue;
      const perpX = dx - rayDirX * dot;
      const perpY = dy - rayDirY * dot;
      if (Math.sqrt(perpX * perpX + perpY * perpY) < 0.4) {
        result = { type: 'generator', dist: dot, generator };
      }
    }

    if (result.type === 'enemy') return { type: 'enemy', enemy: result.enemy! };
    if (result.type === 'barrel') return { type: 'barrel', barrel: result.barrel! };
    if (result.type === 'generator') return { type: 'generator', generator: result.generator! };
    return { type: 'wall' };
  }

  private updatePlasmaProjectiles(dt: number): void {
    for (let index = this.plasmaProjectiles.length - 1; index >= 0; index--) {
      const projectile = this.plasmaProjectiles[index];
      projectile.life -= dt;
      if (projectile.life <= 0) {
        this.plasmaProjectiles.splice(index, 1);
        continue;
      }

      const nextX = projectile.x + projectile.dx * projectile.speed * dt;
      const nextY = projectile.y + projectile.dy * projectile.speed * dt;
      const mx = Math.floor(nextX);
      const my = Math.floor(nextY);
      if (mx < 0 || my < 0 || mx >= this.mapW || my >= this.mapH) {
        this.plasmaProjectiles.splice(index, 1);
        continue;
      }

      const tile = this.levelMap[my][mx];
      if ((tile > 0 && tile !== 5 && tile !== 9) || (tile === 9 && this.doors[`${mx},${my}`] && this.doors[`${mx},${my}`].open < 0.5)) {
        this.plasmaExplode(projectile.x, projectile.y, projectile.damage, projectile.radius);
        this.plasmaProjectiles.splice(index, 1);
        continue;
      }

      let collided = false;
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (distSq(nextX, nextY, enemy.x, enemy.y) < 0.45) {
          this.plasmaExplode(nextX, nextY, projectile.damage, projectile.radius);
          collided = true;
          break;
        }
      }
      if (!collided) {
        for (const generator of this.generators) {
          if (!generator.active || generator.destroyed) continue;
          if (distSq(nextX, nextY, generator.x, generator.y) < 0.45) {
            this.plasmaExplode(nextX, nextY, projectile.damage, projectile.radius);
            collided = true;
            break;
          }
        }
      }
      if (collided) {
        this.plasmaProjectiles.splice(index, 1);
        continue;
      }

      projectile.x = nextX;
      projectile.y = nextY;
      if (Math.random() < 0.35) {
        this.dynamicLights.push({
          x: projectile.x,
          y: projectile.y,
          r: 60,
          g: 190,
          b: 255,
          radius: 3,
          life: 0.08,
          maxLife: 0.08,
        });
      }
    }
  }

  private plasmaExplode(x: number, y: number, damage: number, radius: number): void {
    this.dynamicLights.push({ x, y, r: 90, g: 210, b: 255, radius: 7, life: 0.25, maxLife: 0.25 });
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dist = Math.sqrt(distSq(x, y, enemy.x, enemy.y));
      if (dist >= radius) continue;
      const scale = 1 - dist / radius;
      this.damageEnemy(enemy, Math.round(damage * scale));
    }
    for (const barrel of this.barrels) {
      if (barrel.exploded) continue;
      const dist = Math.sqrt(distSq(x, y, barrel.x, barrel.y));
      if (dist < radius + 0.5) this.damageBarrel(barrel, Math.round(damage * (1 - dist / (radius + 0.5))));
    }
    for (const generator of this.generators) {
      if (!generator.active || generator.destroyed) continue;
      const dist = Math.sqrt(distSq(x, y, generator.x, generator.y));
      if (dist < radius + 0.5) this.damageGenerator(generator, Math.round(damage * (1 - dist / (radius + 0.5))));
    }
    for (let index = 0; index < 9; index++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 0.4,
        y: y + (Math.random() - 0.5) * 0.4,
        z: 0.1 + Math.random() * 0.8,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        vz: 2 + Math.random() * 4,
        life: 0.5,
        maxLife: 0.5,
        type: 'spark',
        size: 3,
      });
    }
    this.shakeCamera(90, 0.0034);
  }

  private tryReload(): void {
    const weapon = WEAPONS[this.player.weapon];
    const needed = weapon.magSize - this.player.ammo[this.player.weapon];
    if (this.weaponAnim.reloading || this.weaponAnim.switching) return;
    if (needed <= 0 || this.player.totalAmmo[this.player.weapon] <= 0) return;
    this.weaponAnim.reloading = true;
    this.weaponAnim.reloadTimer = weapon.reloadTime;
    this.weaponAnim.reloadDuration = weapon.reloadTime;
    this.sound_.reload();
  }

  private finishReload(): void {
    const weapon = WEAPONS[this.player.weapon];
    const needed = weapon.magSize - this.player.ammo[this.player.weapon];
    if (needed > 0 && this.player.totalAmmo[this.player.weapon] > 0) {
      const amount = Math.min(needed, this.player.totalAmmo[this.player.weapon]);
      this.player.ammo[this.player.weapon] += amount;
      this.player.totalAmmo[this.player.weapon] -= amount;
    }
    this.weaponAnim.reloading = false;
    this.sound_.weaponSwitch();
  }

  private switchWeapon(direction: number): void {
    const available = (Object.keys(WEAPONS) as WeaponKey[]).filter((weapon) => this.player.hasWeapon[weapon]);
    const current = available.indexOf(this.player.weapon);
    const next = available[(current + direction + available.length) % available.length];
    if (next !== this.player.weapon) this.setWeapon(next);
  }

  private setWeapon(weaponKey: WeaponKey): void {
    if (this.player.weapon === weaponKey) return;
    this.weaponAnim.reloading = false;
    this.player.weapon = weaponKey;
    this.weaponAnim.switching = true;
    this.weaponAnim.switchTimer = 0.28;
    this.crosshairSpread = Math.min(14, this.crosshairSpread + 2);
    this.sound_.weaponSwitch();
  }

  private updateWeaponAnim(dt: number): void {
    if (this.weaponAnim.firing) {
      this.weaponAnim.timer += dt;
      if (this.weaponAnim.timer > 0.15) this.weaponAnim.firing = false;
      else this.weaponAnim.frame = this.weaponAnim.timer < 0.05 ? 1 : 2;
    }
    if (this.weaponAnim.switching) {
      this.weaponAnim.switchTimer -= dt;
      if (this.weaponAnim.switchTimer <= 0) this.weaponAnim.switching = false;
    }
    if (this.weaponAnim.reloading) {
      this.weaponAnim.reloadTimer -= dt;
      if (this.weaponAnim.reloadTimer <= 0) this.finishReload();
    }
    this.weaponAnim.recoil = lerp(this.weaponAnim.recoil, 0, Math.min(1, dt * 12));
    this.crosshairSpread = lerp(this.crosshairSpread, this.isSprinting ? 9 : this.weaponAnim.reloading ? 8 : 4, Math.min(1, dt * 9));
    this.hitMarkerTimer = Math.max(0, this.hitMarkerTimer - dt);
  }

  private updateEnemies(dt: number): void {
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const arch = ENEMY_ARCHETYPES[enemy.archetype];
      enemy.hurtTimer = Math.max(0, enemy.hurtTimer - dt);
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
      enemy.alertTimer = Math.max(0, enemy.alertTimer - dt);
      enemy.muzzleTimer = Math.max(0, enemy.muzzleTimer - dt);

      if (enemy.burstRemaining > 0) {
        enemy.burstTimer -= dt;
        if (enemy.burstTimer <= 0) {
          enemy.burstRemaining--;
          enemy.burstTimer = arch.attack.burstGap ?? 0.14;
          this.fireEnemyAttack(enemy, arch);
        }
        continue;
      }

      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const canSee = this.hasLineOfSight(enemy.x, enemy.y, this.player.x, this.player.y);
      if (canSee) {
        enemy.lastKnownX = this.player.x;
        enemy.lastKnownY = this.player.y;
        enemy.alertTimer = 4.5;
      }

      switch (enemy.state) {
        case 'idle':
          enemy.patrolTimer -= dt;
          if (canSee && dist < arch.detectionRange) {
            enemy.state = 'chase';
          } else if (enemy.patrolTimer <= 0 && this.pickEnemyGoal(enemy, enemy.homeX, enemy.homeY, 2.8)) {
            enemy.state = 'patrol';
            enemy.patrolTimer = 1.2 + Math.random() * 1.2;
          }
          break;
        case 'patrol':
          if (canSee && dist < arch.detectionRange) {
            enemy.state = 'chase';
          } else if (this.moveEnemyToward(enemy, enemy.goalX, enemy.goalY, dt, 0.08)) {
            enemy.state = 'idle';
            enemy.patrolTimer = 0.5 + Math.random() * 1.4;
          }
          break;
        case 'chase':
          if (enemy.archetype === 'boss' && this.bossPhase >= 3 && dist < 2.2 && enemy.attackCooldown <= 0) {
            enemy.state = 'charge';
            enemy.stateTimer = 0.9;
            this.showMessage('Overseer charge inbound.');
            break;
          }
          if (dist <= arch.attack.range && canSee && enemy.attackCooldown <= 0) {
            enemy.state = 'windup';
            enemy.stateTimer = arch.attack.windup;
          } else if (canSee) {
            const strafe = arch.strafeWeight * (dist < arch.attack.range * 0.85 && arch.attack.style !== 'melee' ? 1 : 0.25);
            this.moveEnemyToward(enemy, this.player.x, this.player.y, dt, strafe);
          } else if (enemy.alertTimer > 0) {
            if (this.moveEnemyToward(enemy, enemy.lastKnownX, enemy.lastKnownY, dt, 0)) {
              enemy.state = 'search';
              enemy.stateTimer = 1.2;
              this.pickEnemyGoal(enemy, enemy.lastKnownX, enemy.lastKnownY, 1.4);
            }
          } else {
            enemy.state = 'idle';
          }
          break;
        case 'windup':
          enemy.stateTimer -= dt;
          enemy.muzzleTimer = Math.max(enemy.muzzleTimer, 0.08);
          if (enemy.stateTimer <= 0) {
            this.fireEnemyAttack(enemy, arch);
            enemy.attackCooldown = arch.attack.cooldown;
            enemy.state = 'chase';
            if (arch.attack.style === 'burst' && arch.attack.burstCount) {
              enemy.burstRemaining = arch.attack.burstCount - 1;
              enemy.burstTimer = arch.attack.burstGap ?? 0.12;
            }
          }
          break;
        case 'pain':
          enemy.stateTimer -= dt;
          if (enemy.stateTimer <= 0) enemy.state = canSee || enemy.alertTimer > 0 ? 'chase' : 'idle';
          break;
        case 'search':
          enemy.stateTimer -= dt;
          if (canSee) {
            enemy.state = 'chase';
          } else if (this.moveEnemyToward(enemy, enemy.goalX, enemy.goalY, dt, 0.1) || enemy.stateTimer <= 0) {
            enemy.state = 'idle';
            enemy.patrolTimer = 0.6 + Math.random() * 1.5;
          }
          break;
        case 'charge':
          enemy.stateTimer -= dt;
          this.moveEnemyToward(enemy, this.player.x, this.player.y, dt, 0);
          if (dist < 1.5) {
            this.damagePlayer(22, { x: enemy.x, y: enemy.y });
            this.sound_.bossAttack();
            enemy.state = 'chase';
            enemy.attackCooldown = 1;
          } else if (enemy.stateTimer <= 0) {
            enemy.state = 'chase';
            enemy.attackCooldown = 0.6;
          }
          break;
      }
    }
  }

  private fireEnemyAttack(enemy: EnemyRuntime, arch = ENEMY_ARCHETYPES[enemy.archetype]): void {
    if (!this.hasLineOfSight(enemy.x, enemy.y, this.player.x, this.player.y)) return;
    const dx = this.player.x - enemy.x;
    const dy = this.player.y - enemy.y;
    const enemyAngle = Math.atan2(dy, dx);
    enemy.muzzleTimer = 0.14;
    this.particles.push({
      x: enemy.x + Math.cos(enemyAngle) * 0.45,
      y: enemy.y + Math.sin(enemyAngle) * 0.45,
      z: 0.55,
      vx: 0, vy: 0, vz: 0,
      life: 0.08,
      maxLife: 0.08,
      type: 'flash',
      size: 18,
    });
    if (arch.attack.style === 'melee') {
      this.sound_.stalkerAttack();
      this.damagePlayer(arch.attack.damage, { x: enemy.x, y: enemy.y });
      this.shakeCamera(80, 0.0032);
      return;
    }

    if (enemy.archetype === 'boss') this.sound_.bossAttack();
    else this.sound_.enemyFire();

    this.particles.push({
      x: enemy.x + Math.cos(enemyAngle) * 0.3,
      y: enemy.y + Math.sin(enemyAngle) * 0.3,
      z: 0.55,
      vx: 0, vy: 0, vz: 0,
      tx: this.player.x + (Math.random() - 0.5) * 0.2,
      ty: this.player.y + (Math.random() - 0.5) * 0.2,
      tz: 0.5,
      life: 0.08,
      maxLife: 0.08,
      type: 'tracer',
      size: 0,
    });
    this.dynamicLights.push({ x: enemy.x, y: enemy.y, r: 255, g: 220, b: 150, radius: 3, life: 0.08, maxLife: 0.08 });

    const pellets = arch.attack.pellets ?? 1;
    let totalDamage = 0;
    for (let pellet = 0; pellet < pellets; pellet++) {
      const accuracy = clamp(arch.attack.accuracy - Math.max(0, Math.sqrt(distSq(enemy.x, enemy.y, this.player.x, this.player.y)) - arch.attack.range * 0.6) * 0.03 - (this.isSprinting ? 0.08 : 0), 0.18, 0.95);
      if (Math.random() < accuracy) totalDamage += arch.attack.damage;
    }
    if (pellets > 1) totalDamage = Math.round(totalDamage * 0.38);

    if (totalDamage > 0) {
      this.damagePlayer(totalDamage, { x: enemy.x, y: enemy.y });
      if (enemy.archetype === 'boss') this.shakeCamera(110, 0.0042);
    } else {
      this.shakeCamera(50, 0.0012);
    }
  }

  private pickEnemyGoal(enemy: EnemyRuntime, centerX: number, centerY: number, radius: number): boolean {
    for (let attempt = 0; attempt < 10; attempt++) {
      const tx = clamp(centerX + (Math.random() * 2 - 1) * radius, 1.25, this.mapW - 1.25);
      const ty = clamp(centerY + (Math.random() * 2 - 1) * radius, 1.25, this.mapH - 1.25);
      const tile = this.levelMap[Math.floor(ty)][Math.floor(tx)];
      if ((tile === 0 || tile === 5) && this.canWalkEnemy(tx, ty, enemy)) {
        enemy.goalX = tx;
        enemy.goalY = ty;
        return true;
      }
    }
    return false;
  }

  private canWalkEnemy(x: number, y: number, enemy: EnemyRuntime): boolean {
    const arch = ENEMY_ARCHETYPES[enemy.archetype];
    const radius = arch.hitRadius * 0.7;
    for (const [ox, oy] of [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]]) {
      const mx = Math.floor(x + ox);
      const my = Math.floor(y + oy);
      if (mx < 0 || my < 0 || mx >= this.mapW || my >= this.mapH) return false;
      const tile = this.levelMap[my][mx];
      if (tile === 9) {
        const door = this.doors[`${mx},${my}`];
        if (!door || door.open < 0.85) return false;
      } else if (tile > 0 && tile !== 5) {
        return false;
      }
    }
    for (const barrel of this.barrels) {
      if (barrel.exploded) continue;
      if (distSq(x, y, barrel.x, barrel.y) < (radius + BARREL_RADIUS) ** 2) return false;
    }
    for (const other of this.enemies) {
      if (other.id === enemy.id || other.dead) continue;
      if (distSq(x, y, other.x, other.y) < 0.5) return false;
    }
    if (distSq(x, y, this.player.x, this.player.y) < 0.7) return false;
    return true;
  }

  private moveEnemyToward(enemy: EnemyRuntime, targetX: number, targetY: number, dt: number, strafeWeight: number): boolean {
    let dx = targetX - enemy.x;
    let dy = targetY - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.2) return true;
    dx /= dist;
    dy /= dist;
    if (strafeWeight > 0) {
      dx += -dy * strafeWeight * enemy.strafeDir;
      dy += (targetX - enemy.x) / dist * strafeWeight * enemy.strafeDir;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len;
      dy /= len;
    }
    const speed = ENEMY_ARCHETYPES[enemy.archetype].speed * (enemy.archetype === 'boss' && this.bossPhase >= 3 ? 1.25 : 1);
    const step = speed * dt;
    const newX = enemy.x + dx * step;
    const newY = enemy.y + dy * step;
    let moved = false;
    if (this.canWalkEnemy(newX, enemy.y, enemy)) {
      enemy.x = newX;
      moved = true;
    } else {
      enemy.strafeDir *= -1;
    }
    if (this.canWalkEnemy(enemy.x, newY, enemy)) {
      enemy.y = newY;
      moved = true;
    } else {
      enemy.strafeDir *= -1;
    }
    return dist < 0.24 || !moved;
  }

  private damageEnemy(enemy: EnemyRuntime, damage: number): void {
    if (enemy.dead) return;
    this.spawnFloatingText(enemy.x, enemy.y, damage.toString(), '#ffcc00');
    if (enemy.archetype === 'boss' && this.bossPhase === 2) {
      this.showMessage('Shielded. Destroy the generators.');
      return;
    }

    if (enemy.archetype === 'boss' && this.bossPhase === 1) {
      const phaseThreshold = enemy.maxHealth * 0.66;
      if (enemy.health - damage < phaseThreshold) {
        enemy.health = phaseThreshold;
      } else {
        enemy.health -= damage;
      }
    } else {
      enemy.health -= damage;
    }

    enemy.hurtTimer = 0.18;
    enemy.state = 'pain';
    enemy.stateTimer = enemy.archetype === 'boss' ? 0.12 : 0.22;
    enemy.alertTimer = 4;
    enemy.lastKnownX = this.player.x;
    enemy.lastKnownY = this.player.y;
    this.sound_.enemyHit();

    const count = enemy.archetype === 'boss' ? 16 : 8;
    for (let index = 0; index < count; index++) {
      this.particles.push({
        x: enemy.x,
        y: enemy.y,
        z: 0.5 + (Math.random() - 0.5) * 0.3,
        vx: (Math.random() - 0.5) * 2.5,
        vy: (Math.random() - 0.5) * 2.5,
        vz: 1.2 + Math.random() * 2,
        life: 0.42,
        maxLife: 0.42,
        type: 'blood',
        size: 3.2,
      });
    }

    if (enemy.health <= 0) {
      enemy.dead = true;
      enemy.state = 'pain';
      this.killCount++;
      this.sound_.enemyDie();
      if (enemy.archetype === 'boss') {
        this.startEscapeSequence();
      }
    } else if (enemy.archetype !== 'boss') {
      this.alertEnemiesAround(enemy.x, enemy.y, 9);
    }
  }

  private damageBarrel(barrel: BarrelRuntime, damage: number): void {
    if (barrel.exploded) return;
    barrel.health -= damage;
    if (barrel.health <= 0) this.explodeBarrel(barrel);
  }

  private explodeBarrel(barrel: BarrelRuntime): void {
    if (barrel.exploded) return;
    barrel.exploded = true;
    barrel.blastTimer = 0.35;
    this.sound_.barrelExplosion();
    this.dynamicLights.push({ x: barrel.x, y: barrel.y, r: 255, g: 140, b: 40, radius: 12, life: 0.42, maxLife: 0.42 });
    const blast = this.worldToScreen(barrel.x, barrel.y);
    if (blast) {
      this.particles.push({
        x: blast.x, y: blast.y, z: 0.5,
        vx: 0, vy: 0, vz: 0,
        life: 0.15, maxLife: 0.15,
        type: 'explosion', size: 1.5
      });
    }
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dist = Math.sqrt(distSq(enemy.x, enemy.y, barrel.x, barrel.y));
      if (dist > BARREL_DAMAGE_RADIUS) continue;
      this.damageEnemy(enemy, Math.round(BARREL_DAMAGE * (1 - dist / BARREL_DAMAGE_RADIUS)));
    }
    for (const generator of this.generators) {
      if (!generator.active || generator.destroyed) continue;
      const dist = Math.sqrt(distSq(generator.x, generator.y, barrel.x, barrel.y));
      if (dist < BARREL_DAMAGE_RADIUS) this.damageGenerator(generator, Math.round(BARREL_DAMAGE * (1 - dist / BARREL_DAMAGE_RADIUS)));
    }
    const playerDist = Math.sqrt(distSq(this.player.x, this.player.y, barrel.x, barrel.y));
    if (playerDist < BARREL_DAMAGE_RADIUS) {
      this.damagePlayer(Math.round(BARREL_DAMAGE * (1 - playerDist / BARREL_DAMAGE_RADIUS) * 0.65), { x: barrel.x, y: barrel.y });
    }
    this.shakeCamera(160, 0.006);
  }

  private damageGenerator(generator: GeneratorRuntime, damage: number): void {
    if (!generator.active || generator.destroyed) return;
    generator.health -= damage;
    this.sound_.generatorHit();
    if (generator.health <= 0) {
      generator.destroyed = true;
      this.showMessage(`Generator ${this.generators.filter((item) => item.destroyed).length}/${this.generators.filter((item) => item.active).length} down.`);
      this.dynamicLights.push({ x: generator.x, y: generator.y, r: 80, g: 240, b: 140, radius: 8, life: 0.3, maxLife: 0.3 });
      this.shakeCamera(70, 0.0024);
    }
  }

  private startEscapeSequence(): void {
    if (this.escapeTimer !== null) return;
    this.bossPhase = 4;
    this.escapeTimer = 45;
    this.extractionUnlocked = true;
    this.currentObjectiveId = 'a4-escape';
    Object.values(this.doors).forEach((door) => {
      door.arenaLocked = false;
      door.unlocked = true;
      door.state = 'opening';
    });
    this.showMessage('Core destabilized. Timed extraction live.');
    this.sound_.objectiveComplete();
    this.hooks.clearCheckpoint();
  }

  private alertEnemiesAround(x: number, y: number, radius: number): void {
    const radiusSq = radius * radius;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      if (distSq(enemy.x, enemy.y, x, y) <= radiusSq) {
        enemy.state = 'chase';
        enemy.alertTimer = 4 + Math.random();
        enemy.lastKnownX = this.player.x;
        enemy.lastKnownY = this.player.y;
      }
    }
  }

  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(2, Math.ceil(dist / 0.14));
    for (let index = 1; index < steps; index++) {
      const t = index / steps;
      const sx = x1 + dx * t;
      const sy = y1 + dy * t;
      const mx = Math.floor(sx);
      const my = Math.floor(sy);
      if (mx < 0 || my < 0 || mx >= this.mapW || my >= this.mapH) return false;
      const tile = this.levelMap[my][mx];
      if (tile > 0 && tile !== 5 && tile !== 9) return false;
      if (tile === 9) {
        const door = this.doors[`${mx},${my}`];
        if (door && door.open < 0.5) return false;
      }
    }
    return true;
  }

  private updateFloatingTexts(dt: number): void {
    if (this.gameOver || this.gameWon) {
      for (const ft of this.damageNumbers) ft.obj.setVisible(false);
      return;
    }
    const halfH = (SCREEN_H >> 1) + Math.round(this.player.pitch + this.viewBob + this.damageFlash * 25);
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const ft = this.damageNumbers[i];
      ft.life -= dt;
      if (ft.life <= 0) {
        ft.obj.destroy();
        this.damageNumbers.splice(i, 1);
        continue;
      }
      ft.z += dt * 0.6; // Float up
      const screen = this.worldToScreen(ft.x, ft.y);
      if (screen && screen.dist > 0.1) {
        const zOffset = Math.floor((this.player.z - ft.z) * SCREEN_H / screen.dist);
        ft.obj.setPosition(screen.x, halfH + zOffset);
        const scale = clamp(1 / screen.dist, 0.4, 2.0);
        ft.obj.setScale(scale);
        ft.obj.setAlpha(Math.min(1, ft.life / (ft.maxLife * 0.5)));
        ft.obj.setVisible(true);
        ft.obj.setDepth(20 + 1 / screen.dist);
      } else {
        ft.obj.setVisible(false);
      }
    }
  }

  private spawnFloatingText(x: number, y: number, text: string, color: string = '#ffffff'): void {
    const obj = this.add.text(-1000, -1000, text, {
      fontFamily: '"Trebuchet MS", monospace',
      fontSize: '24px',
      color,
      stroke: '#000000',
      strokeThickness: 3,
      shadow: { offsetX: 0, offsetY: 2, color: '#000', blur: 4, stroke: true, fill: true }
    }).setOrigin(0.5, 0.5).setDepth(20);

    this.damageNumbers.push({
      x: x + (Math.random() - 0.5) * 0.4,
      y: y + (Math.random() - 0.5) * 0.4,
      z: 0.8 + Math.random() * 0.2,
      text,
      life: 0.65,
      maxLife: 0.65,
      color,
      obj,
    });
  }

  private damagePlayer(damage: number, source?: { x: number; y: number }): void {
    if (this.gameOver || this.gameWon) return;

    if (source) {
      const dx = source.x - this.player.x;
      const dy = source.y - this.player.y;
      const angleToSource = Math.atan2(dy, dx);
      const playerAngle = Math.atan2(this.player.dirY, this.player.dirX);
      const diff = normalizeAngle(angleToSource - playerAngle);

      if (diff > Math.PI / 4 && diff < 3 * Math.PI / 4) this.damageDir = 1;
      else if (diff < -Math.PI / 4 && diff > -3 * Math.PI / 4) this.damageDir = -1;
      else this.damageDir = 0;
    } else {
      this.damageDir = 0;
    }
    if (this.player.armor > 0) {
      const absorbed = Math.min(this.player.armor, Math.floor(damage * 0.6));
      this.player.armor -= absorbed;
      damage -= absorbed;
    }
    this.player.health = Math.max(0, this.player.health - damage);
    this.player.stamina = Math.max(0, this.player.stamina - damage * 0.6);
    this.damageFlash = 0.3;
    this.sound_.playerHurt();
    this.shakeCamera(100, 0.0038);
    if (this.player.health <= 0) {
      this.finishRun(false, 'Mission failed under hostile pressure.');
    }
  }

  private updatePickups(): void {
    for (const pickup of this.pickups) {
      if (pickup.collected) continue;
      if (distSq(this.player.x, this.player.y, pickup.x, pickup.y) > PICKUP_RADIUS * PICKUP_RADIUS) continue;

      if (pickup.type === 'health') {
        if (this.player.health >= this.player.maxHealth) continue;
        this.player.health = Math.min(this.player.maxHealth, this.player.health + 30);
        this.showMessage('+30 Health');
      } else if (pickup.type === 'ammo') {
        this.player.totalAmmo.pistol = Math.min(WEAPONS.pistol.maxAmmo, this.player.totalAmmo.pistol + 18);
        this.player.totalAmmo.shotgun = Math.min(WEAPONS.shotgun.maxAmmo, this.player.totalAmmo.shotgun + 6);
        this.player.totalAmmo.machinegun = Math.min(WEAPONS.machinegun.maxAmmo, this.player.totalAmmo.machinegun + 28);
        this.player.totalAmmo.plasma = Math.min(WEAPONS.plasma.maxAmmo, this.player.totalAmmo.plasma + 12);
        this.showMessage('+Ammo Cache');
      } else if (pickup.type === 'armor') {
        if (this.player.armor >= this.player.maxArmor) continue;
        this.player.armor = Math.min(this.player.maxArmor, this.player.armor + 45);
        this.showMessage('+45 Armor');
      } else if (pickup.type === 'shotgun') {
        this.acquireWeapon('shotgun', 6, 10, 'Breacher acquired');
      } else if (pickup.type === 'machinegun') {
        this.acquireWeapon('machinegun', 42, 84, 'Pulse Rifle acquired');
      } else if (pickup.type === 'plasma') {
        this.acquireWeapon('plasma', 50, 50, 'Plasma Caster acquired');
      } else if (pickup.type === 'keyRed') {
        this.player.keys.red = true;
        this.showMessage('Red keycard acquired');
      } else if (pickup.type === 'keyBlue') {
        this.player.keys.blue = true;
        this.showMessage('Blue keycard acquired');
      } else if (pickup.type === 'keyYellow') {
        this.player.keys.yellow = true;
        this.showMessage('Yellow keycard acquired');
      }

      pickup.collected = true;
      this.sound_.pickup();
    }
  }

  private acquireWeapon(weapon: WeaponKey, magAmmo: number, reserveAmmo: number, message: string): void {
    if (this.player.hasWeapon[weapon]) {
      this.player.totalAmmo[weapon] = Math.min(WEAPONS[weapon].maxAmmo, this.player.totalAmmo[weapon] + reserveAmmo);
      this.showMessage(`+${WEAPONS[weapon].name} ammo`);
      return;
    }
    this.player.hasWeapon[weapon] = true;
    this.player.weapon = weapon;
    this.player.ammo[weapon] = magAmmo;
    this.player.totalAmmo[weapon] = reserveAmmo;
    this.weaponAnim.switching = true;
    this.weaponAnim.switchTimer = 0.28;
    this.showMessage(message);
  }

  private updateCheckpoints(): void {
    const level = LEVELS[this.currentLevel];
    for (const checkpoint of level.checkpoints) {
      if (!pointInZone(this.player.x, this.player.y, checkpoint.zone)) continue;
      if (this.activeCheckpointId === checkpoint.id) continue;
      this.activeCheckpointId = checkpoint.id;
      this.hooks.saveCheckpoint(this.buildSaveState(checkpoint.id));
      this.hooks.ui.setCheckpointText(this.describeCheckpoint(checkpoint.id));
      this.showMessage(`Checkpoint armed: ${checkpoint.label}`);
      this.sound_.checkpoint();
      break;
    }
  }

  private updateTriggers(): void {
    const level = LEVELS[this.currentLevel];
    for (const trigger of level.triggers) {
      if (this.firedTriggers.has(trigger.id)) continue;
      if (!this.checkTrigger(trigger)) continue;
      this.executeTrigger(trigger);
      if (trigger.once !== false) this.firedTriggers.add(trigger.id);
    }
  }

  private checkTrigger(trigger: TriggerDefinition): boolean {
    const condition = trigger.condition;
    switch (condition.type) {
      case 'enterZone':
        return pointInZone(this.player.x, this.player.y, condition.zone);
      case 'encounterCleared':
        return this.enemies.every((enemy) => enemy.dead || enemy.encounterTag !== condition.tag);
      case 'killCount':
        return this.killCount >= condition.count;
      case 'bossHealthBelow': {
        const boss = this.enemies.find((enemy) => enemy.archetype === 'boss' && !enemy.dead);
        if (!boss) return false;
        return boss.health / boss.maxHealth <= condition.threshold;
      }
      case 'generatorsDestroyed':
        return this.generators.filter((generator) => generator.active && generator.destroyed).length >= condition.count;
      case 'escapeTimerExpired':
        return this.escapeTimer !== null && this.escapeTimer <= 0;
    }
  }

  private executeTrigger(trigger: TriggerDefinition): void {
    for (const action of trigger.actions) {
      switch (action.type) {
        case 'spawnEnemies':
          action.enemies.forEach((enemy) => this.enemies.push(this.createEnemyRuntime(enemy)));
          break;
        case 'lockDoors':
          action.doors.forEach((doorPos) => {
            const door = this.doors[`${doorPos.x},${doorPos.y}`];
            if (door) {
              door.arenaLocked = true;
              door.state = 'closing';
            }
          });
          break;
        case 'unlockDoors':
          action.doors.forEach((doorPos) => {
            const door = this.doors[`${doorPos.x},${doorPos.y}`];
            if (door) {
              door.arenaLocked = false;
              door.unlocked = true;
              if (action.autoOpen) door.state = 'opening';
            }
          });
          break;
        case 'setObjective':
          this.currentObjectiveId = action.objectiveId;
          break;
        case 'message':
          this.showMessage(action.text);
          break;
        case 'activateCheckpoint': {
          const checkpoint = LEVELS[this.currentLevel].checkpoints.find((item) => item.id === action.checkpointId);
          if (checkpoint) {
            this.activeCheckpointId = checkpoint.id;
            this.hooks.saveCheckpoint(this.buildSaveState(checkpoint.id));
            this.hooks.ui.setCheckpointText(this.describeCheckpoint(checkpoint.id));
            this.sound_.checkpoint();
          }
          break;
        }
        case 'activateGenerators':
          action.generatorIds.forEach((id) => {
            const generator = this.generators.find((item) => item.id === id);
            if (generator) generator.active = true;
          });
          break;
        case 'setBossPhase':
          this.bossPhase = action.phase;
          if (action.phase === 3) {
            const boss = this.enemies.find((enemy) => enemy.archetype === 'boss' && !enemy.dead);
            if (boss) {
              boss.attackCooldown = 0.3;
              this.sound_.bossRoar();
            }
          }
          break;
        case 'unlockExtraction':
          this.extractionUnlocked = true;
          break;
        case 'startEscape':
          this.escapeTimer = action.duration;
          this.extractionUnlocked = true;
          break;
      }
    }
  }

  private buildSaveState(checkpointId: string): SaveState {
    return {
      version: 1,
      savedAt: Date.now(),
      actIndex: this.currentLevel,
      checkpointId,
      currentObjectiveId: this.currentObjectiveId,
      player: this.buildPlayerSnapshot(),
      enemies: this.enemies.map((enemy) => ({
        id: enemy.id,
        archetype: enemy.archetype,
        x: enemy.x,
        y: enemy.y,
        health: enemy.health,
        dead: enemy.dead,
        encounterTag: enemy.encounterTag,
      })),
      pickups: this.pickups.map((pickup) => ({ ...pickup })),
      barrels: this.barrels.map((barrel) => ({
        id: barrel.id,
        x: barrel.x,
        y: barrel.y,
        health: barrel.health,
        exploded: barrel.exploded,
      })),
      generators: this.generators.map((generator) => ({ ...generator })),
      doors: Object.values(this.doors).map((door) => ({
        key: door.key,
        x: door.x,
        y: door.y,
        open: door.open,
        state: door.state,
        color: door.color,
        unlocked: door.unlocked,
        arenaLocked: door.arenaLocked,
      })),
      firedTriggers: Array.from(this.firedTriggers),
      extractionUnlocked: this.extractionUnlocked,
      bossPhase: this.bossPhase,
      escapeTimeLeft: this.escapeTimer,
      stats: {
        elapsedTime: this.elapsedTime,
        shotsFired: this.shotsFired,
        shotsHit: this.shotsHit,
        kills: this.killCount,
        deaths: this.deathCount,
      },
    };
  }

  private buildPlayerSnapshot(): PlayerSnapshot {
    return {
      x: this.player.x,
      y: this.player.y,
      angle: Math.atan2(this.player.dirY, this.player.dirX),
      health: this.player.health,
      armor: this.player.armor,
      stamina: this.player.stamina,
      weapon: this.player.weapon,
      ammo: { ...this.player.ammo },
      totalAmmo: { ...this.player.totalAmmo },
      hasWeapon: { ...this.player.hasWeapon },
      keys: { ...this.player.keys },
      dashCooldown: this.player.dashCooldown,
      meleeCooldown: this.player.meleeCooldown,
    };
  }

  private showMessage(message: string): void {
    this.messageText = message;
    this.messageTimer = 2;
  }

  private getAccuracy(): number {
    return this.shotsFired > 0 ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;
  }

  private getCurrentObjective() {
    return LEVELS[this.currentLevel].objectives.find((objective) => objective.id === this.currentObjectiveId) ?? LEVELS[this.currentLevel].objectives[0];
  }

  private getObjectiveTarget(): { x: number; y: number } {
    const objective = this.getCurrentObjective();
    if (objective.type === 'escape' || this.extractionUnlocked && objective.id.endsWith('extract')) return this.exitPos;
    if (objective.targetId === 'boss') {
      const boss = this.enemies.find((enemy) => enemy.archetype === 'boss' && !enemy.dead);
      if (boss) return { x: boss.x, y: boss.y };
    }
    if (objective.targetId === 'generators') {
      const target = this.generators.find((generator) => generator.active && !generator.destroyed);
      if (target) return { x: target.x, y: target.y };
    }
    if (objective.type === 'clear' || objective.targetId) {
      const tagged = this.enemies.filter((enemy) => !enemy.dead && (!objective.targetId || enemy.encounterTag === objective.targetId));
      if (tagged.length > 0) {
        return tagged.sort((a, b) => distSq(a.x, a.y, this.player.x, this.player.y) - distSq(b.x, b.y, this.player.x, this.player.y))[0];
      }
    }
    const anyEnemy = this.enemies.filter((enemy) => !enemy.dead);
    if (anyEnemy.length > 0) {
      return anyEnemy.sort((a, b) => distSq(a.x, a.y, this.player.x, this.player.y) - distSq(b.x, b.y, this.player.x, this.player.y))[0];
    }
    return this.exitPos;
  }

  private updateContextPrompt(): void {
    if (!this.pointerLocked) {
      this.contextPrompt = 'Click the viewport to capture the mouse.';
      return;
    }
    const lookX = Math.floor(this.player.x + this.player.dirX * 1.35);
    const lookY = Math.floor(this.player.y + this.player.dirY * 1.35);
    const door = this.doors[`${lookX},${lookY}`];
    if (door) {
      if (door.arenaLocked) this.contextPrompt = 'Arena lock engaged until hostiles are cleared.';
      else if (door.color && !door.unlocked && !this.player.keys[door.color]) this.contextPrompt = `Need ${door.color} keycard to open.`;
      else this.contextPrompt = door.state === 'closed' ? 'Press E to open the door.' : 'Press E to close the door.';
      return;
    }

    const generator = this.generators.find((item) => item.active && !item.destroyed && distSq(this.player.x, this.player.y, item.x, item.y) < 2.3);
    if (generator && this.bossPhase === 2) {
      this.contextPrompt = 'Destroy the shield generator.';
      return;
    }

    if (this.weaponAnim.reloading) {
      this.contextPrompt = 'Reloading. Hold your lane.';
      return;
    }

    if (this.escapeTimer !== null) {
      this.contextPrompt = `Extraction window ${formatTime(this.escapeTimer)}.`;
      return;
    }

    this.contextPrompt = this.isSprinting ? 'Sprint to break line of sight, then re-engage.' : '';
  }

  private updateParticles(dt: number): void {
    const GRAVITY_Z = -4.5;   // world units/s² downward
    const FLOOR_Z   = 0.04;   // floor level in world Z
    for (let index = this.particles.length - 1; index >= 0; index--) {
      const p = this.particles[index];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(index, 1); continue; }

      // Integrate velocity
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.z  += p.vz * dt;

      // Per-type physics
      if (p.type === 'casing') {
        p.vz += GRAVITY_Z * dt;  // gravity pull Z down
        p.vx *= Math.pow(0.88, dt * 60);
        p.vy *= Math.pow(0.88, dt * 60);
        if (p.z <= FLOOR_Z) {
          p.z  = FLOOR_Z;
          p.vz = Math.abs(p.vz) * 0.35;
          p.vx *= 0.5;
          p.vy *= 0.5;
        }
      } else if (p.type === 'blood' || p.type === 'debris') {
        p.vz += GRAVITY_Z * 0.7 * dt;
        if (p.z <= FLOOR_Z) { p.z = FLOOR_Z; p.vz = 0; p.vx *= 0.4; p.vy *= 0.4; }
      } else if (p.type === 'spark') {
        p.vz += GRAVITY_Z * 0.5 * dt;
        if (p.z <= FLOOR_Z) { p.z = FLOOR_Z; p.vz = Math.abs(p.vz) * 0.2; }
      } else if (p.type === 'smoke') {
        p.vz += 1.2 * dt;   // smoke rises
        p.vx *= Math.pow(0.97, dt * 60);
        p.vy *= Math.pow(0.97, dt * 60);
      } else if (p.type === 'fire') {
        p.vz += 2.5 * dt;
        p.vx *= Math.pow(0.94, dt * 60);
        p.vy *= Math.pow(0.94, dt * 60);
      }
    }
    for (let index = this.dynamicLights.length - 1; index >= 0; index--) {
      const light = this.dynamicLights[index];
      light.life -= dt;
      if (light.life <= 0) this.dynamicLights.splice(index, 1);
    }
    for (const barrel of this.barrels) barrel.blastTimer = Math.max(0, barrel.blastTimer - dt);
  }

  private finishRun(won: boolean, deathMessage?: string): void {
    document.exitPointerLock();
    this.mouseDown = false;
    this.paused = false;
    this.gameWon = won;
    this.gameOver = !won;
    this.music_.stop();
    this.hooks.ui.hidePause();
    this.hooks.ui.hideHud();

    if (!won) {
      this.deathCount++;
    }

    const stats = `${LEVELS[this.currentLevel].actTitle}
Kills ${this.killCount} | Accuracy ${this.getAccuracy()}% | Time ${formatTime(this.elapsedTime)}${this.escapeTimer !== null && won ? ` | Escape ${formatTime(this.escapeTimer)}` : ''}`;

    if (won) {
      if (this.pendingNextLevel !== null) {
        this.hooks.ui.showVictory(stats, true, false);
      } else {
        this.hooks.clearCheckpoint();
        this.hooks.ui.showVictory(`${stats}\nAll sectors cleared.`, false, true);
      }
    } else {
      this.hooks.ui.showDeath(`${deathMessage ?? 'Run terminated.'}\n${stats}`, Boolean(this.hooks.loadCheckpoint()));
    }
  }

  private shakeCamera(duration: number, intensity: number): void {
    const scaled = intensity * this.settings.screenShake;
    if (scaled > 0) this.cameras.main.shake(duration, scaled);
  }

  private castSingleRay(ox: number, oy: number, rayDirX: number, rayDirY: number): number {
    let mapX = Math.floor(ox);
    let mapY = Math.floor(oy);
    const deltaDistX = Math.abs(1 / rayDirX);
    const deltaDistY = Math.abs(1 / rayDirY);
    let stepX = 0;
    let stepY = 0;
    let sideDistX = 0;
    let sideDistY = 0;
    if (rayDirX < 0) {
      stepX = -1;
      sideDistX = (ox - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1 - ox) * deltaDistX;
    }
    if (rayDirY < 0) {
      stepY = -1;
      sideDistY = (oy - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1 - oy) * deltaDistY;
    }
    for (let index = 0; index < 64; index++) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
      }
      if (mapX < 0 || mapY < 0 || mapX >= this.mapW || mapY >= this.mapH) break;
      const tile = this.levelMap[mapY][mapX];
      if (tile > 0 && tile !== 5) {
        if (tile === 9) {
          const door = this.doors[`${mapX},${mapY}`];
          if (door && door.open >= 0.9) continue;
        }
        return sideDistX - deltaDistX < sideDistY - deltaDistY ? sideDistX - deltaDistX : sideDistY - deltaDistY;
      }
    }
    return MAX_VIEW_DIST;
  }

  private worldToScreen(worldX: number, worldY: number): { x: number; y: number; dist: number } | null {
    const dx = worldX - this.player.x;
    const dy = worldY - this.player.y;
    const invDet = 1 / (this.player.planeX * this.player.dirY - this.player.dirX * this.player.planeY);
    const tx = invDet * (this.player.dirY * dx - this.player.dirX * dy);
    const ty = invDet * (-this.player.planeY * dx + this.player.planeX * dy);
    if (ty <= 0.1) return null;
    return {
      x: Math.floor((SCREEN_W / 2) * (1 + tx / ty)),
      y: Math.floor(SCREEN_H / 2 + SCREEN_H / ty * 0.1),
      dist: ty,
    };
  }

  private renderScene(): void {
    const halfH = (SCREEN_H >> 1) + Math.round(this.player.pitch + this.viewBob + this.damageFlash * 25);
    for (let y = 0; y < SCREEN_H; y++) {
      const rowStart = y * SCREEN_W;
      if (y < halfH) {
        const t = y / halfH;
        const t2 = t * t;
        const r = Math.floor(lerp(2, 18, t2) + lerp(0, 12, Math.sin(t * Math.PI)));
        const g = Math.floor(lerp(3, 16, t2) + lerp(0, 8, Math.sin(t * Math.PI)));
        const b = Math.floor(lerp(12, 42, t) + lerp(0, 18, Math.sin(t * Math.PI * 0.5)));
        const color = rgbToABGR(r, g, b);
        for (let x = 0; x < SCREEN_W; x++) this.buf[rowStart + x] = color;
      } else {
        const t = (y - halfH) / (SCREEN_H - halfH);
        const shade = 0.08 + (1 - t) * 0.22;
        const r = Math.floor(38 * shade + t * 4);
        const g = Math.floor(35 * shade + t * 2);
        const b = Math.floor(32 * shade);
        const color = rgbToABGR(r, g, b);
        for (let x = 0; x < SCREEN_W; x++) this.buf[rowStart + x] = color;
      }
    }

    this.castFloorCeiling(halfH);
    this.castWalls(halfH);
    this.renderSprites(halfH);
    this.addAtmospherePass(halfH);
    this.renderWeaponViewModel();
    this.postProcess();
    const ctx = this.renderTex.getContext();
    if (!ctx) throw new Error('Failed to acquire render context');
    ctx.putImageData(this.imageData, 0, 0);
  }

  private castFloorCeiling(halfH: number): void {
    const floorTex = this.textures_[7];
    const ceilTex = this.textures_[8];
    const rayDirX0 = this.player.dirX - this.player.planeX;
    const rayDirY0 = this.player.dirY - this.player.planeY;
    const rayDirX1 = this.player.dirX + this.player.planeX;
    const rayDirY1 = this.player.dirY + this.player.planeY;

    for (let y = 0; y < SCREEN_H; y++) {
      const isFloor = y > halfH;
      const p = isFloor ? y - halfH : halfH - y;
      if (p <= 0) continue;

      const camZ = isFloor ? this.player.z : 1 - this.player.z;
      const rowDistance = (SCREEN_H * camZ) / p;

      const stepX = rowDistance * (rayDirX1 - rayDirX0) / SCREEN_W;
      const stepY = rowDistance * (rayDirY1 - rayDirY0) / SCREEN_W;
      let floorX = this.player.x + rowDistance * rayDirX0;
      let floorY = this.player.y + rowDistance * rayDirY0;
      const fog = clamp(1 - rowDistance / MAX_VIEW_DIST, 0.05, 1);

      for (let x = 0; x < SCREEN_W; x++) {
        const tx = Math.floor(floorX * TEX_SIZE) & TEX_MASK;
        const ty = Math.floor(floorY * TEX_SIZE) & TEX_MASK;
        let rBoost = 0;
        let gBoost = 0;
        let bBoost = 0;
        
        for (const light of this.dynamicLights) {
          const dsq = distSq(light.x, light.y, floorX, floorY);
          if (dsq < light.radius * light.radius) {
            const falloff = 1 - Math.sqrt(dsq) / light.radius;
            rBoost += light.r * falloff;
            gBoost += light.g * falloff;
            bBoost += light.b * falloff;
          }
        }
        for (const zone of this.lightZones) {
          const dsq = distSq(zone.x, zone.y, floorX, floorY);
          if (dsq < zone.radius * zone.radius) {
            const falloff = 1 - Math.sqrt(dsq) / zone.radius;
            const flicker = zone.flicker ? 0.7 + this.flickerValues[zone._idx] * 0.3 : 1;
            rBoost += zone.r * falloff * flicker * 80;
            gBoost += zone.g * falloff * flicker * 80;
            bBoost += zone.b * falloff * flicker * 80;
          }
        }
        
        const pixel = isFloor ? floorTex[ty * TEX_SIZE + tx] : ceilTex[ty * TEX_SIZE + tx];
        const pixelR = pixel & 255;
        const pixelG = (pixel >> 8) & 255;
        const pixelB = (pixel >> 16) & 255;
        const luma = (pixelR * 0.299 + pixelG * 0.587 + pixelB * 0.114) / 255;
        const bumpFactor = 0.5 + luma * 1.5;
        const r = Math.min(255, pixelR * fog + rBoost * bumpFactor);
        const g = Math.min(255, pixelG * fog + gBoost * bumpFactor);
        const b = Math.min(255, pixelB * fog + bBoost * bumpFactor);
        this.buf[y * SCREEN_W + x] = rgbToABGR(r, g, b);

        floorX += stepX;
        floorY += stepY;
      }
    }
  }

  private castWalls(halfH: number): void {
    const tileTexture: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 6: 6 };
    for (let x = 0; x < SCREEN_W; x++) {
      const cameraX = (2 * x) / SCREEN_W - 1;
      const rayDirX = this.player.dirX + this.player.planeX * cameraX;
      const rayDirY = this.player.dirY + this.player.planeY * cameraX;
      let mapX = Math.floor(this.player.x);
      let mapY = Math.floor(this.player.y);
      const deltaDistX = Math.abs(1 / rayDirX);
      const deltaDistY = Math.abs(1 / rayDirY);
      let stepX = 0;
      let stepY = 0;
      let sideDistX = 0;
      let sideDistY = 0;
      let side = 0;
      if (rayDirX < 0) {
        stepX = -1;
        sideDistX = (this.player.x - mapX) * deltaDistX;
      } else {
        stepX = 1;
        sideDistX = (mapX + 1 - this.player.x) * deltaDistX;
      }
      if (rayDirY < 0) {
        stepY = -1;
        sideDistY = (this.player.y - mapY) * deltaDistY;
      } else {
        stepY = 1;
        sideDistY = (mapY + 1 - this.player.y) * deltaDistY;
      }

      let hit = false;
      let tile = 0;
      for (let index = 0; index < 64; index++) {
        if (sideDistX < sideDistY) {
          sideDistX += deltaDistX;
          mapX += stepX;
          side = 0;
        } else {
          sideDistY += deltaDistY;
          mapY += stepY;
          side = 1;
        }
        if (mapX < 0 || mapY < 0 || mapX >= this.mapW || mapY >= this.mapH) break;
        tile = this.levelMap[mapY][mapX];
        if (tile > 0 && tile !== 5) {
          if (tile === 9) {
            const door = this.doors[`${mapX},${mapY}`];
            if (door && door.open >= 0.95) continue;
          }
          hit = true;
          break;
        }
      }
      if (!hit) {
        this.zBuf[x] = MAX_VIEW_DIST;
        continue;
      }

      let perpWallDist = side === 0 ? sideDistX - deltaDistX : sideDistY - deltaDistY;
      if (perpWallDist < 0.01) perpWallDist = 0.01;
      this.zBuf[x] = perpWallDist;
      const lineHeight = Math.floor(SCREEN_H / perpWallDist);
      const drawStart = Math.max(0, Math.floor(-lineHeight * (1 - this.player.z) + halfH));
      const drawEnd = Math.min(SCREEN_H - 1, Math.floor(lineHeight * this.player.z + halfH));
      let wallX = side === 0 ? this.player.y + perpWallDist * rayDirY : this.player.x + perpWallDist * rayDirX;
      wallX -= Math.floor(wallX);
      let texX = Math.floor(wallX * TEX_SIZE) & TEX_MASK;
      if ((side === 0 && rayDirX > 0) || (side === 1 && rayDirY < 0)) texX = TEX_MASK - texX;

      let texIdx = tileTexture[tile] ?? 0;
      if (tile === 9) {
        const door = this.doors[`${mapX},${mapY}`];
        if (door?.color && !door.unlocked) texIdx = door.color === 'red' ? 11 : door.color === 'blue' ? 12 : 13;
        else texIdx = 4;
        if (door) {
          const shiftedX = texX + Math.floor(door.open * TEX_SIZE);
          if (shiftedX >= TEX_SIZE) {
            this.zBuf[x] = MAX_VIEW_DIST;
            continue;
          }
          texX = shiftedX;
        }
      } else if (tile === 5) {
        texIdx = 5;
      }

      const tex = this.textures_[texIdx];
      const step = TEX_SIZE / lineHeight;
      let texPos = (drawStart - halfH + lineHeight * (1 - this.player.z)) * step;
      const fog = clamp(1 - perpWallDist / MAX_VIEW_DIST, 0.08, 1);
      const sideFactor = side === 1 ? 0.7 : 1;
      const hitX = this.player.x + perpWallDist * rayDirX;
      const hitY = this.player.y + perpWallDist * rayDirY;
      let rBoost = 0;
      let gBoost = 0;
      let bBoost = 0;
      for (const light of this.dynamicLights) {
        const dsq = distSq(light.x, light.y, hitX, hitY);
        if (dsq < light.radius * light.radius) {
          const falloff = 1 - Math.sqrt(dsq) / light.radius;
          rBoost += light.r * falloff;
          gBoost += light.g * falloff;
          bBoost += light.b * falloff;
        }
      }
      for (const zone of this.lightZones) {
        const dsq = distSq(zone.x, zone.y, hitX, hitY);
        if (dsq < zone.radius * zone.radius) {
          const falloff = 1 - Math.sqrt(dsq) / zone.radius;
          const flicker = zone.flicker ? 0.7 + this.flickerValues[zone._idx] * 0.3 : 1;
          rBoost += zone.r * falloff * flicker * 80;
          gBoost += zone.g * falloff * flicker * 80;
          bBoost += zone.b * falloff * flicker * 80;
        }
      }
      for (let y = drawStart; y <= drawEnd; y++) {
        const texY = Math.floor(texPos) & TEX_MASK;
        texPos += step;
        const pixel = tex[texY * TEX_SIZE + texX];
        const shade = fog * sideFactor;
        const pixelR = pixel & 255;
        const pixelG = (pixel >> 8) & 255;
        const pixelB = (pixel >> 16) & 255;
        const luma = (pixelR * 0.299 + pixelG * 0.587 + pixelB * 0.114) / 255;
        const bumpFactor = 0.5 + luma * 1.5;
        const r = Math.min(255, pixelR * shade + rBoost * bumpFactor);
        const g = Math.min(255, pixelG * shade + gBoost * bumpFactor);
        const b = Math.min(255, pixelB * shade + bBoost * bumpFactor);
        this.buf[y * SCREEN_W + x] = rgbToABGR(r, g, b);
      }
    }
  }

  private renderSprites(halfH: number): void {
    const pickupGlowMap: Record<PickupRuntime['type'], { r: number; g: number; b: number; alpha: number; scale: number }> = {
      health: { r: 255, g: 96, b: 96, alpha: 0.12, scale: 0.36 },
      ammo: { r: 255, g: 190, b: 90, alpha: 0.1, scale: 0.32 },
      armor: { r: 95, g: 180, b: 255, alpha: 0.12, scale: 0.34 },
      shotgun: { r: 255, g: 165, b: 90, alpha: 0.1, scale: 0.36 },
      machinegun: { r: 110, g: 220, b: 255, alpha: 0.12, scale: 0.36 },
      plasma: { r: 80, g: 210, b: 255, alpha: 0.16, scale: 0.42 },
      keyRed: { r: 255, g: 90, b: 90, alpha: 0.12, scale: 0.32 },
      keyBlue: { r: 90, g: 150, b: 255, alpha: 0.12, scale: 0.32 },
      keyYellow: { r: 255, g: 220, b: 95, alpha: 0.12, scale: 0.32 },
    };
    const propGlowMap: Partial<Record<PropRuntime['type'], { r: number; g: number; b: number; alpha: number; scale: number }>> = {
      terminal: { r: 72, g: 210, b: 255, alpha: 0.11, scale: 0.34 },
      lamp: { r: 255, g: 210, b: 120, alpha: 0.12, scale: 0.32 },
    };
    const sprites: Array<{
      x: number;
      y: number;
      dist: number;
      sprite: PixelSprite;
      bob: number;
      scale: number;
      flash: number;
      shadowScale: number;
      shadowAlpha: number;
      glow?: { r: number; g: number; b: number; alpha: number; scale: number };
    }> = [];

    for (const enemy of this.enemies) {
      const sprite = enemy.dead
        ? this.sprites_.enemyDead
        : enemy.archetype === 'trooper'
          ? (enemy.hurtTimer > 0 ? this.sprites_.trooperHurt : this.sprites_.trooper)
          : enemy.archetype === 'stalker'
            ? (enemy.hurtTimer > 0 ? this.sprites_.stalkerHurt : this.sprites_.stalker)
            : enemy.archetype === 'drone'
              ? (enemy.hurtTimer > 0 ? this.sprites_.droneHurt : this.sprites_.drone)
              : enemy.archetype === 'bruiser'
                ? (enemy.hurtTimer > 0 ? this.sprites_.bruiserHurt : this.sprites_.bruiser)
                : (enemy.hurtTimer > 0 ? this.sprites_.bossHurt : this.sprites_.boss);
      sprites.push({
        x: enemy.x,
        y: enemy.y,
        dist: distSq(enemy.x, enemy.y, this.player.x, this.player.y),
        sprite,
        bob: enemy.archetype === 'drone' ? Math.sin(this.elapsedTime * 3 + enemy.bobOffset) * 0.1 : 0,
        scale: enemy.dead ? 0.5 : enemy.archetype === 'boss' ? 1.28 : enemy.archetype === 'bruiser' ? 1.05 : enemy.archetype === 'drone' ? 0.55 : 0.82,
        flash: enemy.muzzleTimer,
        shadowScale: enemy.dead ? 0.22 : enemy.archetype === 'boss' ? 0.42 : enemy.archetype === 'bruiser' ? 0.34 : enemy.archetype === 'drone' ? 0.18 : 0.28,
        shadowAlpha: enemy.dead ? 0.15 : enemy.archetype === 'drone' ? 0.12 : 0.24,
        glow: enemy.archetype === 'drone'
          ? { r: 72, g: 200, b: 255, alpha: 0.09, scale: 0.28 }
          : enemy.archetype === 'boss'
            ? { r: 255, g: 80, b: 80, alpha: enemy.hurtTimer > 0 ? 0.13 : 0.08, scale: 0.3 }
            : undefined,
      });
    }

    for (const pickup of this.pickups) {
      if (pickup.collected) continue;
      const sprite =
        pickup.type === 'health' ? this.sprites_.health :
        pickup.type === 'ammo' ? this.sprites_.ammo :
        pickup.type === 'shotgun' ? this.sprites_.shotgunPickup :
        pickup.type === 'machinegun' ? this.sprites_.machinegunPickup :
        pickup.type === 'plasma' ? this.sprites_.plasmaPickup :
        pickup.type === 'armor' ? this.sprites_.armor :
        pickup.type === 'keyRed' ? this.sprites_.keyRed :
        pickup.type === 'keyBlue' ? this.sprites_.keyBlue :
        this.sprites_.keyYellow;
      sprites.push({
        x: pickup.x,
        y: pickup.y,
        dist: distSq(pickup.x, pickup.y, this.player.x, this.player.y),
        sprite,
        bob: Math.sin(this.elapsedTime * 3 + pickup.x) * 0.1,
        scale: 0.5,
        flash: 0,
        shadowScale: 0.16,
        shadowAlpha: 0.12,
        glow: pickupGlowMap[pickup.type],
      });
    }

    for (const barrel of this.barrels) {
      sprites.push({
        x: barrel.x,
        y: barrel.y,
        dist: distSq(barrel.x, barrel.y, this.player.x, this.player.y),
        sprite: barrel.exploded ? this.sprites_.barrelBroken : this.sprites_.barrel,
        bob: 0,
        scale: barrel.exploded ? 0.6 : 0.72,
        flash: barrel.blastTimer,
        shadowScale: barrel.exploded ? 0.24 : 0.28,
        shadowAlpha: 0.22,
        glow: barrel.blastTimer > 0 ? { r: 255, g: 130, b: 48, alpha: barrel.blastTimer * 0.18, scale: 0.3 } : undefined,
      });
    }

    for (const generator of this.generators) {
      if (!generator.active && !generator.destroyed) continue;
      sprites.push({
        x: generator.x,
        y: generator.y,
        dist: distSq(generator.x, generator.y, this.player.x, this.player.y),
        sprite: generator.destroyed ? this.sprites_.generatorOff : this.sprites_.generatorOn,
        bob: Math.sin(this.elapsedTime * 2 + generator.x) * 0.03,
        scale: 0.72,
        flash: generator.destroyed ? 0 : 0.2,
        shadowScale: 0.28,
        shadowAlpha: 0.24,
        glow: generator.destroyed ? { r: 90, g: 110, b: 140, alpha: 0.05, scale: 0.26 } : { r: 72, g: 205, b: 255, alpha: 0.15, scale: 0.34 },
      });
    }

    for (const checkpoint of LEVELS[this.currentLevel].checkpoints) {
      sprites.push({
        x: checkpoint.beacon.x,
        y: checkpoint.beacon.y,
        dist: distSq(checkpoint.beacon.x, checkpoint.beacon.y, this.player.x, this.player.y),
        sprite: checkpoint.id === this.activeCheckpointId ? this.sprites_.checkpointActive : this.sprites_.checkpoint,
        bob: Math.sin(this.elapsedTime * 2 + checkpoint.beacon.x) * 0.03,
        scale: 0.56,
        flash: checkpoint.id === this.activeCheckpointId ? 0.2 : 0,
        shadowScale: 0.18,
        shadowAlpha: 0.14,
        glow: checkpoint.id === this.activeCheckpointId
          ? { r: 110, g: 255, b: 170, alpha: 0.13, scale: 0.36 }
          : { r: 85, g: 200, b: 255, alpha: 0.08, scale: 0.3 },
      });
    }

    const propSpriteMap: Record<string, string> = {
      crate: 'propCrate', crateStack: 'propCrateStack', terminal: 'propTerminal',
      pipes: 'propPipes', debris: 'propDebris', column: 'propColumn', lamp: 'propLamp',
    };
    const propScaleMap: Record<string, number> = {
      crate: 0.5, crateStack: 0.7, terminal: 0.6, pipes: 0.7, debris: 0.35, column: 0.85, lamp: 0.55,
    };
    for (const p of this.props) {
      const spriteKey = propSpriteMap[p.type];
      const spr = spriteKey ? this.sprites_[spriteKey] : undefined;
      if (!spr) continue;
      const isLamp = p.type === 'lamp';
      const isTerminal = p.type === 'terminal';
      sprites.push({
        x: p.x,
        y: p.y,
        dist: distSq(p.x, p.y, this.player.x, this.player.y),
        sprite: spr,
        bob: isLamp ? Math.sin(this.elapsedTime * 1.5 + p.x * 3) * 0.02 : 0,
        scale: propScaleMap[p.type] ?? 0.5,
        flash: isLamp ? 0.15 : isTerminal ? 0.08 : 0,
        shadowScale: p.type === 'column' ? 0.32 : p.type === 'debris' ? 0.2 : 0.26,
        shadowAlpha: p.type === 'debris' ? 0.18 : 0.22,
        glow: propGlowMap[p.type],
      });
    }

    for (const projectile of this.plasmaProjectiles) {
      sprites.push({
        x: projectile.x,
        y: projectile.y,
        dist: distSq(projectile.x, projectile.y, this.player.x, this.player.y),
        sprite: this.sprites_.plasma,
        bob: 0,
        scale: 0.3,
        flash: 0.5,
        shadowScale: 0.1,
        shadowAlpha: 0.08,
        glow: { r: 95, g: 210, b: 255, alpha: 0.18, scale: 0.52 },
      });
    }

    sprites.sort((a, b) => b.dist - a.dist);

    const invDet = 1 / (this.player.planeX * this.player.dirY - this.player.dirX * this.player.planeY);
    for (const sprite of sprites) {
      const sx = sprite.x - this.player.x;
      const sy = sprite.y - this.player.y;
      const transformX = invDet * (this.player.dirY * sx - this.player.dirX * sy);
      const transformY = invDet * (-this.player.planeY * sx + this.player.planeX * sy);
      if (transformY <= 0.2) continue;
      const spriteScreenX = Math.floor((SCREEN_W / 2) * (1 + transformX / transformY));
      const spriteHeight = Math.abs(Math.floor(SCREEN_H / transformY * sprite.scale));
      const spriteWidth = Math.abs(Math.floor(SCREEN_H / transformY * sprite.scale * (sprite.sprite.w / sprite.sprite.h)));
      const bobOffset = Math.floor(sprite.bob * SCREEN_H / transformY);
      const zOffset = Math.floor((this.player.z - 0.5) * SCREEN_H / transformY);
      const drawStartY = Math.max(0, Math.floor(-spriteHeight / 2 + halfH - bobOffset + zOffset));
      const drawEndY = Math.min(SCREEN_H - 1, Math.floor(spriteHeight / 2 + halfH - bobOffset + zOffset));
      const drawStartX = Math.max(0, Math.floor(spriteScreenX - spriteWidth / 2));
      const drawEndX = Math.min(SCREEN_W - 1, Math.floor(spriteScreenX + spriteWidth / 2));
      const fog = clamp(1 - Math.sqrt(sprite.dist) / MAX_VIEW_DIST, 0.1, 1);
      let rBoost = 0;
      let gBoost = 0;
      let bBoost = 0;
      for (const light of this.dynamicLights) {
        const dsq = distSq(light.x, light.y, sprite.x, sprite.y);
        if (dsq < light.radius * light.radius * 1.5) {
          const falloff = 1 - Math.sqrt(dsq) / (light.radius * 1.2);
          rBoost += light.r * falloff;
          gBoost += light.g * falloff;
          bBoost += light.b * falloff;
        }
      }
      const flashBoost = sprite.flash ? 1 + sprite.flash * 2.2 : 1;
      const shadowY = Math.min(SCREEN_H - 2, drawEndY + Math.max(0, Math.floor(Math.abs(bobOffset) * 0.9)));
      if (sprite.shadowAlpha > 0) {
        this.drawSpriteShadow(
          spriteScreenX,
          shadowY,
          Math.max(2, Math.floor(spriteWidth * sprite.shadowScale)),
          Math.max(1, Math.floor(spriteHeight * sprite.shadowScale * 0.2)),
          transformY,
          fog * sprite.shadowAlpha,
        );
      }
      if (sprite.glow) {
        this.drawSpriteGlow(
          spriteScreenX,
          Math.floor((drawStartY + drawEndY) * 0.5),
          Math.max(3, Math.floor(spriteWidth * sprite.glow.scale)),
          Math.max(3, Math.floor(spriteHeight * sprite.glow.scale)),
          transformY,
          sprite.glow.r,
          sprite.glow.g,
          sprite.glow.b,
          fog * sprite.glow.alpha * flashBoost,
        );
      }
      const numSlices = sprite.scale > 0.8 ? 6 : 4;
      const shiftX = ((spriteScreenX - SCREEN_W / 2) / (SCREEN_W / 2)) * 8 / Math.max(1, transformY);
      const shiftY = (this.player.pitch / 25) * 4 / Math.max(1, transformY);

      for (let layer = numSlices - 1; layer >= 0; layer--) {
        const isFront = layer === 0;
        const lx = Math.round(shiftX * layer);
        const ly = Math.round(shiftY * layer);

        for (let x = drawStartX; x <= drawEndX; x++) {
          const screenX = x + lx;
          if (screenX < 0 || screenX >= SCREEN_W) continue;
          if (transformY >= this.zBuf[screenX]) continue;
          const texX = Math.floor((x - (spriteScreenX - spriteWidth / 2)) * sprite.sprite.w / spriteWidth);
          if (texX < 0 || texX >= sprite.sprite.w) continue;

          for (let y = drawStartY; y <= drawEndY; y++) {
            const screenY = y + ly;
            if (screenY < 0 || screenY >= SCREEN_H) continue;
            const texY = Math.floor((y - drawStartY) * sprite.sprite.h / (drawEndY - drawStartY + 1));
            const pixel = sprite.sprite.data[texY * sprite.sprite.w + texX];
            if (!pixel) continue;

            let r = Math.min(255, (pixel & 255) * fog * flashBoost + rBoost);
            let g = Math.min(255, ((pixel >> 8) & 255) * fog * flashBoost + gBoost);
            let b = Math.min(255, ((pixel >> 16) & 255) * fog * flashBoost + bBoost);

            if (!isFront) {
               r = Math.max(0, r - 45);
               g = Math.max(0, g - 45);
               b = Math.max(0, b - 45);
            }
            this.buf[screenY * SCREEN_W + screenX] = rgbToABGR(r, g, b);
          }
        }
      }
    }
  }

  private darkenPixel(index: number, amount: number): void {
    const pixel = this.buf[index];
    const factor = clamp(1 - amount, 0.08, 1);
    this.buf[index] = rgbToABGR(
      (pixel & 255) * factor,
      ((pixel >> 8) & 255) * factor,
      ((pixel >> 16) & 255) * factor,
    );
  }

  private addPixelLight(index: number, r: number, g: number, b: number, amount: number): void {
    const pixel = this.buf[index];
    this.buf[index] = rgbToABGR(
      Math.min(255, (pixel & 255) + r * amount),
      Math.min(255, ((pixel >> 8) & 255) + g * amount),
      Math.min(255, ((pixel >> 16) & 255) + b * amount),
    );
  }

  private drawSpriteShadow(centerX: number, centerY: number, radiusX: number, radiusY: number, depth: number, alpha: number): void {
    if (radiusX <= 0 || radiusY <= 0 || alpha <= 0) return;
    const startX = Math.max(0, centerX - radiusX);
    const endX = Math.min(SCREEN_W - 1, centerX + radiusX);
    const startY = Math.max(0, centerY - radiusY);
    const endY = Math.min(SCREEN_H - 1, centerY + radiusY);
    for (let x = startX; x <= endX; x++) {
      if (depth >= this.zBuf[x]) continue;
      const nx = (x - centerX) / radiusX;
      const xFactor = 1 - nx * nx;
      if (xFactor <= 0) continue;
      for (let y = startY; y <= endY; y++) {
        const ny = (y - centerY) / radiusY;
        const falloff = xFactor - ny * ny;
        if (falloff <= 0) continue;
        this.darkenPixel(y * SCREEN_W + x, alpha * falloff * 0.75);
      }
    }
  }

  private drawSpriteGlow(centerX: number, centerY: number, radiusX: number, radiusY: number, depth: number, r: number, g: number, b: number, alpha: number): void {
    if (radiusX <= 0 || radiusY <= 0 || alpha <= 0) return;
    const startX = Math.max(0, centerX - radiusX);
    const endX = Math.min(SCREEN_W - 1, centerX + radiusX);
    const startY = Math.max(0, centerY - radiusY);
    const endY = Math.min(SCREEN_H - 1, centerY + radiusY);
    for (let x = startX; x <= endX; x++) {
      if (depth >= this.zBuf[x]) continue;
      const nx = (x - centerX) / radiusX;
      const xFactor = 1 - nx * nx;
      if (xFactor <= 0) continue;
      for (let y = startY; y <= endY; y++) {
        const ny = (y - centerY) / radiusY;
        const falloff = xFactor - ny * ny;
        if (falloff <= 0) continue;
        this.addPixelLight(y * SCREEN_W + x, r, g, b, alpha * falloff * falloff);
      }
    }
  }

  private addScreenGlow(centerX: number, centerY: number, radius: number, r: number, g: number, b: number, alpha: number): void {
    if (radius <= 0 || alpha <= 0) return;
    const startX = Math.max(0, Math.floor(centerX - radius));
    const endX = Math.min(SCREEN_W - 1, Math.ceil(centerX + radius));
    const startY = Math.max(0, Math.floor(centerY - radius));
    const endY = Math.min(SCREEN_H - 1, Math.ceil(centerY + radius));
    for (let x = startX; x <= endX; x++) {
      const nx = (x - centerX) / radius;
      const xFactor = 1 - nx * nx;
      if (xFactor <= 0) continue;
      for (let y = startY; y <= endY; y++) {
        const ny = (y - centerY) / radius;
        const falloff = xFactor - ny * ny;
        if (falloff <= 0) continue;
        this.addPixelLight(y * SCREEN_W + x, r, g, b, alpha * falloff * falloff);
      }
    }
  }

  private addAtmospherePass(halfH: number): void {
    const band = 64;
    const yStart = Math.max(0, halfH - band);
    const yEnd = Math.min(SCREEN_H - 1, halfH + band);
    const warmBias = this.escapeTimer !== null ? 18 : this.extractionUnlocked ? 10 : 5;
    for (let y = yStart; y <= yEnd; y++) {
      const normalized = 1 - Math.abs(y - halfH) / band;
      if (normalized <= 0) continue;
      const haze = normalized * normalized * 0.14;
      for (let x = 0; x < SCREEN_W; x++) {
        const wave = 0.82 + Math.sin(x * 0.024 + y * 0.018 + this.elapsedTime * 1.4) * 0.18;
        this.addPixelLight(
          y * SCREEN_W + x,
          warmBias * 0.8,
          14 * wave + warmBias * 0.18,
          24 * wave,
          haze,
        );
      }
    }
  }

  private renderWeaponViewModel(): void {
    const frame = this.weaponAnim.firing && this.weaponAnim.frame === 1 ? 1 : this.weaponAnim.reloading ? 2 : 0;
    const sprite = this.sprites_[`${this.player.weapon}VM${frame}`];
    if (!sprite) return;
    const bobX = Math.sin(this.walkCycle) * (this.isSprinting ? 6 : 4);
    const bobY = Math.abs(Math.cos(this.walkCycle)) * (this.isSprinting ? 6 : 4);
    const sway = (this.player.dirX - this.lastMouseRot) * 2000;
    this.lastMouseRot = this.player.dirX;
    this.swayAmount = lerp(this.swayAmount, clamp(sway, -20, 20), 0.1);
    const recoil = this.weaponAnim.recoil;
    const reloadArc = this.weaponAnim.reloading && this.weaponAnim.reloadDuration > 0
      ? Math.sin((1 - this.weaponAnim.reloadTimer / this.weaponAnim.reloadDuration) * Math.PI) * 18
      : 0;
    let offsetY = 0;
    if (this.weaponAnim.switching) {
      const t = 1 - this.weaponAnim.switchTimer / 0.28;
      offsetY = t < 0.5 ? t * 70 : (1 - t) * 70;
    }
    const destX = Math.round(SCREEN_W / 2 - 64 + bobX + this.swayAmount + (this.isSprinting ? 10 : 0));
    const destY = Math.round(SCREEN_H - 128 + bobY + offsetY + recoil * 1.1 + reloadArc);
    for (let sy = 0; sy < sprite.h; sy++) {
      const shadowY = destY + sy + 16;
      if (shadowY < 0 || shadowY >= SCREEN_H) continue;
      for (let sx = 0; sx < sprite.w; sx++) {
        const shadowX = destX + sx + 12;
        if (shadowX < 0 || shadowX >= SCREEN_W) continue;
        const pixel = sprite.data[sy * sprite.w + sx];
        if (pixel) this.darkenPixel(shadowY * SCREEN_W + shadowX, 0.3);
      }
    }
    const numLayers = 12;
    for (let layer = 0; layer < numLayers; layer++) {
      const isTopLayer = layer === numLayers - 1;
      const pitchOffset = (this.player.pitch / 25) * (numLayers - 1 - layer);
      const swayOff = (this.swayAmount / 20) * (numLayers - 1 - layer);
      const layerDY = destY + pitchOffset;
      const layerDX = destX + swayOff;

      for (let sy = 0; sy < sprite.h; sy++) {
        const dy = Math.round(layerDY + sy);
        if (dy < 0 || dy >= SCREEN_H) continue;
        for (let sx = 0; sx < sprite.w; sx++) {
          const dx = Math.round(layerDX + sx);
          if (dx < 0 || dx >= SCREEN_W) continue;
          let pixel = sprite.data[sy * sprite.w + sx];
          if (!pixel) continue;
          
          if (!isTopLayer) {
             const r = Math.max(0, (pixel & 0xFF) - 60);
             const g = Math.max(0, ((pixel >> 8) & 0xFF) - 60);
             const b = Math.max(0, ((pixel >> 16) & 0xFF) - 60);
             pixel = (pixel & 0xFF000000) | (b << 16) | (g << 8) | r;
          }
          this.buf[dy * SCREEN_W + dx] = pixel;
        }
      }
    }
    if (frame === 1) {
      const muzzleByWeapon: Record<WeaponKey, { x: number; y: number; radius: number; r: number; g: number; b: number; alpha: number }> = {
        pistol: { x: 58, y: 12, radius: 60, r: 255, g: 170, b: 84, alpha: 0.18 },
        shotgun: { x: 56, y: 2, radius: 78, r: 255, g: 180, b: 90, alpha: 0.24 },
        machinegun: { x: 60, y: 0, radius: 58, r: 255, g: 180, b: 92, alpha: 0.16 },
        plasma: { x: 64, y: -4, radius: 86, r: 110, g: 220, b: 255, alpha: 0.22 },
      };
      const muzzle = muzzleByWeapon[this.player.weapon];
      this.addScreenGlow(destX + muzzle.x, destY + muzzle.y, muzzle.radius, muzzle.r, muzzle.g, muzzle.b, muzzle.alpha);
    }
  }

  private postProcess(): void {
    for (let index = 0; index < SCREEN_W * SCREEN_H; index++) {
      const pixel = this.buf[index];
      let r = pixel & 255;
      let g = (pixel >> 8) & 255;
      let b = (pixel >> 16) & 255;
      const vignette = this.vignetteTable[index];
      r = this.colorLut[Math.round(r * vignette)];
      g = this.colorLut[Math.round(g * vignette)];
      b = this.colorLut[Math.round(b * vignette)];

      // Subtle blue-tint in dark areas for atmosphere
      const lum = (r + g + b) / 3;
      if (lum < 50) {
        const boost = (50 - lum) * 0.04;
        b = Math.min(255, Math.round(b + boost * 10));
      }

      // Static film grain (position-based only, no flicker)
      const grain = ((index * 1103515245 + 12345) >> 17) & 3;
      r = clamp(r + grain - 1, 0, 255);
      g = clamp(g + grain - 1, 0, 255);
      b = clamp(b + grain - 1, 0, 255);

      this.buf[index] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
  }

  private updateHud(dt: number): void {
    const weapon = WEAPONS[this.player.weapon];
    const objective = this.getCurrentObjective();
    const objectiveTarget = this.getObjectiveTarget();
    const objectiveDistance = Math.round(Math.sqrt(distSq(this.player.x, this.player.y, objectiveTarget.x, objectiveTarget.y)) * 8);
    const objectiveDesc = this.escapeTimer !== null
      ? `${objective.description} ${formatTime(this.escapeTimer)} left.`
      : objective.description;
    const snapshot: HudSnapshot = {
      actTitle: LEVELS[this.currentLevel].actTitle,
      levelName: LEVELS[this.currentLevel].name,
      objectiveLabel: objective.label,
      objectiveDescription: objectiveDesc,
      message: this.messageText,
      messageAlpha: this.messageTimer > 0 ? Math.min(1, this.messageTimer * 2) : 0,
      prompt: this.contextPrompt,
      promptVisible: Boolean(this.contextPrompt),
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      armor: this.player.armor,
      maxArmor: this.player.maxArmor,
      stamina: this.player.stamina,
      maxStamina: this.player.maxStamina,
      ammoInMag: this.player.ammo[this.player.weapon],
      ammoReserve: this.player.totalAmmo[this.player.weapon],
      weaponName: this.weaponAnim.reloading ? `${weapon.name} // Reloading` : this.weaponAnim.switching ? `${weapon.name} // Swap` : weapon.name,
      weaponRole: weapon.role,
      ammoRatio: weapon.magSize > 0 ? this.player.ammo[this.player.weapon] / weapon.magSize : 0,
      reserveRatio: weapon.maxAmmo > 0 ? this.player.totalAmmo[this.player.weapon] / weapon.maxAmmo : 0,
      threatLevel: this.getThreatLevel(),
      objectiveDistance,
      time: formatTime(this.elapsedTime),
      accuracy: this.getAccuracy(),
      dashReady: this.player.dashCooldown <= 0,
      meleeReady: this.player.meleeCooldown <= 0,
      keys: { ...this.player.keys },
      fps: this.currentFps,
      showFps: this.settings.showFps,
      damageOverlay: this.damageFlash > 0
        ? this.damageDir === -1 
          ? `linear-gradient(to right, rgba(200, 0, 0, ${this.damageFlash * 0.8}) 0%, transparent 40%)`
          : this.damageDir === 1
            ? `linear-gradient(to left, rgba(200, 0, 0, ${this.damageFlash * 0.8}) 0%, transparent 40%)`
            : `radial-gradient(circle, transparent 25%, rgba(200, 0, 0, ${this.damageFlash * 0.8}) 100%)`
        : this.player.health < 35
          ? `radial-gradient(circle, transparent 40%, rgba(180, 20, 20, ${0.12 + Math.sin(this.objectivePulse * 2.6) * 0.08}) 100%)`
          : 'rgba(0,0,0,0)',
    };
    this.hooks.ui.updateHud(snapshot);
    this.drawCrosshair();
    this.drawObjectiveArrow();
    this.drawMinimap();
    this.drawParticles();
    this.messageTimer = Math.max(0, this.messageTimer - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt);
  }

  private getThreatLevel(): string {
    const nearby = this.enemies.filter((enemy) => !enemy.dead && distSq(enemy.x, enemy.y, this.player.x, this.player.y) < 9 * 9);
    const aggressive = nearby.filter((enemy) => enemy.state === 'chase' || enemy.state === 'windup' || enemy.state === 'charge');
    const bossActive = nearby.some((enemy) => enemy.archetype === 'boss');
    if (bossActive) return 'Overseer engaged';
    if (aggressive.length >= 5 || nearby.length >= 7) return 'Swarm contact';
    if (aggressive.length >= 3 || nearby.length >= 4) return 'Heavy contact';
    if (aggressive.length >= 1 || nearby.length >= 1) return 'Contact ahead';
    return 'Sector clear';
  }

  private drawCrosshair(): void {
    this.hudCrosshair.clear();
    if (!this.settings.showCrosshair) return;
    const cx = SCREEN_W / 2;
    const cy = SCREEN_H / 2;
    const gap = 4 + this.crosshairSpread + (this.isSprinting ? 2 : 0);
    const len = 8;
    const isHit = this.hitMarkerTimer > 0;
    const color = isHit ? 0xff4444 : 0xe0ecff;
    const alpha = this.pointerLocked ? 0.9 : 0.3;
    // Outer shadow for visibility against bright backgrounds
    this.hudCrosshair.lineStyle(3, 0x000000, alpha * 0.3);
    this.hudCrosshair.lineBetween(cx - gap - len, cy, cx - gap, cy);
    this.hudCrosshair.lineBetween(cx + gap, cy, cx + gap + len, cy);
    this.hudCrosshair.lineBetween(cx, cy - gap - len, cx, cy - gap);
    this.hudCrosshair.lineBetween(cx, cy + gap, cx, cy + gap + len);
    // Main crosshair lines
    this.hudCrosshair.lineStyle(1.5, color, alpha);
    this.hudCrosshair.lineBetween(cx - gap - len, cy, cx - gap, cy);
    this.hudCrosshair.lineBetween(cx + gap, cy, cx + gap + len, cy);
    this.hudCrosshair.lineBetween(cx, cy - gap - len, cx, cy - gap);
    this.hudCrosshair.lineBetween(cx, cy + gap, cx, cy + gap + len);
    // Center dot with glow
    this.hudCrosshair.fillStyle(color, alpha * 0.4);
    this.hudCrosshair.fillCircle(cx, cy, 3);
    this.hudCrosshair.fillStyle(color, alpha);
    this.hudCrosshair.fillCircle(cx, cy, 1);
    // Hit marker X
    if (isHit) {
      const hAlpha = this.hitMarkerTimer * 6;
      this.hudCrosshair.lineStyle(2.5, 0xffffff, hAlpha);
      this.hudCrosshair.lineBetween(cx - 8, cy - 8, cx - 3, cy - 3);
      this.hudCrosshair.lineBetween(cx + 8, cy - 8, cx + 3, cy - 3);
      this.hudCrosshair.lineBetween(cx - 8, cy + 8, cx - 3, cy + 3);
      this.hudCrosshair.lineBetween(cx + 8, cy + 8, cx + 3, cy + 3);
      // Red glow pulse on hit
      this.hudCrosshair.fillStyle(0xff2222, hAlpha * 0.2);
      this.hudCrosshair.fillCircle(cx, cy, 12 * hAlpha);
    }
  }

  private drawObjectiveArrow(): void {
    this.hudCompass.clear();
    const target = this.getObjectiveTarget();
    const playerAngle = Math.atan2(this.player.dirY, this.player.dirX);
    const targetAngle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
    const diff = normalizeAngle(targetAngle - playerAngle);
    const x = SCREEN_W / 2 + clamp(diff / 1.2, -1, 1) * 110;
    const y = 52;
    const pulse = 0.75 + Math.sin(this.objectivePulse * 1.8) * 0.18;
    const color = this.escapeTimer !== null || this.extractionUnlocked ? 0x61ffab : 0xff6767;
    this.hudCompass.lineStyle(1, color, 0.35);
    this.hudCompass.lineBetween(SCREEN_W / 2, y + 8, x, y);
    this.hudCompass.fillStyle(color, pulse);
    this.hudCompass.fillTriangle(x, y + 8, x - 7, y - 6, x + 7, y - 6);
  }

  private drawMinimap(): void {
    this.minimapBg.clear();
    this.minimap.clear();
    const mmScale = 3.5;
    const mmSize = 96;
    const ox = SCREEN_W - mmSize - 8;
    const oy = 8;
    this.minimapBg.fillStyle(0x020810, 0.65);
    this.minimapBg.fillRect(ox - 4, oy - 4, mmSize + 8, mmSize + 8);
    this.minimapBg.lineStyle(1, 0x00e5ff, 0.25);
    this.minimapBg.strokeRect(ox - 4, oy - 4, mmSize + 8, mmSize + 8);
    // Corner brackets
    const c = 6;
    this.minimapBg.lineStyle(1.5, 0x00e5ff, 0.45);
    this.minimapBg.lineBetween(ox - 4, oy - 4, ox - 4 + c, oy - 4);
    this.minimapBg.lineBetween(ox - 4, oy - 4, ox - 4, oy - 4 + c);
    this.minimapBg.lineBetween(ox + mmSize + 4, oy - 4, ox + mmSize + 4 - c, oy - 4);
    this.minimapBg.lineBetween(ox + mmSize + 4, oy - 4, ox + mmSize + 4, oy - 4 + c);
    this.minimapBg.lineBetween(ox - 4, oy + mmSize + 4, ox - 4 + c, oy + mmSize + 4);
    this.minimapBg.lineBetween(ox - 4, oy + mmSize + 4, ox - 4, oy + mmSize + 4 - c);
    this.minimapBg.lineBetween(ox + mmSize + 4, oy + mmSize + 4, ox + mmSize + 4 - c, oy + mmSize + 4);
    this.minimapBg.lineBetween(ox + mmSize + 4, oy + mmSize + 4, ox + mmSize + 4, oy + mmSize + 4 - c);

    const halfCells = mmSize / (2 * mmScale);
    for (let my = 0; my < this.mapH; my++) {
      for (let mx = 0; mx < this.mapW; mx++) {
        const sx = ox + (mx - this.player.x + halfCells) * mmScale;
        const sy = oy + (my - this.player.y + halfCells) * mmScale;
        if (sx < ox || sy < oy || sx > ox + mmSize || sy > oy + mmSize) continue;
        const tile = this.levelMap[my][mx];
        if (tile > 0 && tile !== 5 && tile !== 9) {
          this.minimap.fillStyle(0x3a4862, 0.85);
          this.minimap.fillRect(sx, sy, mmScale, mmScale);
        } else if (tile === 9) {
          const door = this.doors[`${mx},${my}`];
          this.minimap.fillStyle(door?.arenaLocked ? 0xff5f5f : door?.open && door.open > 0.75 ? 0x4bc27f : 0xffc061, 0.8);
          this.minimap.fillRect(sx, sy, mmScale, mmScale);
        }
      }
    }
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const ex = ox + (enemy.x - this.player.x + halfCells) * mmScale;
      const ey = oy + (enemy.y - this.player.y + halfCells) * mmScale;
      this.minimap.fillStyle(enemy.archetype === 'boss' ? 0xff3d4f : enemy.archetype === 'drone' ? 0x00e5ff : 0xff5555, 0.95);
      this.minimap.fillCircle(ex, ey, enemy.archetype === 'boss' ? 2.5 : 1.5);
    }
    for (const generator of this.generators) {
      if (!generator.active || generator.destroyed) continue;
      const gx = ox + (generator.x - this.player.x + halfCells) * mmScale;
      const gy = oy + (generator.y - this.player.y + halfCells) * mmScale;
      this.minimap.fillStyle(0x6bf2ff, 0.95);
      this.minimap.fillRect(gx - 1.5, gy - 1.5, 3, 3);
    }
    const target = this.getObjectiveTarget();
    const tx = ox + (target.x - this.player.x + halfCells) * mmScale;
    const ty = oy + (target.y - this.player.y + halfCells) * mmScale;
    this.minimap.lineStyle(1, this.extractionUnlocked ? 0x61ffab : 0xffd46b, 0.85);
    this.minimap.strokeCircle(tx, ty, 3);

    const px = ox + halfCells * mmScale;
    const py = oy + halfCells * mmScale;
    this.minimap.fillStyle(0xffffff, 1);
    this.minimap.fillCircle(px, py, 2);
    this.minimap.lineStyle(1, 0xffffff, 0.8);
    this.minimap.lineBetween(px, py, px + this.player.dirX * 5, py + this.player.dirY * 5);
  }

  private drawParticles(): void {
    this.fxGfx.clear();
    const halfH = (SCREEN_H >> 1) + Math.round(this.player.pitch + this.viewBob + this.damageFlash * 25);

    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      const screen = this.worldToScreen(p.x, p.y);
      if (!screen || screen.dist <= 0.1) continue;

      // Project the Z height onto screen Y
      const zOffset = Math.floor((this.player.z - p.z) * SCREEN_H / screen.dist);
      const sx = screen.x;
      const sy = halfH + zOffset;
      const scale = clamp(1 / screen.dist, 0.3, 3);
      const ps = Math.max(1, p.size * scale);

      switch (p.type) {
        case 'tracer': {
          // For tracers: project start and end in world space
          if (p.tx !== undefined && p.ty !== undefined) {
            const endScreen = this.worldToScreen(p.tx!, p.ty!);
            if (endScreen) {
              const eZOffset = Math.floor((this.player.z - (p.tz ?? p.z)) * SCREEN_H / endScreen.dist);
              this.fxGfx.lineStyle(1.5, 0xffc27a, alpha * 0.85);
              this.fxGfx.lineBetween(sx, sy, endScreen.x, halfH + eZOffset);
            }
          }
          break;
        }
        case 'explosion': {
          const r = p.size * alpha * 70 * scale;
          this.fxGfx.fillStyle(0xff7000, alpha * 0.9);
          this.fxGfx.fillCircle(sx, sy, r);
          this.fxGfx.fillStyle(0xffe87a, alpha * 0.6);
          this.fxGfx.fillCircle(sx, sy, r * 0.5);
          break;
        }
        case 'flash': {
          const r = p.size * alpha * 18 * scale;
          this.fxGfx.fillStyle(0xffffc0, alpha * 0.7);
          this.fxGfx.fillCircle(sx, sy, r);
          break;
        }
        default: {
          const color = p.type === 'blood'  ? 0xc03040 :
                        p.type === 'spark'  ? 0xffe087 :
                        p.type === 'fire'   ? 0xff8a2b :
                        p.type === 'smoke'  ? 0x9aa3af :
                        p.type === 'casing' ? 0xd4b46a :
                        0xb0d2ff;
          this.fxGfx.fillStyle(color, alpha);
          this.fxGfx.fillRect(sx - ps * 0.5, sy - ps * 0.5, ps, ps);
          break;
        }
      }
    }
  }
}
