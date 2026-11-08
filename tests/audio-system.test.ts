import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LocalAudioEngine,
  dispatchAudioCue,
  getPentatonicScore,
  normalizeAudioPreferences,
  readAudioPreferences,
  type AudioPreferenceStore,
} from '../src/services/audio.ts';

const audioSource = readFileSync(new URL('../src/services/audio.ts', import.meta.url), 'utf8');
const studioSource = readFileSync(new URL('../src/scenes/studio.ts', import.meta.url), 'utf8');

class MemoryStore implements AudioPreferenceStore {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test('background music defaults off while restrained interaction effects default on', () => {
  assert.deepEqual(normalizeAudioPreferences(undefined), {
    musicEnabled: false,
    effectsEnabled: true,
  });
  assert.deepEqual(normalizeAudioPreferences({ musicEnabled: true }), {
    musicEnabled: true,
    effectsEnabled: true,
  });
});

test('audio preferences persist locally and tolerate blocked or corrupt storage', () => {
  const store = new MemoryStore();
  const engine = new LocalAudioEngine(store);
  assert.equal(engine.toggleEffects(), false);
  assert.equal(engine.toggleMusic(), true);
  assert.deepEqual(readAudioPreferences(store), {
    musicEnabled: true,
    effectsEnabled: false,
  });
  engine.destroy();

  const blocked: AudioPreferenceStore = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.deepEqual(readAudioPreferences(blocked), {
    musicEnabled: false,
    effectsEnabled: true,
  });
});

test('the original background score stays inside the D gong pentatonic scale', () => {
  const score = getPentatonicScore();
  const allowedPitchClasses = new Set([2, 4, 6, 9, 11]);
  assert.ok(score.length >= 20);
  assert.ok(score.every((note) => allowedPitchClasses.has(note.midi % 12)));
  assert.ok(score.every((note, index) => index === 0 || note.beat > score[index - 1].beat));
  assert.ok(score.every((note) => note.duration > 0 && note.level > 0 && Math.abs(note.pan) <= 1));
});

test('the soundscape is synthesized locally and is safe to import without browser audio APIs', () => {
  assert.doesNotMatch(audioSource, /\bfetch\s*\(|https?:\/\//u);
  assert.doesNotThrow(() => dispatchAudioCue('click'));
});

test('each newly completed batch card dispatches one card-created cue without phase duplicates', () => {
  assert.match(studioSource, /progress\.phase === 'optimizing'/u);
  assert.match(studioSource, /progress\.completed > previousCompleted/u);
  assert.match(
    studioSource,
    /for \(let index = 0; index < newlyCompleted; index \+= 1\) \{\s*dispatchAudioCue\('card-created'\);/u,
  );
  assert.match(audioSource, /this\.nextCardCreatedAt = at \+ 0\.085/u);
});
