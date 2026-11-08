export type AudioCue =
  | 'click'
  | 'toggle'
  | 'card-flip'
  | 'card-pick'
  | 'card-drop'
  | 'card-created'
  | 'scene-transition'
  | 'success';

export interface AudioPreferences {
  musicEnabled: boolean;
  effectsEnabled: boolean;
}

export interface AudioPreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PentatonicNote {
  beat: number;
  midi: number;
  duration: number;
  level: number;
  pan: number;
  color?: 'silk' | 'jade';
}

const PREFERENCE_KEY = 'wanxiang-deck:audio:v1';
const DEFAULT_PREFERENCES: Readonly<AudioPreferences> = {
  musicEnabled: false,
  effectsEnabled: true,
};

const MUSIC_GAIN = 0.115;
const EFFECTS_GAIN = 0.27;
const SCORE_BEATS = 32;
const SECONDS_PER_BEAT = 60 / 76;
const SCHEDULE_AHEAD_SECONDS = 1.2;

const PENTATONIC_SCORE: readonly PentatonicNote[] = [
  { beat: 0, midi: 62, duration: 2.2, level: 0.72, pan: -0.34 },
  { beat: 1.5, midi: 69, duration: 1.2, level: 0.48, pan: 0.26, color: 'jade' },
  { beat: 2.75, midi: 71, duration: 1.5, level: 0.54, pan: 0.08 },
  { beat: 4, midi: 69, duration: 2.2, level: 0.62, pan: -0.18 },
  { beat: 5.5, midi: 66, duration: 1.2, level: 0.48, pan: 0.32 },
  { beat: 7, midi: 64, duration: 1.4, level: 0.46, pan: -0.1, color: 'jade' },
  { beat: 8, midi: 62, duration: 2.8, level: 0.7, pan: -0.28 },
  { beat: 10, midi: 64, duration: 1.2, level: 0.46, pan: 0.24 },
  { beat: 11.25, midi: 66, duration: 1.5, level: 0.54, pan: 0.08 },
  { beat: 12.75, midi: 69, duration: 2.4, level: 0.64, pan: -0.16 },
  { beat: 14.5, midi: 71, duration: 1.3, level: 0.48, pan: 0.32, color: 'jade' },
  { beat: 15.5, midi: 69, duration: 1.8, level: 0.56, pan: 0.02 },
  { beat: 17, midi: 66, duration: 2.4, level: 0.62, pan: -0.3 },
  { beat: 18.75, midi: 69, duration: 1.2, level: 0.45, pan: 0.28 },
  { beat: 20, midi: 74, duration: 2.5, level: 0.67, pan: 0.1, color: 'jade' },
  { beat: 22, midi: 71, duration: 1.4, level: 0.5, pan: -0.18 },
  { beat: 23.25, midi: 69, duration: 1.6, level: 0.52, pan: 0.24 },
  { beat: 24.5, midi: 66, duration: 2.3, level: 0.6, pan: -0.24 },
  { beat: 26.25, midi: 64, duration: 1.2, level: 0.44, pan: 0.26, color: 'jade' },
  { beat: 27.5, midi: 62, duration: 2.2, level: 0.68, pan: -0.04 },
  { beat: 29, midi: 69, duration: 1.2, level: 0.42, pan: 0.3 },
  { beat: 30.25, midi: 64, duration: 1.6, level: 0.48, pan: -0.2 },
] as const;

export const AUDIO_CUE_EVENT = 'wanxiang-deck:audio-cue';

export function normalizeAudioPreferences(value: unknown): AudioPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PREFERENCES };
  const candidate = value as Partial<AudioPreferences>;
  return {
    musicEnabled:
      typeof candidate.musicEnabled === 'boolean'
        ? candidate.musicEnabled
        : DEFAULT_PREFERENCES.musicEnabled,
    effectsEnabled:
      typeof candidate.effectsEnabled === 'boolean'
        ? candidate.effectsEnabled
        : DEFAULT_PREFERENCES.effectsEnabled,
  };
}

