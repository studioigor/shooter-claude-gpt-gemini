import type { HudSnapshot, LevelDefinition, SettingsState } from '../core/types';

interface GameUiCallbacks {
  onStartNewCampaign: () => void;
  onContinueCheckpoint: () => void;
  onExitGame: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onResume: () => void;
  onRestartCheckpoint: () => void;
  onRestartCampaign: () => void;
  onNext: () => void;
  onConfirmBriefing: () => void;
  onSettingsChanged: (patch: Partial<SettingsState>) => void;
}

export class GameUI {
  private readonly root: HTMLElement;
  private readonly callbacks: GameUiCallbacks;
  private readonly overlays: Record<string, HTMLElement>;
  private readonly checkpointLine: HTMLElement;
  private readonly objectiveValue: HTMLElement;
  private readonly objectiveDesc: HTMLElement;
  private readonly threatValue: HTMLElement;
  private readonly distanceValue: HTMLElement;
  private readonly actValue: HTMLElement;
  private readonly timerValue: HTMLElement;
  private readonly accuracyValue: HTMLElement;
  private readonly fpsValue: HTMLElement;
  private readonly messageValue: HTMLElement;
  private readonly promptValue: HTMLElement;
  private readonly toastValue: HTMLElement;
  private readonly damageOverlay: HTMLElement;
  private readonly healthValue: HTMLElement;
  private readonly healthBar: HTMLElement;
  private readonly armorValue: HTMLElement;
  private readonly armorBar: HTMLElement;
  private readonly staminaValue: HTMLElement;
  private readonly staminaBar: HTMLElement;
  private readonly vitalsState: HTMLElement;
  private readonly mobilityState: HTMLElement;
  private readonly ammoValue: HTMLElement;
  private readonly weaponValue: HTMLElement;
  private readonly weaponRoleValue: HTMLElement;
  private readonly ammoBar: HTMLElement;
  private readonly reserveBar: HTMLElement;
  private readonly dashValue: HTMLElement;
  private readonly meleeValue: HTMLElement;
  private readonly keyRed: HTMLElement;
  private readonly keyBlue: HTMLElement;
  private readonly keyYellow: HTMLElement;
  private readonly deathStats: HTMLElement;
  private readonly victoryStats: HTMLElement;
  private readonly victoryTitle: HTMLElement;
  private readonly briefingTitle: HTMLElement;
  private readonly briefingBody: HTMLElement;
  private readonly briefingList: HTMLUListElement;
  private readonly pauseSummary: HTMLElement;
  readonly hud: HTMLElement;
  readonly gameRoot: HTMLElement;

