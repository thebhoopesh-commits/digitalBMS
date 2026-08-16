import { IAudioManager, SurfaceType } from '../types';

/**
 * Pure Procedural Web Audio API Synthesizer
 * Generates footsteps, interaction chirps, chimes, coffee brewing, and ambient HVAC drone.
 * ZERO external audio files (0 KB network overhead).
 */
export class AudioManager implements IAudioManager {
  public isMuted: boolean = false;
  public masterVolume: number = 0.7;
  public isAmbientPlaying: boolean = false;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientOsc1: OscillatorNode | null = null;
  private ambientOsc2: OscillatorNode | null = null;
  private ambientNoiseNode: AudioBufferSourceNode | null = null;

  private isUnlocked: boolean = false;
  private noiseBuffer: AudioBuffer | null = null;

  constructor() {
    // AudioContext will be initialized upon user gesture or init() call
  }

  /**
   * Initializes AudioContext and builds procedural audio graph
   */
  public async init(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        try {
          await this.ctx.resume();
          this.isUnlocked = true;
        } catch (e) {
          console.warn('[AudioManager] Context resume error:', e);
        }
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        console.warn('[AudioManager] Web Audio API is not supported in this environment.');
        return;
      }

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : this.masterVolume;
      this.masterGain.connect(this.ctx.destination);

      // Pre-generate procedural white noise buffer for footsteps and steam
      this.generateNoiseBuffer();

      // Setup ambient background drone
      this.setupAmbientDrone();

