import Phaser from 'phaser';
import './style.css';
import { SCREEN_H, SCREEN_W } from './game/core/config';
import type { BootPayload, RuntimeHooks } from './game/core/runtime';
import type { SaveState, SettingsState } from './game/core/types';
import { LEVELS } from './game/data/levels';
import { clearCheckpoint, loadCheckpoint, loadSettings, saveCheckpoint, saveSettings } from './game/save/storage';
import { GameScene } from './game/scenes/GameScene';
import { generateSprites } from './game/render/generatedSprites';
import { generateTextures } from './game/render/generatedTextures';
import { GameUI } from './game/ui/GameUI';

// Pregenerate assets while boot menu is shown so the first game start is instant.
setTimeout(() => { generateTextures(); generateSprites(); }, 0);

const mount = document.querySelector<HTMLDivElement>('#app');
if (!mount) throw new Error('Missing app mount');

if (navigator.userAgent.includes('Electron')) {
  document.body.classList.add('electron-app');
}

let settings: SettingsState = loadSettings();
let activeGame: Phaser.Game | null = null;
let activeScene: GameScene | null = null;
let pendingBriefing: { mode: 'new' | 'next'; actIndex: number } | null = null;

function exitGame(): void {
  if (navigator.userAgent.includes('Electron')) {
    window.close();
  }
}

function checkpointLabel(save: SaveState | null): string | undefined {
  if (!save) return undefined;
  const level = LEVELS[save.actIndex];
  const checkpoint = level?.checkpoints.find((item) => item.id === save.checkpointId);
  return checkpoint ? `${level.actTitle} / ${checkpoint.label}` : `${level?.actTitle ?? 'Run'} / Resume available`;
}

const ui = new GameUI(mount, settings, {
  onStartNewCampaign: () => {
    pendingBriefing = { mode: 'new', actIndex: 0 };
    ui.showBriefing(LEVELS[0]);
  },
  onContinueCheckpoint: () => {
    const checkpoint = loadCheckpoint();
    if (!checkpoint) {
      ui.showBootMenu(false);
      return;
    }
    launch({ startActIndex: checkpoint.actIndex, checkpoint });
  },
  onExitGame: () => exitGame(),
  onOpenSettings: () => ui.showSettings(),
  onCloseSettings: () => ui.hideSettings(),
  onResume: () => activeScene?.togglePause(false),
  onRestartCheckpoint: () => {
    const checkpoint = loadCheckpoint();
    if (!checkpoint) {
      restartCampaign();
      return;
    }
    launch({ startActIndex: checkpoint.actIndex, checkpoint });
  },
  onRestartCampaign: () => restartCampaign(),
  onNext: () => {
    if (!activeScene) {
      restartCampaign();
      return;
    }
    const nextLevel = activeScene.getPendingNextLevel();
    if (nextLevel === null) {
      destroyGame();
      ui.showBootMenu(Boolean(loadCheckpoint()), checkpointLabel(loadCheckpoint()));
      return;
    }
    pendingBriefing = { mode: 'next', actIndex: nextLevel };
    ui.showBriefing(LEVELS[nextLevel]);
  },
  onConfirmBriefing: () => {
    if (!pendingBriefing) return;
    if (pendingBriefing.mode === 'new') {
      clearCheckpoint();
      launch({ startActIndex: pendingBriefing.actIndex, checkpoint: null });
    } else {
      ui.hideBriefing();
      activeScene?.advanceToPendingAct();
    }
    pendingBriefing = null;
  },
  onSettingsChanged: (patch) => {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    ui.applySettingsControls(settings);
    activeScene?.applySettings(settings);
  },
});

function destroyGame(): void {
  if (activeGame) activeGame.destroy(true);
  activeGame = null;
  activeScene = null;
}

function buildHooks(): RuntimeHooks {
  return {
    ui,
    getSettings: () => settings,
    persistSettings: (nextSettings) => {
      settings = nextSettings;
      saveSettings(nextSettings);
      ui.applySettingsControls(nextSettings);
    },
    loadCheckpoint,
    saveCheckpoint,
    clearCheckpoint,
  };
}

function launch(payload: BootPayload): void {
  destroyGame();
  ui.beginRun();
  ui.hideSettings();

  activeScene = new GameScene(buildHooks(), payload);
  activeGame = new Phaser.Game({
    type: Phaser.AUTO,
    width: SCREEN_W,
    height: SCREEN_H,
    parent: ui.gameRoot,
    backgroundColor: '#000000',
    scene: [activeScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: {
      keyboard: true,
      mouse: true,
    },
    audio: { noAudio: true },
    render: {
      pixelArt: true,
      powerPreference: 'high-performance',
      desynchronized: true,
    },
  });
}

function restartCampaign(): void {
  destroyGame();
  pendingBriefing = { mode: 'new', actIndex: 0 };
  ui.showBriefing(LEVELS[0]);
}

ui.showBootMenu(Boolean(loadCheckpoint()), checkpointLabel(loadCheckpoint()));
