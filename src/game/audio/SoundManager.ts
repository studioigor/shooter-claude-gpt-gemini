import type { SettingsState } from '../core/types';

export class SoundManager {
  ctx: AudioContext | null = null;
  initialized = false;
  private noiseBuffer: AudioBuffer | null = null;
  private settings: SettingsState | null = null;

  init(settings: SettingsState): void {
    if (this.initialized) {
      this.settings = settings;
      return;
    }
    this.ctx = new (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
    const sampleRate = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, sampleRate, sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let index = 0; index < sampleRate; index++) data[index] = Math.random() * 2 - 1;
    this.initialized = true;
    this.settings = settings;
  }

  resume(): void {
    void this.ctx?.resume();
  }

  updateSettings(settings: SettingsState): void {
    this.settings = settings;
  }

  private get level(): number {
    if (!this.settings) return 0.6;
    return this.settings.masterVolume * this.settings.sfxVolume;
  }

  private tone(freq: number, duration: number, type: OscillatorType, gain: number, detune = 0): void {
    if (!this.ctx || !this.initialized) return;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    amp.gain.setValueAtTime(gain * this.level, this.ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(amp).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  private noise(duration: number, filterFreq: number, q: number, gain: number): void {
    if (!this.ctx || !this.initialized || !this.noiseBuffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = q;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(gain * this.level, this.ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    source.connect(filter).connect(amp).connect(this.ctx.destination);
    source.start();
    source.stop(this.ctx.currentTime + duration);
  }

  pistolShot(): void { this.noise(0.08, 900, 2, 0.45); this.tone(150, 0.05, 'square', 0.22); }
  shotgunShot(): void { this.noise(0.15, 500, 1.5, 0.58); this.tone(95, 0.08, 'square', 0.28); }
  machinegunShot(): void { this.noise(0.05, 1200, 2.4, 0.32); this.tone(200, 0.035, 'square', 0.12); }
  plasmaFire(): void { this.tone(880, 0.13, 'triangle', 0.24); this.tone(440, 0.1, 'square', 0.12); }
  stalkerAttack(): void { this.noise(0.18, 240, 1.2, 0.28); this.tone(100, 0.18, 'sawtooth', 0.18); }
  enemyHit(): void { this.noise(0.05, 1200, 3, 0.22); this.tone(310, 0.08, 'triangle', 0.16); }
  enemyDie(): void { this.tone(210, 0.22, 'sawtooth', 0.28); this.tone(120, 0.35, 'sine', 0.18); }
  enemyFire(): void { this.noise(0.05, 1300, 2.2, 0.18); this.tone(260, 0.06, 'square', 0.1); }
  playerHurt(): void { this.noise(0.09, 600, 2, 0.35); this.tone(170, 0.14, 'square', 0.18); }
  doorOpen(): void { this.tone(80, 0.35, 'sine', 0.12); }
  doorDenied(): void { this.tone(150, 0.1, 'square', 0.14); this.tone(100, 0.14, 'square', 0.1); }
  pickup(): void {
    this.tone(523, 0.1, 'triangle', 0.16);
    window.setTimeout(() => this.tone(659, 0.1, 'triangle', 0.16), 90);
    window.setTimeout(() => this.tone(784, 0.14, 'triangle', 0.16), 180);
  }
  emptyGun(): void { this.tone(210, 0.05, 'square', 0.08); }
  reload(): void { this.tone(180, 0.06, 'square', 0.08); window.setTimeout(() => this.tone(300, 0.08, 'square', 0.06), 80); }
  barrelExplosion(): void { this.noise(0.26, 170, 1, 0.75); this.tone(60, 0.32, 'sawtooth', 0.32); }
  objectiveComplete(): void {
    this.tone(392, 0.08, 'triangle', 0.15);
    window.setTimeout(() => this.tone(523, 0.1, 'triangle', 0.15), 120);
    window.setTimeout(() => this.tone(784, 0.15, 'triangle', 0.16), 240);
  }
  weaponSwitch(): void { this.tone(380, 0.05, 'sine', 0.1); this.tone(560, 0.05, 'sine', 0.08); }
  footstep(): void { this.noise(0.04, 190, 3, 0.06); }
  bossRoar(): void { this.tone(80, 0.45, 'sawtooth', 0.35); this.noise(0.28, 200, 1, 0.3); }
  bossAttack(): void { this.noise(0.11, 900, 2, 0.28); this.tone(180, 0.09, 'square', 0.2); }
  checkpoint(): void { this.tone(660, 0.08, 'sine', 0.14); this.tone(880, 0.16, 'triangle', 0.12); }
  dash(): void { this.noise(0.05, 1000, 2, 0.16); this.tone(620, 0.08, 'triangle', 0.14); }
  melee(): void { this.noise(0.06, 700, 3, 0.16); this.tone(260, 0.09, 'square', 0.12); }
  generatorHit(): void { this.tone(920, 0.07, 'triangle', 0.12); this.noise(0.05, 1400, 5, 0.1); }
  uiConfirm(): void { this.tone(420, 0.05, 'triangle', 0.08); }
}