  constructor(mount: HTMLElement, settings: SettingsState, callbacks: GameUiCallbacks) {
    this.root = mount;
    this.callbacks = callbacks;
    this.root.innerHTML = `
      <div class="app-shell">
        <div class="game-shell">
          <div class="game-root" id="gameRoot"></div>
          <div class="hud" id="hud">
            <div class="damage-overlay" id="damageOverlay"></div>
            <div class="hud-top">
              <div class="hud-box mission-box">
                <div class="hud-eyebrow" id="hudAct">Act I // Breach Protocol</div>
                <div class="hud-value" style="font-size: 16px;" id="hudObjectiveValue">Reach the atrium</div>
                <div class="hud-label" id="hudObjectiveDesc">Push into the annex and find the central breach.</div>
                <div class="hud-label" id="checkpointText" style="margin-top: 8px;">No checkpoint armed</div>
              </div>
              <div class="hud-center-stack">
                <div class="status-chip cool" id="hudThreat">Sector clear</div>
                <div class="status-chip alt" id="hudDistance">Target 0m</div>
              </div>
              <div class="hud-box align-right telemetry-box">
                <div class="hud-eyebrow">Combat Feed</div>
                <div class="hud-value" style="font-size: 18px;" id="hudTime">00:00</div>
                <div class="hud-label" id="hudAccuracy">Accuracy 0%</div>
                <div class="hud-label" id="hudFps">60 FPS</div>
              </div>
            </div>
            <div class="hud-banner" id="hudMessage"></div>
            <div class="hud-toast" id="hudToast"></div>
            <div class="hud-prompt" id="hudPrompt"></div>
            <div class="hud-bottom">
              <div class="hud-box vitals-box">
                <div class="hud-value" id="hudHealth">HP 100</div>
                <div class="compact-grid">
                  <div class="hud-label" id="hudArmor">Armor 0</div>
                  <div class="bar-track"><div class="bar-fill" id="hudHealthBar"></div></div>
                  <div class="bar-track"><div class="bar-fill armor" id="hudArmorBar"></div></div>
                  <div class="hud-label" id="hudStamina">Stamina 100</div>
                  <div class="bar-track"><div class="bar-fill stamina" id="hudStaminaBar"></div></div>
                </div>
                <div class="readout-row">
                  <div class="hud-micro" id="hudVitalsState">Vitals stable</div>
                  <div class="hud-micro" id="hudMobilityState">Mobility primed</div>
                </div>
              </div>
              <div class="hud-box align-right weapon-box">
                <div class="hud-value" id="hudAmmo">12 / 50</div>
                <div class="hud-label" id="hudWeapon">Sidearm</div>
                <div class="hud-micro weapon-role" id="hudWeaponRole">Accurate fallback and finisher</div>
                <div class="ammo-rails">
                  <div class="ammo-rail">
                    <span class="rail-label">Mag</span>
                    <div class="bar-track slim"><div class="bar-fill ammo" id="hudAmmoBar"></div></div>
                  </div>
                  <div class="ammo-rail">
                    <span class="rail-label">Reserve</span>
                    <div class="bar-track slim"><div class="bar-fill reserve" id="hudReserveBar"></div></div>
                  </div>
                </div>
                <div class="cooldown-row">
                  <div class="cooldown-pill" id="dashPill">Dash</div>
                  <div class="cooldown-pill" id="meleePill">Kick</div>
                </div>
                <div class="key-row">
                  <div class="key-pill red" id="keyRed">Red</div>
                  <div class="key-pill blue" id="keyBlue">Blue</div>
                  <div class="key-pill yellow" id="keyYellow">Yellow</div>
                </div>
              </div>
            </div>
          </div>
          <div class="overlay is-visible" id="bootOverlay">
            <div class="overlay-panel">
              <div class="panel-kicker">Combat Build // Overhaul</div>
              <h1 class="panel-title">Shadow Corridors</h1>
              <p class="panel-subtitle">
                Retro sci-fi corridor shooter rebuilt around modular content, stronger combat roles,
                arena scripting, checkpoints, and a multi-phase finale.
              </p>
              <div class="stats-line" id="bootCheckpointLine">No active checkpoint.</div>
              <div class="button-row">
                <button class="action-btn" id="startCampaignBtn">New Campaign</button>
                <button class="action-btn alt" id="continueBtn">Continue Checkpoint</button>
                <button class="action-btn subtle" id="bootSettingsBtn">Settings</button>
                <button class="action-btn subtle" id="bootExitBtn">Exit Game</button>
              </div>
            </div>
          </div>
          <div class="overlay" id="briefingOverlay">
            <div class="overlay-panel">
              <div class="panel-kicker">Deployment Brief</div>
              <h1 class="panel-title" id="briefingTitle">Act I // Breach Protocol</h1>
              <p class="panel-subtitle" id="briefingBody"></p>
              <ul class="brief-list" id="briefingList"></ul>
              <div class="button-row">
                <button class="action-btn alt" id="briefingConfirmBtn">Enter Act</button>
                <button class="action-btn subtle" id="briefingSettingsBtn">Settings</button>
              </div>
            </div>
          </div>
          <div class="overlay" id="pauseOverlay">
            <div class="overlay-panel">
              <div class="panel-kicker">Tactical Hold</div>
              <h1 class="panel-title">Paused</h1>
              <p class="panel-subtitle">Resume when you are ready to re-enter the corridor.</p>
              <div class="pause-meta" id="pauseSummary"></div>
              <div class="button-row">
                <button class="action-btn alt" id="resumeBtn">Resume</button>
                <button class="action-btn subtle" id="pauseSettingsBtn">Settings</button>
                <button class="action-btn subtle" id="pauseRestartBtn">Restart Campaign</button>
                <button class="action-btn subtle" id="pauseExitBtn">Exit Game</button>
              </div>
            </div>
          </div>
          <div class="overlay" id="deathOverlay">
            <div class="overlay-panel">
              <div class="panel-kicker">Mission Failed</div>
              <h1 class="panel-title">You Died</h1>
              <p class="panel-subtitle" id="deathStats"></p>
              <div class="button-row">
                <button class="action-btn alt" id="restartCheckpointBtn">Restart Checkpoint</button>
                <button class="action-btn subtle" id="restartCampaignBtn">Restart Campaign</button>
                <button class="action-btn subtle" id="deathExitBtn">Exit Game</button>
              </div>
            </div>
          </div>
          <div class="overlay" id="victoryOverlay">
            <div class="overlay-panel">
              <div class="panel-kicker">Act Result</div>
              <h1 class="panel-title" id="victoryTitle">Area Secured</h1>
              <p class="panel-subtitle" id="victoryStats"></p>
              <div class="button-row">
                <button class="action-btn alt" id="nextBtn">Next Act</button>
                <button class="action-btn subtle" id="victoryRestartBtn">Restart Campaign</button>
                <button class="action-btn subtle" id="victoryExitBtn">Exit Game</button>
              </div>
            </div>
          </div>
          <div class="overlay" id="settingsOverlay">
            <div class="overlay-panel">
              <div class="panel-kicker">Configuration</div>
              <h1 class="panel-title">Settings</h1>
              <p class="panel-subtitle">Changes apply immediately and persist between sessions.</p>
              <div class="settings-grid">
                <div class="setting-row"><label for="settingSensitivity">Mouse sensitivity</label><input id="settingSensitivity" type="range" min="0.4" max="1.8" step="0.05"></div>
                <div class="setting-row"><label for="settingFov">Field of view</label><input id="settingFov" type="range" min="60" max="95" step="1"></div>
                <div class="setting-row"><label for="settingMaster">Master volume</label><input id="settingMaster" type="range" min="0" max="1" step="0.05"></div>
                <div class="setting-row"><label for="settingMusic">Music volume</label><input id="settingMusic" type="range" min="0" max="1" step="0.05"></div>
                <div class="setting-row"><label for="settingSfx">SFX volume</label><input id="settingSfx" type="range" min="0" max="1" step="0.05"></div>
                <div class="setting-row"><label for="settingShake">Screen shake</label><input id="settingShake" type="range" min="0" max="1.2" step="0.05"></div>
                <div class="setting-row"><label for="settingBrightness">Brightness</label><input id="settingBrightness" type="range" min="0.65" max="1.35" step="0.05"></div>
                <div class="setting-row"><label for="settingCrosshair">Show crosshair</label><input id="settingCrosshair" type="checkbox"></div>
                <div class="setting-row"><label for="settingFpsToggle">Show FPS</label><input id="settingFpsToggle" type="checkbox"></div>
              </div>
              <div class="button-row">
                <button class="action-btn alt" id="closeSettingsBtn">Close</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.gameRoot = this.get('#gameRoot');
    this.hud = this.get('#hud');
    this.checkpointLine = this.get('#checkpointText');
    this.objectiveValue = this.get('#hudObjectiveValue');
    this.objectiveDesc = this.get('#hudObjectiveDesc');
    this.threatValue = this.get('#hudThreat');
    this.distanceValue = this.get('#hudDistance');
    this.actValue = this.get('#hudAct');
    this.timerValue = this.get('#hudTime');
    this.accuracyValue = this.get('#hudAccuracy');
    this.fpsValue = this.get('#hudFps');
    this.messageValue = this.get('#hudMessage');
    this.promptValue = this.get('#hudPrompt');
    this.toastValue = this.get('#hudToast');
    this.damageOverlay = this.get('#damageOverlay');
    this.healthValue = this.get('#hudHealth');
    this.healthBar = this.get('#hudHealthBar');
    this.armorValue = this.get('#hudArmor');
    this.armorBar = this.get('#hudArmorBar');
    this.staminaValue = this.get('#hudStamina');
    this.staminaBar = this.get('#hudStaminaBar');
    this.vitalsState = this.get('#hudVitalsState');
    this.mobilityState = this.get('#hudMobilityState');
    this.ammoValue = this.get('#hudAmmo');
    this.weaponValue = this.get('#hudWeapon');
    this.weaponRoleValue = this.get('#hudWeaponRole');
    this.ammoBar = this.get('#hudAmmoBar');
    this.reserveBar = this.get('#hudReserveBar');
    this.dashValue = this.get('#dashPill');
    this.meleeValue = this.get('#meleePill');
    this.keyRed = this.get('#keyRed');
    this.keyBlue = this.get('#keyBlue');
    this.keyYellow = this.get('#keyYellow');
    this.deathStats = this.get('#deathStats');
    this.victoryStats = this.get('#victoryStats');
    this.victoryTitle = this.get('#victoryTitle');
    this.briefingTitle = this.get('#briefingTitle');
    this.briefingBody = this.get('#briefingBody');
    this.briefingList = this.get('#briefingList') as HTMLUListElement;
    this.pauseSummary = this.get('#pauseSummary');

    this.overlays = {
      boot: this.get('#bootOverlay'),
      briefing: this.get('#briefingOverlay'),
      pause: this.get('#pauseOverlay'),
      death: this.get('#deathOverlay'),
      victory: this.get('#victoryOverlay'),
      settings: this.get('#settingsOverlay'),
    };

    this.bindButtons();
    this.applySettingsControls(settings);
    this.showBootMenu(false);
  }

  private get(selector: string): HTMLElement {
    const element = this.root.querySelector(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element as HTMLElement;
  }

  private bindButtons(): void {
    this.get('#startCampaignBtn').addEventListener('click', () => this.callbacks.onStartNewCampaign());
    this.get('#continueBtn').addEventListener('click', () => this.callbacks.onContinueCheckpoint());
    this.get('#bootExitBtn').addEventListener('click', () => this.callbacks.onExitGame());
    this.get('#bootSettingsBtn').addEventListener('click', () => this.callbacks.onOpenSettings());
    this.get('#briefingSettingsBtn').addEventListener('click', () => this.callbacks.onOpenSettings());
    this.get('#resumeBtn').addEventListener('click', () => this.callbacks.onResume());
    this.get('#pauseSettingsBtn').addEventListener('click', () => this.callbacks.onOpenSettings());
    this.get('#pauseRestartBtn').addEventListener('click', () => this.callbacks.onRestartCampaign());
    this.get('#pauseExitBtn').addEventListener('click', () => this.callbacks.onExitGame());
    this.get('#restartCheckpointBtn').addEventListener('click', () => this.callbacks.onRestartCheckpoint());
    this.get('#restartCampaignBtn').addEventListener('click', () => this.callbacks.onRestartCampaign());
    this.get('#deathExitBtn').addEventListener('click', () => this.callbacks.onExitGame());
    this.get('#nextBtn').addEventListener('click', () => this.callbacks.onNext());
    this.get('#victoryRestartBtn').addEventListener('click', () => this.callbacks.onRestartCampaign());
    this.get('#victoryExitBtn').addEventListener('click', () => this.callbacks.onExitGame());
    this.get('#briefingConfirmBtn').addEventListener('click', () => this.callbacks.onConfirmBriefing());
    this.get('#closeSettingsBtn').addEventListener('click', () => this.callbacks.onCloseSettings());

    const bindRange = (id: string, key: keyof SettingsState, transform: (value: string) => number | boolean) => {
      this.get(id).addEventListener('input', (event) => {
        const target = event.target as HTMLInputElement;
        this.callbacks.onSettingsChanged({ [key]: transform(target.value) } as Partial<SettingsState>);
      });
    };

    bindRange('#settingSensitivity', 'mouseSensitivity', Number);
    bindRange('#settingFov', 'fov', Number);
    bindRange('#settingMaster', 'masterVolume', Number);
    bindRange('#settingMusic', 'musicVolume', Number);
    bindRange('#settingSfx', 'sfxVolume', Number);
    bindRange('#settingShake', 'screenShake', Number);
    bindRange('#settingBrightness', 'brightness', Number);

    this.get('#settingCrosshair').addEventListener('change', (event) => {
      this.callbacks.onSettingsChanged({ showCrosshair: (event.target as HTMLInputElement).checked });
    });
    this.get('#settingFpsToggle').addEventListener('change', (event) => {
      this.callbacks.onSettingsChanged({ showFps: (event.target as HTMLInputElement).checked });
    });
  }

  applySettingsControls(settings: SettingsState): void {
    (this.get('#settingSensitivity') as HTMLInputElement).value = String(settings.mouseSensitivity);
    (this.get('#settingFov') as HTMLInputElement).value = String(settings.fov);
    (this.get('#settingMaster') as HTMLInputElement).value = String(settings.masterVolume);
    (this.get('#settingMusic') as HTMLInputElement).value = String(settings.musicVolume);
    (this.get('#settingSfx') as HTMLInputElement).value = String(settings.sfxVolume);
    (this.get('#settingShake') as HTMLInputElement).value = String(settings.screenShake);
    (this.get('#settingBrightness') as HTMLInputElement).value = String(settings.brightness);
    (this.get('#settingCrosshair') as HTMLInputElement).checked = settings.showCrosshair;
    (this.get('#settingFpsToggle') as HTMLInputElement).checked = settings.showFps;
  }

  showBootMenu(hasCheckpoint: boolean, checkpointLabel?: string): void {
    this.showOnly('boot');
    this.get('#continueBtn').classList.toggle('hidden', !hasCheckpoint);
    this.get('#bootCheckpointLine').textContent = hasCheckpoint
      ? `Active checkpoint: ${checkpointLabel ?? 'Checkpoint restore available'}`
      : 'No active checkpoint.';
    this.hideHud();
  }

  showBriefing(level: LevelDefinition, hasContinueLabel = false): void {
    this.showOnly('briefing');
    this.briefingTitle.textContent = level.actTitle;
    this.briefingBody.textContent = `${level.name}. ${level.briefing}`;
    this.briefingList.innerHTML = '';
    level.objectives.slice(0, 3).forEach((objective) => {
      const item = document.createElement('li');
      item.textContent = `${objective.label}: ${objective.description}`;
      this.briefingList.appendChild(item);
    });
    this.get('#briefingConfirmBtn').textContent = hasContinueLabel ? 'Resume Run' : 'Enter Act';
  }

  hideBriefing(): void {
    this.overlays.briefing.classList.remove('is-visible');
  }

  showPause(summary: string): void {
    this.pauseSummary.textContent = summary;
    this.overlays.pause.classList.add('is-visible');
  }

  hidePause(): void {
    this.overlays.pause.classList.remove('is-visible');
  }

  showDeath(summary: string, hasCheckpoint: boolean): void {
    this.showOnly('death');
    this.deathStats.textContent = summary;
    this.get('#restartCheckpointBtn').classList.toggle('hidden', !hasCheckpoint);
  }

  showVictory(summary: string, hasNext: boolean, finalVictory: boolean): void {
    this.showOnly('victory');
    this.victoryStats.textContent = summary;
    this.victoryTitle.textContent = finalVictory ? 'Mission Complete' : 'Area Secured';
    this.get('#nextBtn').textContent = hasNext ? 'Next Act' : 'Back To Menu';
  }

  showHud(): void {
    this.hud.classList.add('is-visible');
  }

  hideHud(): void {
    this.hud.classList.remove('is-visible');
  }

  beginRun(): void {
    Object.values(this.overlays).forEach((overlay) => overlay.classList.remove('is-visible'));
    this.showHud();
  }

  showSettings(): void {
    this.overlays.settings.classList.add('is-visible');
  }

  hideSettings(): void {
    this.overlays.settings.classList.remove('is-visible');
  }

  updateHud(snapshot: HudSnapshot): void {
    const healthRatio = snapshot.maxHealth > 0 ? snapshot.health / snapshot.maxHealth : 0;
    const armorRatio = snapshot.maxArmor > 0 ? snapshot.armor / snapshot.maxArmor : 0;
    const staminaRatio = snapshot.maxStamina > 0 ? snapshot.stamina / snapshot.maxStamina : 0;
    const threatClass = snapshot.threatLevel.includes('Overseer') || snapshot.threatLevel.includes('Swarm') || snapshot.threatLevel.includes('Heavy')
      ? 'hot'
      : snapshot.threatLevel.includes('Contact')
        ? 'warm'
        : 'cool';

    this.actValue.textContent = `${snapshot.actTitle} // ${snapshot.levelName}`;
    this.objectiveValue.textContent = snapshot.objectiveLabel;
    this.objectiveDesc.textContent = snapshot.objectiveDescription;
    this.threatValue.textContent = snapshot.threatLevel;
    this.threatValue.className = `status-chip ${threatClass}`;
    this.distanceValue.textContent = `Target ${snapshot.objectiveDistance}m`;
    this.timerValue.textContent = snapshot.time;
    this.accuracyValue.textContent = `Accuracy ${snapshot.accuracy}%`;
    this.fpsValue.textContent = `${snapshot.fps} FPS`;
    this.fpsValue.classList.toggle('hidden', !snapshot.showFps);
    this.healthValue.textContent = `HP ${Math.round(snapshot.health)}`;
    this.healthBar.style.width = `${(snapshot.health / snapshot.maxHealth) * 100}%`;
    this.healthBar.className = `bar-fill health ${healthRatio < 0.22 ? 'critical' : healthRatio < 0.48 ? 'low' : 'good'}`;
    this.armorValue.textContent = `Armor ${Math.round(snapshot.armor)}`;
    this.armorBar.style.width = `${(snapshot.armor / snapshot.maxArmor) * 100}%`;
    this.armorBar.className = `bar-fill armor ${armorRatio < 0.2 ? 'low' : 'good'}`;
    this.staminaValue.textContent = `Stamina ${Math.round(snapshot.stamina)}`;
    this.staminaBar.style.width = `${(snapshot.stamina / snapshot.maxStamina) * 100}%`;
    this.staminaBar.className = `bar-fill stamina ${staminaRatio < 0.28 ? 'low' : 'good'}`;
    this.vitalsState.textContent = healthRatio < 0.22 ? 'Vitals critical' : healthRatio < 0.48 ? 'Vitals unstable' : armorRatio > 0.35 ? 'Vitals armored' : 'Vitals stable';
    this.mobilityState.textContent = staminaRatio < 0.28 ? 'Mobility taxed' : snapshot.dashReady ? 'Mobility primed' : 'Dash cycling';
    this.ammoValue.textContent = `${snapshot.ammoInMag} / ${snapshot.ammoReserve}`;
    this.weaponValue.textContent = snapshot.weaponName;
    this.weaponRoleValue.textContent = snapshot.weaponRole;
    this.ammoBar.style.width = `${snapshot.ammoRatio * 100}%`;
    this.ammoBar.className = `bar-fill ammo ${snapshot.ammoRatio < 0.18 ? 'critical' : snapshot.ammoRatio < 0.4 ? 'low' : 'good'}`;
    this.reserveBar.style.width = `${snapshot.reserveRatio * 100}%`;
    this.reserveBar.className = `bar-fill reserve ${snapshot.reserveRatio < 0.18 ? 'low' : 'good'}`;
    this.dashValue.classList.toggle('ready', snapshot.dashReady);
    this.meleeValue.classList.toggle('ready', snapshot.meleeReady);
    this.keyRed.classList.toggle('has', snapshot.keys.red);
    this.keyBlue.classList.toggle('has', snapshot.keys.blue);
    this.keyYellow.classList.toggle('has', snapshot.keys.yellow);
    this.messageValue.textContent = snapshot.message;
    this.messageValue.style.opacity = String(snapshot.messageAlpha);
    this.promptValue.textContent = snapshot.prompt;
    this.promptValue.style.opacity = snapshot.promptVisible ? '1' : '0';
    this.damageOverlay.style.background = snapshot.damageOverlay;
  }

  setCheckpointText(text: string): void {
    this.checkpointLine.textContent = text;
  }

  private showOnly(key: keyof typeof this.overlays): void {
    Object.entries(this.overlays).forEach(([name, element]) => {
      element.classList.toggle('is-visible', name === key);
    });
  }
}
