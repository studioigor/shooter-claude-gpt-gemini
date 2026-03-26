export type WeaponKey = 'pistol' | 'shotgun' | 'machinegun' | 'plasma';
export type EnemyArchetypeKey = 'trooper' | 'stalker' | 'drone' | 'bruiser' | 'boss';
export type DoorColor = 'red' | 'blue' | 'yellow';
export type PickupType =
  | 'health'
  | 'ammo'
  | 'armor'
  | 'shotgun'
  | 'machinegun'
  | 'plasma'
  | 'keyRed'
  | 'keyBlue'
  | 'keyYellow';

export interface RectZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LightZone {
  x: number;
  y: number;
  radius: number;
  r: number;
  g: number;
  b: number;
  flicker: boolean;
}

export interface AttackProfile {
  style: 'hitscan' | 'melee' | 'burst';
  range: number;
  windup: number;
  cooldown: number;
  damage: number;
  accuracy: number;
  pellets?: number;
  spread?: number;
  burstCount?: number;
  burstGap?: number;
}

export interface EnemyArchetype {
  key: EnemyArchetypeKey;
  name: string;
  pressureRole: string;
  health: number;
  speed: number;
  hitRadius: number;
  detectionRange: number;
  strafeWeight: number;
  aggression: number;
  weakToSplash: boolean;
  weakToMelee: boolean;
  staggerThreshold: number;
  lootDrops: PickupType[];
  attack: AttackProfile;
}

export interface WeaponDef {
  key: WeaponKey;
  name: string;
  role: string;
  damage: number;
  fireRate: number;
  ammoPerShot: number;
  spread: number;
  pellets: number;
  maxAmmo: number;
  magSize: number;
  reloadTime: number;
  recoil: number;
  shake: number;
  alertRadius: number;
  projectile: boolean;
  splashRadius?: number;
  knockback: number;
}

export interface SpawnDefinition {
  id: string;
  archetype: EnemyArchetypeKey;
  x: number;
  y: number;
  encounterTag?: string;
}

export interface PickupDefinition {
  id: string;
  type: PickupType;
  x: number;
  y: number;
}

export interface BarrelDefinition {
  id: string;
  x: number;
  y: number;
}

export interface GeneratorDefinition {
  id: string;
  x: number;
  y: number;
  health: number;
  activeOnStart?: boolean;
}

export type PropType = 'crate' | 'crateStack' | 'terminal' | 'pipes' | 'debris' | 'column' | 'lamp';

export interface PropDefinition {
  id: string;
  type: PropType;
  x: number;
  y: number;
}

export interface LockedDoorDefinition {
  x: number;
  y: number;
  color?: DoorColor;
  initiallyUnlocked?: boolean;
  arenaLocked?: boolean;
}

export interface CheckpointDefinition {
  id: string;
  label: string;
  zone: RectZone;
  respawn: {
    x: number;
    y: number;
    angle: number;
  };
  beacon: {
    x: number;
    y: number;
  };
}

export interface ObjectiveDefinition {
  id: string;
  label: string;
  description: string;
  type: 'clear' | 'reach' | 'destroy' | 'boss' | 'escape';
  targetId?: string;
}

export type TriggerCondition =
  | { type: 'enterZone'; zone: RectZone }
  | { type: 'encounterCleared'; tag: string }
  | { type: 'killCount'; count: number }
  | { type: 'bossHealthBelow'; threshold: number }
  | { type: 'generatorsDestroyed'; count: number }
  | { type: 'escapeTimerExpired' };

export type TriggerAction =
  | { type: 'spawnEnemies'; enemies: SpawnDefinition[] }
  | { type: 'lockDoors'; doors: Array<{ x: number; y: number }> }
  | { type: 'unlockDoors'; doors: Array<{ x: number; y: number }>; autoOpen?: boolean }
  | { type: 'setObjective'; objectiveId: string }
  | { type: 'message'; text: string }
  | { type: 'activateCheckpoint'; checkpointId: string }
  | { type: 'activateGenerators'; generatorIds: string[] }
  | { type: 'setBossPhase'; phase: number }
  | { type: 'unlockExtraction' }
  | { type: 'startEscape'; duration: number };

export interface TriggerDefinition {
  id: string;
  once?: boolean;
  condition: TriggerCondition;
  actions: TriggerAction[];
}

export interface LevelDefinition {
  index: number;
  id: string;
  actTitle: string;
  name: string;
  briefing: string;
  subBriefing: string;
  map: number[][];
  entities: {
    enemies: SpawnDefinition[];
    pickups: PickupDefinition[];
    barrels: BarrelDefinition[];
    generators: GeneratorDefinition[];
    props?: PropDefinition[];
  };
  lightZones: LightZone[];
  playerStart: {
    x: number;
    y: number;
    angle: number;
  };
  lockedDoors: LockedDoorDefinition[];
  checkpoints: CheckpointDefinition[];
  objectives: ObjectiveDefinition[];
  objectiveStart: string;
  triggers: TriggerDefinition[];
  exit: {
    x: number;
    y: number;
    zone: RectZone;
  };
  nextLevel: number | null;
}

export interface PlayerSnapshot {
  x: number;
  y: number;
  angle: number;
  health: number;
  armor: number;
  stamina: number;
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

export interface EnemySaveState {
  id: string;
  archetype: EnemyArchetypeKey;
  x: number;
  y: number;
  health: number;
  dead: boolean;
  encounterTag?: string;
}

export interface PickupSaveState extends PickupDefinition {
  collected: boolean;
}

export interface BarrelSaveState extends BarrelDefinition {
  health: number;
  exploded: boolean;
}

export interface GeneratorSaveState extends GeneratorDefinition {
  active: boolean;
  destroyed: boolean;
}

export interface DoorSaveState {
  key: string;
  x: number;
  y: number;
  open: number;
  state: 'closed' | 'opening' | 'open' | 'closing';
  color?: DoorColor;
  unlocked: boolean;
  arenaLocked: boolean;
}

export interface RunStats {
  elapsedTime: number;
  shotsFired: number;
  shotsHit: number;
  kills: number;
  deaths: number;
}

export interface SaveState {
  version: number;
  savedAt: number;
  actIndex: number;
  checkpointId: string;
  currentObjectiveId: string;
  player: PlayerSnapshot;
  enemies: EnemySaveState[];
  pickups: PickupSaveState[];
  barrels: BarrelSaveState[];
  generators: GeneratorSaveState[];
  doors: DoorSaveState[];
  firedTriggers: string[];
  extractionUnlocked: boolean;
  bossPhase: number;
  escapeTimeLeft: number | null;
  stats: RunStats;
}

export interface SettingsState {
  version: number;
  mouseSensitivity: number;
  fov: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  screenShake: number;
  showCrosshair: boolean;
  showFps: boolean;
}

export interface HudSnapshot {
  actTitle: string;
  levelName: string;
  objectiveLabel: string;
  objectiveDescription: string;
  message: string;
  messageAlpha: number;
  prompt: string;
  promptVisible: boolean;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  stamina: number;
  maxStamina: number;
  ammoInMag: number;
  ammoReserve: number;
  weaponName: string;
  weaponRole: string;
  ammoRatio: number;
  reserveRatio: number;
  threatLevel: string;
  objectiveDistance: number;
  time: string;
  accuracy: number;
  dashReady: boolean;
  meleeReady: boolean;
  keys: {
    red: boolean;
    blue: boolean;
    yellow: boolean;
  };
  fps: number;
  showFps: boolean;
  damageOverlay: string;
}
