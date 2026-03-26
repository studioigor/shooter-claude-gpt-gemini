import type { SettingsState } from '../core/types';

export class MusicManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private oscillators: Array<{ osc: OscillatorNode; gain: GainNode; baseFreq: number }> = [];
  private noiseNode: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;
  private playing = false;
  private settings: SettingsState | null = null;

  start(ctx: AudioContext, settings: SettingsState): void {
    if (this.playing) {
      this.settings = settings;
      this.applyGain(0);
      return;
    }
    this.ctx = ctx;
    this.settings = settings;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(ctx.destination);

    for (const freq of [46, 69, 92]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.value = 0.22;
      osc.connect(gain).connect(this.masterGain);
      osc.start();
      this.oscillators.push({ osc, gain, baseFreq: freq });
    }

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 240;
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.value = 0.12;
    noise.connect(filter).connect(gain).connect(this.masterGain);
    noise.start();
    this.noiseNode = noise;
    this.noiseGain = gain;
    this.playing = true;
    this.applyGain(0);
  }

  update(settings: SettingsState, combatIntensity: number, bossPhase: number): void {
    if (!this.playing || !this.ctx || !this.masterGain) return;
    this.settings = settings;
    for (const node of this.oscillators) {
      const drift = Math.sin(this.ctx.currentTime * 0.22 + node.baseFreq) * (bossPhase >= 2 ? 6 : 3);
      node.osc.frequency.value = node.baseFreq + drift + combatIntensity * 12 + bossPhase * 4;
    }
    if (this.noiseGain) {
      this.noiseGain.gain.value = 0.08 + combatIntensity * 0.08 + (bossPhase >= 2 ? 0.04 : 0);
    }
    this.applyGain(combatIntensity + bossPhase * 0.18);
  }

  stop(): void {
    if (!this.playing) return;
    try {
      for (const node of this.oscillators) node.osc.stop();
      this.noiseNode?.stop();
    } catch {
      // noop
    }
    this.playing = false;
    this.oscillators = [];
    this.noiseNode = null;
    this.noiseGain = null;
    this.masterGain = null;
  }

  private applyGain(intensity: number): void {
    if (!this.masterGain) return;
    const settings = this.settings;
    const base = settings ? settings.masterVolume * settings.musicVolume : 0.4;
    this.masterGain.gain.value = 0.04 + base * 0.08 + intensity * 0.012;
  }
}