export function readAudioPreferences(store?: AudioPreferenceStore): AudioPreferences {
  if (!store) return { ...DEFAULT_PREFERENCES };
  try {
    const raw = store.getItem(PREFERENCE_KEY);
    return raw ? normalizeAudioPreferences(JSON.parse(raw)) : { ...DEFAULT_PREFERENCES };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function getPentatonicScore(): readonly PentatonicNote[] {
  return PENTATONIC_SCORE;
}

function browserPreferenceStore(): AudioPreferenceStore | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function midiFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

type TrackedSource = OscillatorNode | AudioBufferSourceNode;

/**
 * Fully local Web Audio soundscape. The context is intentionally created only
 * from a user gesture so desktop WebViews and browsers both respect autoplay.
 */
export class LocalAudioEngine {
  private readonly store?: AudioPreferenceStore;
  private preferences: AudioPreferences;
  private readonly subscribers = new Set<(preferences: AudioPreferences) => void>();
  private readonly lastCueAt = new Map<AudioCue, number>();
  private context?: AudioContext;
  private master?: GainNode;
  private effectsBus?: GainNode;
  private musicBus?: GainNode;
  private reverbInput?: GainNode;
  private noiseBuffer?: AudioBuffer;
  private musicTimer?: number;
  private musicCursor = 0;
  private musicLoop = 0;
  private musicOrigin = 0;
  private unlocked = false;
  private disposed = false;
  private lastSpecificCueAt = -Infinity;
  private nextCardCreatedAt = 0;
  private readonly musicSources = new Set<TrackedSource>();
  private readonly effectSources = new Set<TrackedSource>();
  private detachLifecycle?: () => void;

  constructor(store: AudioPreferenceStore | undefined = browserPreferenceStore()) {
    this.store = store;
    this.preferences = readAudioPreferences(store);
  }

  getPreferences(): AudioPreferences {
    return { ...this.preferences };
  }

  subscribe(listener: (preferences: AudioPreferences) => void): () => void {
    this.subscribers.add(listener);
    listener(this.getPreferences());
    return () => this.subscribers.delete(listener);
  }

  /** Called by the root pointer capture handler while the native gesture is active. */
  activateFromGesture(): void {
    if (this.disposed) return;
    this.unlocked = true;
    const context = this.ensureContext();
    if (!context) return;
    const resumed = context.state === 'suspended' ? context.resume() : Promise.resolve();
    void resumed.then(() => {
      if (!this.disposed && this.preferences.musicEnabled) this.startMusic();
    }).catch(() => undefined);
  }

  /**
   * Defers the ordinary click until target handlers have had a chance to play a
   * richer cue. This keeps a flip, drop, or scene change from double-triggering.
   */
  handleInteractiveTap(): void {
    this.activateFromGesture();
    const requestedAt = nowMs();
    queueMicrotask(() => {
      if (this.lastSpecificCueAt >= requestedAt - 1) return;
      this.play('click');
    });
  }

  play(cue: AudioCue): void {
    const timestamp = nowMs();
    if (cue !== 'click') this.lastSpecificCueAt = timestamp;
    if (!this.preferences.effectsEnabled || this.disposed) return;
    const context = this.context;
    if (!context || !this.effectsBus || context.state === 'closed') return;
    const minimumInterval = cue === 'card-flip' ? 90 : cue === 'scene-transition' ? 220 : cue === 'card-created' ? 0 : 42;
    if (timestamp - (this.lastCueAt.get(cue) ?? -Infinity) < minimumInterval) return;
    if (cue === 'click' && timestamp - this.lastSpecificCueAt < 72) return;
    this.lastCueAt.set(cue, timestamp);

    const at = cue === 'card-created'
      ? Math.max(context.currentTime + 0.008, this.nextCardCreatedAt)
      : context.currentTime + 0.008;
    if (cue === 'card-created') this.nextCardCreatedAt = at + 0.085;
    switch (cue) {
      case 'click':
        this.tone(880, at, 0.075, 0.075, 'sine', this.effectsBus, 0.006, 0.85);
        this.tone(1320, at + 0.018, 0.055, 0.03, 'triangle', this.effectsBus, 0.004, 1);
        break;
      case 'toggle':
        this.tone(660, at, 0.09, 0.075, 'triangle', this.effectsBus, 0.006, 1.18);
        this.tone(990, at + 0.045, 0.12, 0.055, 'sine', this.effectsBus, 0.008, 1);
        break;
      case 'card-flip':
        this.noise(at, 0.16, 0.07, 1500, 0.75, this.effectsBus);
        this.tone(520, at + 0.035, 0.14, 0.055, 'triangle', this.effectsBus, 0.01, 1.42);
        break;
      case 'card-pick':
        this.noise(at, 0.09, 0.045, 1100, 1.25, this.effectsBus);
        this.tone(392, at + 0.018, 0.08, 0.04, 'triangle', this.effectsBus, 0.006, 1.08);
        break;
      case 'card-drop':
        this.tone(118, at, 0.16, 0.12, 'sine', this.effectsBus, 0.004, 0.56);
        this.noise(at + 0.005, 0.13, 0.08, 620, 0.55, this.effectsBus);
        this.tone(330, at + 0.045, 0.1, 0.035, 'triangle', this.effectsBus, 0.004, 0.86);
        break;
      case 'card-created':
        this.tone(784, at, 0.18, 0.07, 'triangle', this.effectsBus, 0.008, 1);
        this.tone(1174.66, at + 0.07, 0.24, 0.055, 'sine', this.effectsBus, 0.008, 1);
        break;
      case 'scene-transition':
        this.noise(at, 0.42, 0.045, 900, 1.65, this.effectsBus);
        this.tone(220, at, 0.48, 0.055, 'sine', this.effectsBus, 0.018, 1.52);
        this.tone(659.25, at + 0.13, 0.42, 0.045, 'triangle', this.effectsBus, 0.018, 1.01);
        break;
      case 'success':
        this.tone(587.33, at, 0.18, 0.065, 'triangle', this.effectsBus, 0.006, 1);
        this.tone(880, at + 0.09, 0.24, 0.06, 'sine', this.effectsBus, 0.008, 1);
        this.tone(1174.66, at + 0.18, 0.32, 0.05, 'sine', this.effectsBus, 0.008, 1);
        break;
    }
  }

  toggleMusic(fromUserGesture = false): boolean {
    if (fromUserGesture) this.activateFromGesture();
    const enabled = !this.preferences.musicEnabled;
    this.updatePreferences({ musicEnabled: enabled });
    this.play('toggle');
    if (enabled) this.startMusic();
    else this.stopMusic();
    return enabled;
  }

  toggleEffects(fromUserGesture = false): boolean {
    if (fromUserGesture) this.activateFromGesture();
    const enabled = !this.preferences.effectsEnabled;
    if (!enabled) this.play('toggle');
    this.updatePreferences({ effectsEnabled: enabled });
    if (enabled) this.play('toggle');
    return enabled;
  }

  setMusicEnabled(enabled: boolean): void {
    if (enabled === this.preferences.musicEnabled) return;
    this.updatePreferences({ musicEnabled: enabled });
    if (enabled && this.unlocked) this.startMusic();
    else if (!enabled) this.stopMusic();
  }

  bindLifecycle(): () => void {
    if (this.disposed) {
      this.disposed = false;
      this.unlocked = false;
      this.preferences = readAudioPreferences(this.store);
    }
    if (this.detachLifecycle || typeof window === 'undefined' || typeof document === 'undefined') {
      return this.detachLifecycle ?? (() => undefined);
    }
    const handleCue = (event: Event): void => {
      const cue = (event as CustomEvent<AudioCue>).detail;
      if (cue) this.play(cue);
    };
    const handleVisibility = (): void => {
      const context = this.context;
      if (!context || context.state === 'closed') return;
      if (document.hidden) {
        void context.suspend().catch(() => undefined);
      } else if (this.unlocked) {
        void context.resume().then(() => {
          if (this.preferences.musicEnabled) this.startMusic();
        }).catch(() => undefined);
      }
    };
    window.addEventListener(AUDIO_CUE_EVENT, handleCue);
    document.addEventListener('visibilitychange', handleVisibility);
    this.detachLifecycle = () => {
      window.removeEventListener(AUDIO_CUE_EVENT, handleCue);
      document.removeEventListener('visibilitychange', handleVisibility);
      this.detachLifecycle = undefined;
    };
    return this.detachLifecycle;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachLifecycle?.();
    this.stopMusic();
    this.stopSources(this.effectSources);
    const context = this.context;
    this.context = undefined;
    this.master = undefined;
    this.effectsBus = undefined;
    this.musicBus = undefined;
    this.reverbInput = undefined;
    this.noiseBuffer = undefined;
    this.nextCardCreatedAt = 0;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    this.subscribers.clear();
  }

  private updatePreferences(patch: Partial<AudioPreferences>): void {
    this.preferences = { ...this.preferences, ...patch };
    try {
      this.store?.setItem(PREFERENCE_KEY, JSON.stringify(this.preferences));
    } catch {
      // Audio remains usable when private browsing or a hardened WebView blocks storage.
    }
    const snapshot = this.getPreferences();
    this.subscribers.forEach((listener) => listener(snapshot));
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context || this.disposed || typeof window === 'undefined') return this.context;
    const AudioContextConstructor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return undefined;
    const context = new AudioContextConstructor({ latencyHint: 'interactive' });
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.22;

    const master = context.createGain();
    master.gain.value = 0.78;
    const effectsBus = context.createGain();
    effectsBus.gain.value = EFFECTS_GAIN;
    const musicBus = context.createGain();
    musicBus.gain.value = this.preferences.musicEnabled ? MUSIC_GAIN : 0;
    const reverbInput = context.createGain();
    reverbInput.gain.value = 0.22;
    const convolver = context.createConvolver();
    convolver.buffer = this.createReverbImpulse(context);
    const reverbReturn = context.createGain();
    reverbReturn.gain.value = 0.2;

    effectsBus.connect(master);
    musicBus.connect(master);
    musicBus.connect(reverbInput);
    reverbInput.connect(convolver);
    convolver.connect(reverbReturn);
    reverbReturn.connect(master);
    master.connect(compressor);
    compressor.connect(context.destination);

    this.context = context;
    this.master = master;
    this.effectsBus = effectsBus;
    this.musicBus = musicBus;
    this.reverbInput = reverbInput;
    this.noiseBuffer = this.createNoiseBuffer(context);
    return context;
  }

  private startMusic(): void {
    const context = this.context;
    const bus = this.musicBus;
    if (!context || !bus || !this.preferences.musicEnabled || context.state === 'closed') return;
    bus.gain.cancelScheduledValues(context.currentTime);
    bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), context.currentTime);
    bus.gain.exponentialRampToValueAtTime(MUSIC_GAIN, context.currentTime + 0.8);
    if (this.musicTimer !== undefined) return;
    this.musicOrigin = context.currentTime + 0.08;
    this.musicCursor = 0;
    this.musicLoop = 0;
    this.scheduleMusic();
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 240);
  }

  private stopMusic(): void {
    if (this.musicTimer !== undefined && typeof window !== 'undefined') {
      window.clearInterval(this.musicTimer);
      this.musicTimer = undefined;
    }
    const context = this.context;
    const bus = this.musicBus;
    if (context && bus && context.state !== 'closed') {
      bus.gain.cancelScheduledValues(context.currentTime);
      bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), context.currentTime);
      bus.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
    }
    this.stopSources(this.musicSources, context ? context.currentTime + 0.24 : undefined);
  }

  private scheduleMusic(): void {
    const context = this.context;
    const bus = this.musicBus;
    if (!context || !bus || !this.preferences.musicEnabled || document.hidden) return;
    const horizon = context.currentTime + SCHEDULE_AHEAD_SECONDS;
    while (this.musicCursor < PENTATONIC_SCORE.length) {
      const note = PENTATONIC_SCORE[this.musicCursor];
      const at = this.musicOrigin + (this.musicLoop * SCORE_BEATS + note.beat) * SECONDS_PER_BEAT;
      if (at > horizon) break;
      if (at >= context.currentTime - 0.04) {
        this.pluck(
          midiFrequency(note.midi),
          at,
          note.duration * SECONDS_PER_BEAT,
          note.level * 0.13,
          note.pan,
          note.color ?? 'silk',
        );
        if (note.beat % 8 === 0) {
          this.tone(
            midiFrequency(note.midi - 12),
            at,
            Math.min(5.5, note.duration * SECONDS_PER_BEAT * 1.8),
            0.018,
            'sine',
            bus,
            0.18,
            1,
            true,
          );
        }
      }
      this.musicCursor += 1;
      if (this.musicCursor >= PENTATONIC_SCORE.length) {
        this.musicCursor = 0;
        this.musicLoop += 1;
      }
    }
  }

  private pluck(
    frequency: number,
    at: number,
    duration: number,
    level: number,
    pan: number,
    color: 'silk' | 'jade',
  ): void {
    const context = this.context;
    const bus = this.musicBus;
    if (!context || !bus) return;
    const voice = context.createGain();
    voice.gain.setValueAtTime(0.0001, at);
    voice.gain.exponentialRampToValueAtTime(level, at + 0.012);
    voice.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.18, duration));
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(color === 'jade' ? 3400 : 2450, at);
    filter.frequency.exponentialRampToValueAtTime(980, at + Math.max(0.2, duration));
    filter.Q.value = color === 'jade' ? 1.4 : 0.75;
    const panner = context.createStereoPanner();
    panner.pan.value = Math.max(-0.7, Math.min(0.7, pan));
    voice.connect(filter);
    filter.connect(panner);
    panner.connect(bus);

    const fundamental = context.createOscillator();
    fundamental.type = 'triangle';
    fundamental.frequency.setValueAtTime(frequency * 1.008, at);
    fundamental.frequency.exponentialRampToValueAtTime(frequency, at + 0.055);
    fundamental.connect(voice);
    this.trackSource(fundamental, true);
    fundamental.start(at);
    fundamental.stop(at + duration + 0.08);

    const overtone = context.createOscillator();
    const overtoneGain = context.createGain();
    overtone.type = 'sine';
    overtone.frequency.value = frequency * (color === 'jade' ? 3.01 : 2.01);
    overtoneGain.gain.value = color === 'jade' ? 0.17 : 0.1;
    overtone.connect(overtoneGain);
    overtoneGain.connect(voice);
    this.trackSource(overtone, true);
    overtone.start(at);
    overtone.stop(at + Math.min(duration, 1.5));

    this.noise(at, 0.038, level * 0.32, frequency * 3.2, 1.4, voice, true);
  }

  private tone(
    frequency: number,
    at: number,
    duration: number,
    level: number,
    wave: OscillatorType,
    destination: AudioNode,
    attack: number,
    endFrequencyRatio: number,
    music = false,
  ): void {
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * endFrequencyRatio), at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    gain.connect(destination);
    this.trackSource(oscillator, music);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.03);
  }

  private noise(
    at: number,
    duration: number,
    level: number,
    frequency: number,
    q: number,
    destination: AudioNode,
    music = false,
  ): void {
    const context = this.context;
    const buffer = this.noiseBuffer;
    if (!context || !buffer) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = Math.max(80, frequency);
    filter.Q.value = q;
    gain.gain.setValueAtTime(Math.max(0.0001, level), at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    this.trackSource(source, music);
    source.start(at);
    source.stop(at + duration + 0.02);
  }

  private trackSource(source: TrackedSource, music: boolean): void {
    const collection = music ? this.musicSources : this.effectSources;
    collection.add(source);
    source.addEventListener('ended', () => collection.delete(source), { once: true });
  }

  private stopSources(sources: Set<TrackedSource>, at?: number): void {
    sources.forEach((source) => {
      try {
        source.stop(at);
      } catch {
        // Already-ended sources are harmless and are removed below.
      }
    });
    sources.clear();
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const length = Math.ceil(context.sampleRate * 0.55);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x4f524945;
    for (let index = 0; index < length; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[index] = (seed / 0xffffffff) * 2 - 1;
    }
    return buffer;
  }

  private createReverbImpulse(context: AudioContext): AudioBuffer {
    const length = Math.ceil(context.sampleRate * 1.75);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      let seed = 0x54474b59 + channel * 7919;
      for (let index = 0; index < length; index += 1) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const noise = (seed / 0xffffffff) * 2 - 1;
        const decay = (1 - index / length) ** 2.7;
        data[index] = noise * decay * 0.52;
      }
    }
    return impulse;
  }
}

export function dispatchAudioCue(cue: AudioCue): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AudioCue>(AUDIO_CUE_EVENT, { detail: cue }));
}

export const audioEngine = new LocalAudioEngine();
