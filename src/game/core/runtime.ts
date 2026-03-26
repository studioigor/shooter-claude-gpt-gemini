import type { HudSnapshot, LevelDefinition, SaveState, SettingsState } from './types';

export interface UiController {
  showBootMenu(hasCheckpoint: boolean, checkpointLabel?: string): void;
  showBriefing(level: LevelDefinition, hasContinueLabel?: boolean): void;
  hideBriefing(): void;
  showPause(summary: string): void;
  hidePause(): void;
  showDeath(summary: string, hasCheckpoint: boolean): void;
  showVictory(summary: string, hasNext: boolean, finalVictory: boolean): void;
  showHud(): void;
  hideHud(): void;
  updateHud(snapshot: HudSnapshot): void;
  setCheckpointText(text: string): void;
}

export interface RuntimeHooks {
  ui: UiController;
  getSettings: () => SettingsState;
  persistSettings: (settings: SettingsState) => void;
  loadCheckpoint: () => SaveState | null;
  saveCheckpoint: (saveState: SaveState) => void;
  clearCheckpoint: () => void;
}

export interface BootPayload {
  startActIndex: number;
  checkpoint: SaveState | null;
}
