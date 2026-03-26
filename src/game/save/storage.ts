import { DEFAULT_SETTINGS, SAVE_VERSION, SETTINGS_VERSION } from '../core/config';
import type { SaveState, SettingsState } from '../core/types';

const SETTINGS_KEY = 'shadow-corridors.settings.v1';
const CHECKPOINT_KEY = 'shadow-corridors.checkpoint.v1';

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadSettings(): SettingsState {
  const saved = readJson<SettingsState>(SETTINGS_KEY);
  if (!saved || saved.version !== SETTINGS_VERSION) {
    return { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS, ...saved, version: SETTINGS_VERSION };
}

export function saveSettings(settings: SettingsState): void {
  const payload: SettingsState = { ...DEFAULT_SETTINGS, ...settings, version: SETTINGS_VERSION };
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

export function loadCheckpoint(): SaveState | null {
  const saved = readJson<SaveState>(CHECKPOINT_KEY);
  if (!saved || saved.version !== SAVE_VERSION) return null;
  return saved;
}

export function saveCheckpoint(saveState: SaveState): void {
  window.localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ ...saveState, version: SAVE_VERSION }));
}

export function clearCheckpoint(): void {
  window.localStorage.removeItem(CHECKPOINT_KEY);
}