      this.isUnlocked = this.ctx.state === 'running';
      this.setupUnlockListeners();
    } catch (e) {
      console.warn('[AudioManager] Failed to initialize AudioContext:', e);
    }
  }

  private setupUnlockListeners(): void {
    const unlock = async () => {
      if (this.ctx && this.ctx.state === 'suspended') {
        try {
          await this.ctx.resume();
          this.isUnlocked = true;
          if (this.isAmbientPlaying) {
            this.setAmbientEnabled(true);
          }
        } catch (e) {
          // Ignore
        }
      }
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  private ensureContext(): boolean {
    if (!this.ctx) {
      this.init();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return !!this.ctx && !!this.masterGain;
  }

  private generateNoiseBuffer(): void {
    if (!this.ctx) return;
    const sampleRate = this.ctx.sampleRate;
    const bufferSize = sampleRate * 2; // 2 seconds of noise
    const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  }

  /**
   * Footstep sound synthesizer with surface-dependent frequency response
   */
  public playFootstep(surface: SurfaceType = 'carpet'): void {
    if (this.isMuted || !this.ensureContext() || !this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;

    // 1. Sub-bass / low-frequency transient thump
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();

    osc.type = 'sine';
    let startFreq = 80;
    let endFreq = 40;
    let duration = 0.08;
    let volume = 0.35;

    switch (surface) {
      case 'carpet':
        startFreq = 70;
        endFreq = 35;
        duration = 0.07;
        volume = 0.28;
        break;
      case 'tile':
        startFreq = 120;
        endFreq = 55;
        duration = 0.09;
        volume = 0.45;
        break;
      case 'wood':
        startFreq = 95;
        endFreq = 45;
        duration = 0.08;
        volume = 0.38;
        break;
      case 'metal':
        startFreq = 160;
        endFreq = 80;
        duration = 0.10;
        volume = 0.42;
        break;
    }

    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

    oscGain.gain.setValueAtTime(volume, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration);

    // 2. High-frequency friction / scuff noise layer
    if (this.noiseBuffer) {
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      const noiseGain = this.ctx.createGain();

      if (surface === 'tile') {
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1400, now);
        filter.Q.setValueAtTime(1.5, now);
        noiseGain.gain.setValueAtTime(0.18, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      } else if (surface === 'wood') {
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(600, now);
        noiseGain.gain.setValueAtTime(0.12, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      } else if (surface === 'metal') {
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(2200, now);
        filter.Q.setValueAtTime(3.0, now);
        noiseGain.gain.setValueAtTime(0.20, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      } else {
        // Carpet
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(320, now);
        noiseGain.gain.setValueAtTime(0.08, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      }

      noiseSource.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.masterGain);

      noiseSource.start(now);
      noiseSource.stop(now + 0.08);
    }
  }

  /**
   * Crisp UI interaction click / blip
   */
  public playClick(): void {
    if (this.isMuted || !this.ensureContext() || !this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.03);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.04);
  }

  /**
   * Harmonic dual-bell chime for slide changes and notifications
   */
  public playChime(): void {
    if (this.isMuted || !this.ensureContext() || !this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const freqs = [587.33, 880.0]; // D5 and A5 harmonious interval

    freqs.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);

      gain.gain.setValueAtTime(0.25, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.8);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.85);
    });
  }

  /**
   * Espresso coffee machine brewing sound (bubbling pump + steam hiss)
   */
  public playCoffeeBrew(): void {
    if (this.isMuted || !this.ensureContext() || !this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const duration = 2.2;

    // 1. Steam Hiss (Filtered White Noise)
    if (this.noiseBuffer) {
      const steamSource = this.ctx.createBufferSource();
      steamSource.buffer = this.noiseBuffer;
      steamSource.loop = true;

      const steamFilter = this.ctx.createBiquadFilter();
      steamFilter.type = 'bandpass';
      steamFilter.frequency.setValueAtTime(1200, now);
      steamFilter.frequency.linearRampToValueAtTime(2400, now + 1.0);
      steamFilter.frequency.linearRampToValueAtTime(800, now + duration);
      steamFilter.Q.setValueAtTime(2.0, now);

      const steamGain = this.ctx.createGain();
      steamGain.gain.setValueAtTime(0.001, now);
      steamGain.gain.linearRampToValueAtTime(0.22, now + 0.3);
      steamGain.gain.setValueAtTime(0.22, now + duration - 0.5);
      steamGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      steamSource.connect(steamFilter);
      steamFilter.connect(steamGain);
      steamGain.connect(this.masterGain);

      steamSource.start(now);
      steamSource.stop(now + duration);
    }

    // 2. Low-frequency pump vibration
    const pumpOsc = this.ctx.createOscillator();
    const pumpGain = this.ctx.createGain();

    pumpOsc.type = 'sawtooth';
    pumpOsc.frequency.setValueAtTime(60, now);

    pumpGain.gain.setValueAtTime(0.001, now);
    pumpGain.gain.linearRampToValueAtTime(0.15, now + 0.2);
    pumpGain.gain.setValueAtTime(0.15, now + duration - 0.3);
    pumpGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    pumpOsc.connect(pumpGain);
    pumpGain.connect(this.masterGain);

    pumpOsc.start(now);
    pumpOsc.stop(now + duration);
  }

  /**
   * Sliding glass door opening/closing sound
   */
  public playDoorSound(open: boolean = true): void {
    if (this.isMuted || !this.ensureContext() || !this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const duration = 0.6;

    if (this.noiseBuffer) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      if (open) {
        filter.frequency.setValueAtTime(300, now);
        filter.frequency.linearRampToValueAtTime(900, now + duration);
      } else {
        filter.frequency.setValueAtTime(900, now);
        filter.frequency.linearRampToValueAtTime(300, now + duration);
      }
      filter.Q.setValueAtTime(3.0, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      source.start(now);
      source.stop(now + duration);
    }
  }

  /**
   * Crisp mechanical light switch click
   */
  public playLightSwitch(_on: boolean = true): void {
    if (this.isMuted || !this.ensureContext() || !this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(1800, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.02);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.03);
  }

  /**
   * Ambient low-frequency HVAC office ventilation hum
   */
  private setupAmbientDrone(): void {
    if (!this.ctx || !this.masterGain) return;

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.0;
    this.ambientGain.connect(this.masterGain);

    // Twin detuned sub oscillators for organic warmth
    this.ambientOsc1 = this.ctx.createOscillator();
    this.ambientOsc1.type = 'sine';
    this.ambientOsc1.frequency.value = 55.0; // A1

    this.ambientOsc2 = this.ctx.createOscillator();
    this.ambientOsc2.type = 'sine';
    this.ambientOsc2.frequency.value = 56.2; // 1.2 Hz beating

    const oscGain = this.ctx.createGain();
    oscGain.gain.value = 0.4;

    this.ambientOsc1.connect(oscGain);
    this.ambientOsc2.connect(oscGain);
    oscGain.connect(this.ambientGain);

    this.ambientOsc1.start();
    this.ambientOsc2.start();

    // Subtle filtered air whisper
    if (this.noiseBuffer) {
      this.ambientNoiseNode = this.ctx.createBufferSource();
      this.ambientNoiseNode.buffer = this.noiseBuffer;
      this.ambientNoiseNode.loop = true;

      const airFilter = this.ctx.createBiquadFilter();
      airFilter.type = 'lowpass';
      airFilter.frequency.value = 180;

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.value = 0.25;

      this.ambientNoiseNode.connect(airFilter);
      airFilter.connect(noiseGain);
      noiseGain.connect(this.ambientGain);

      this.ambientNoiseNode.start();
    }
  }

  public setAmbientEnabled(enabled: boolean): void {
    this.isAmbientPlaying = enabled;
    if (!this.ambientGain || !this.ctx) return;

    const now = this.ctx.currentTime;
    const targetVol = enabled && !this.isMuted ? 0.05 : 0.0;
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.linearRampToValueAtTime(targetVol, now + 0.5);
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.masterVolume, this.ctx.currentTime);
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.masterVolume, this.ctx.currentTime);
    }
    return this.isMuted;
  }
}
