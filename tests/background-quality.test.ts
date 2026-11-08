import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAdaptiveBackgroundQuality,
  BACKGROUND_FAST_FRAME_MS,
  BACKGROUND_SLOW_FRAME_MS,
  BACKGROUND_RESIZE_SETTLE_MS,
  calculateBackgroundQuality,
  INITIAL_BACKGROUND_ADAPTIVE_STATE,
  MAX_BACKGROUND_PARTICLES,
  remapBackgroundCoordinate,
  updateBackgroundAdaptiveState,
} from '../src/background-quality.ts';
import { getRecommendedDpr } from '../src/utils.ts';

test('keeps the full immortal-field budget on a capable desktop', () => {
  const profile = calculateBackgroundQuality(1440, 900, {
    devicePixelRatio: 1.5,
    displayPixelRatio: 1.5,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
  });

  assert.equal(profile.tier, 'rich');
  assert.equal(profile.cloudLayers, 3);
  assert.equal(profile.updateEvery, 1);
  assert.equal(
    profile.farFlecks + profile.goldDust + profile.fireflies + profile.lightPetals,
    MAX_BACKGROUND_PARTICLES,
  );
});

test('keeps capped high-pixel desktops out of the rich background tier', () => {
  const displayDpr = 2;
  const renderDpr = getRecommendedDpr(2560, 1080, displayDpr);
  const profile = calculateBackgroundQuality(2560, 1080, {
    devicePixelRatio: renderDpr,
    displayPixelRatio: displayDpr,
    hardwareConcurrency: 10,
    deviceMemoryGb: 16,
  });

  assert.equal(renderDpr, 1.25, 'the renderer should apply its physical-pixel cap first');
  assert.equal(profile.tier, 'balanced');
  assert.equal(profile.cloudLayers, 2);
  assert.ok(profile.farFlecks < 42);
});

test('uses the native display load to protect very large high-DPR canvases', () => {
  const displayDpr = 2;
  const renderDpr = getRecommendedDpr(3840, 2160, displayDpr);
  const profile = calculateBackgroundQuality(3840, 2160, {
    devicePixelRatio: renderDpr,
    displayPixelRatio: displayDpr,
    hardwareConcurrency: 12,
    deviceMemoryGb: 16,
  });

  assert.equal(renderDpr, 0.75);
  assert.equal(profile.tier, 'minimal');
  assert.equal(profile.updateEvery, 2);
});

test('reduces particles for phones, low-height canvases and limited hardware', () => {
  const phone = calculateBackgroundQuality(390, 844, {
    mobile: true,
    devicePixelRatio: 1.5,
  });
  const lowHeight = calculateBackgroundQuality(1280, 540, {
    devicePixelRatio: 1.5,
  });
  const limitedCpu = calculateBackgroundQuality(1366, 768, {
    devicePixelRatio: 1,
    hardwareConcurrency: 4,
  });

  for (const profile of [phone, lowHeight, limitedCpu]) {
    assert.equal(profile.tier, 'minimal');
    assert.equal(profile.cloudLayers, 1);
    assert.equal(profile.updateEvery, 2);
    assert.ok(profile.fireflies <= 4);
  }
});

test('uses a middle budget for compact desktop and tablet-sized layouts', () => {
  const profile = calculateBackgroundQuality(1024, 768, {
    devicePixelRatio: 1.5,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
  });

  assert.equal(profile.tier, 'balanced');
  assert.equal(profile.cloudLayers, 2);
  assert.ok(profile.goldDust > 8 && profile.goldDust < 28);
});

test('treats high render-pixel pressure and reduced motion as minimal', () => {
  const highPixel = calculateBackgroundQuality(2560, 1440, {
    devicePixelRatio: 2,
    hardwareConcurrency: 12,
    deviceMemoryGb: 16,
  });
  const reduced = calculateBackgroundQuality(1440, 900, {
    devicePixelRatio: 1,
    reducedMotion: true,
  });

  assert.equal(highPixel.tier, 'minimal');
  assert.equal(reduced.tier, 'minimal');
  assert.ok(MAX_BACKGROUND_PARTICLES <= 96, 'the global object pool must remain bounded');
});

test('remaps particle positions proportionally without randomizing resize continuity', () => {
  assert.equal(remapBackgroundCoordinate(320, 1280, 1920), 480);
  assert.equal(remapBackgroundCoordinate(270, 540, 900), 450);
  assert.equal(remapBackgroundCoordinate(-12, 1200, 600), -6);
  assert.equal(remapBackgroundCoordinate(48, 0, 900), 48);
  assert.equal(remapBackgroundCoordinate(Number.NaN, 100, 200), 0);
  assert.ok(
    BACKGROUND_RESIZE_SETTLE_MS >= 100 && BACKGROUND_RESIZE_SETTLE_MS <= 200,
    'static geometry should settle after live resize without feeling delayed',
  );
});

test('runtime frame pressure degrades with hysteresis and recovers gradually', () => {
  let state = { ...INITIAL_BACKGROUND_ADAPTIVE_STATE };
  state = updateBackgroundAdaptiveState(state, BACKGROUND_SLOW_FRAME_MS + 3);
  assert.equal(state.level, 0, 'one slow sample window must not lower visual quality');
  state = updateBackgroundAdaptiveState(state, BACKGROUND_SLOW_FRAME_MS + 3);
  assert.equal(state.level, 1);
  state = updateBackgroundAdaptiveState(state, BACKGROUND_SLOW_FRAME_MS + 3);
  state = updateBackgroundAdaptiveState(state, BACKGROUND_SLOW_FRAME_MS + 3);
  assert.equal(state.level, 2);

  for (let index = 0; index < 5; index += 1) {
    state = updateBackgroundAdaptiveState(state, BACKGROUND_FAST_FRAME_MS - 1);
  }
  assert.equal(state.level, 2, 'recovery requires a sustained fast period');
  state = updateBackgroundAdaptiveState(state, BACKGROUND_FAST_FRAME_MS - 1);
  assert.equal(state.level, 1);
});

test('adaptive quality never exceeds the device-derived tier', () => {
  const rich = calculateBackgroundQuality(1440, 900, {
    devicePixelRatio: 1,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
  });
  assert.equal(applyAdaptiveBackgroundQuality(rich, 1).tier, 'balanced');
  assert.equal(applyAdaptiveBackgroundQuality(rich, 2).tier, 'minimal');

  const constrained = calculateBackgroundQuality(390, 844, { mobile: true });
  assert.equal(constrained.tier, 'minimal');
  assert.equal(applyAdaptiveBackgroundQuality(constrained, 0).tier, 'minimal');
});
