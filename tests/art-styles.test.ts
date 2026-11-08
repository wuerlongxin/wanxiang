import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ART_STYLE_PRESETS,
  DEFAULT_ART_STYLE_ID,
  artStylesForCategory,
  getArtStyleUiTheme,
  resolveArtStyle,
} from '../src/art-styles.ts';
import { readFileSync } from 'node:fs';

test('ships a broad visual catalog with an eastern-first selection', () => {
  const eastern = artStylesForCategory('eastern');
  const global = artStylesForCategory('global');

  assert.ok(ART_STYLE_PRESETS.length >= 18, 'the style catalog should remain broad');
  assert.ok(eastern.length >= 15, 'Chinese and eastern styles should dominate the catalog');
  assert.ok(global.length >= 3, 'global companion styles should remain available');
  assert.equal(eastern.length + global.length, ART_STYLE_PRESETS.length);

  const ids = ART_STYLE_PRESETS.map((preset) => preset.id);
  const names = ART_STYLE_PRESETS.map((preset) => preset.name);
  assert.equal(new Set(ids).size, ids.length, 'style identifiers must be unique');
  assert.equal(new Set(names).size, names.length, 'visible style names must be unique');

  for (const preset of ART_STYLE_PRESETS) {
    assert.ok(preset.tagline.length >= 6, `${preset.id} should include a visible sample-card tagline`);
    assert.ok(preset.description.length >= 16, `${preset.id} should explain its material language`);
    assert.ok(preset.prompt.length >= 80, `${preset.id} should include a production art-direction prompt`);

    const colors = Object.values(preset.palette);
    assert.equal(colors.length, 5);
    for (const color of colors) {
      assert.ok(Number.isInteger(color) && color >= 0 && color <= 0xffffff, `${preset.id} palette color`);
    }

    const uiTheme = getArtStyleUiTheme(preset.id);
    assert.equal(uiTheme.motif, preset.motif);
    assert.equal(resolveArtStyle(preset.id).id, preset.id);
  }
});

test('keeps the Canvas catalog and desktop safety style list in lockstep', () => {
  const safetySource = readFileSync(
    new URL('../src-tauri/src/safety.rs', import.meta.url),
    'utf8',
  );
  const clientIds = ART_STYLE_PRESETS.map((preset) => preset.id).sort();

  assert.equal(new Set(clientIds).size, clientIds.length, 'style identifiers must be unique');
  for (const preset of ART_STYLE_PRESETS) {
    assert.ok(
      safetySource.includes(`"${preset.id}"`),
      `${preset.id} must exist in the desktop safety style list`,
    );
  }
  assert.ok(safetySource.includes(`"${DEFAULT_ART_STYLE_ID}"`));
});

