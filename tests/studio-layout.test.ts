import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getStudioLowHeightLandscapeLayout,
  isStudioLowHeightLandscape,
  type StudioRect,
} from '../src/scenes/studio-layout.ts';
import { getViewport } from '../src/utils.ts';

const TARGET_VIEWPORTS = [
  [896, 414],
  [740, 360],
  [960, 540],
] as const;

const EPSILON = 1e-6;
const CARD_RATIO = 88 / 63;

function canvasBounds(width: number, height: number): StudioRect {
  return { x: 0, y: 0, width, height, right: width, bottom: height };
}

function assertFiniteRect(rect: StudioRect, label: string): void {
  for (const [key, value] of Object.entries(rect)) {
    assert.ok(Number.isFinite(value), `${label}.${key} must be finite`);
  }
  assert.ok(rect.width >= 0, `${label}.width must be non-negative`);
  assert.ok(rect.height >= 0, `${label}.height must be non-negative`);
  assert.equal(rect.right, rect.x + rect.width, `${label}.right`);
  assert.equal(rect.bottom, rect.y + rect.height, `${label}.bottom`);
}

function assertInside(rect: StudioRect, bounds: StudioRect, label: string): void {
  assertFiniteRect(rect, label);
  assert.ok(rect.x >= bounds.x - EPSILON, `${label}.x must stay inside`);
  assert.ok(rect.y >= bounds.y - EPSILON, `${label}.y must stay inside`);
  assert.ok(rect.right <= bounds.right + EPSILON, `${label}.right must stay inside`);
  assert.ok(rect.bottom <= bounds.bottom + EPSILON, `${label}.bottom must stay inside`);
}

test('selects the dedicated low-height landscape studio layout at every target size', () => {
  for (const [width, height] of TARGET_VIEWPORTS) {
    const viewport = getViewport(width, height, 1);
    assert.equal(isStudioLowHeightLandscape(viewport), true, `${width}x${height}`);
  }
});

test('keeps the preview, deck strip, and editor regions inside the safe canvas', () => {
  for (const [width, height] of TARGET_VIEWPORTS) {
    const layout = getStudioLowHeightLandscapeLayout(getViewport(width, height, 1));
    const canvas = canvasBounds(width, height);
    const label = `${width}x${height}`;

    assertInside(layout.content, canvas, `${label} content`);
    assertInside(layout.previewColumn, layout.content, `${label} preview column`);
    assertInside(layout.editorPanel, layout.content, `${label} editor panel`);
    assertInside(layout.cardArea, layout.previewColumn, `${label} card area`);
    assertInside(layout.deckStrip, layout.previewColumn, `${label} deck strip`);
    assertInside(layout.previewCard, layout.cardArea, `${label} preview card`);
    assertInside(layout.regenerateButton, layout.cardArea, `${label} regenerate button`);
    assertInside(layout.previewTag, layout.cardArea, `${label} preview tag`);
    assertInside(layout.editorContent, layout.editorPanel, `${label} editor content`);

    assert.ok(
      layout.previewColumn.right <= layout.editorPanel.x + EPSILON,
      `${label} preview/editor overlap`,
    );
    assert.ok(layout.cardArea.bottom <= layout.deckStrip.y, `${label} card area/strip overlap`);
    assert.ok(layout.previewCard.bottom <= layout.deckStrip.y, `${label} card/strip overlap`);
  }
});

test('preserves a complete, correctly proportioned main card above the thumbnail effects', () => {
  for (const [width, height] of TARGET_VIEWPORTS) {
    const layout = getStudioLowHeightLandscapeLayout(getViewport(width, height, 1));
    const label = `${width}x${height}`;

    assert.ok(layout.previewCard.width >= 110, `${label} card must remain legible`);
    assert.ok(
      Math.abs(layout.previewCard.height / layout.previewCard.width - CARD_RATIO) < EPSILON,
      `${label} card aspect ratio`,
    );
    const requiredOpticalGap = 24;
    assert.ok(
      layout.cardArea.bottom <= layout.deckStrip.y - requiredOpticalGap + EPSILON,
      `${label} strip optical clearance`,
    );
  }
});

test('keeps the theme row, editor tabs, and field area mutually exclusive', () => {
  for (const [width, height] of TARGET_VIEWPORTS) {
    const layout = getStudioLowHeightLandscapeLayout(getViewport(width, height, 1));
    const label = `${width}x${height}`;

    for (const [name, rect] of Object.entries({
      themeInput: layout.themeInput,
      contentPolicyButton: layout.contentPolicyButton,
      generateButton: layout.generateButton,
      tabs: layout.tabs,
      fields: layout.fields,
    })) {
      assertInside(rect, layout.editorContent, `${label} ${name}`);
    }

    assert.ok(layout.themeInput.width >= 120, `${label} theme input width`);
    assert.ok(layout.themeInput.height >= 60, `${label} theme input height`);
    assert.ok(
      layout.themeInput.right <= layout.contentPolicyButton.x,
      `${label} theme/policy overlap`,
    );
    assert.ok(
      layout.contentPolicyButton.right <= layout.generateButton.x,
      `${label} policy/generate overlap`,
    );
    assert.ok(layout.themeInput.bottom <= layout.tabs.y, `${label} theme/tabs overlap`);
    assert.ok(layout.contentPolicyButton.bottom <= layout.tabs.y, `${label} policy/tabs overlap`);
    assert.ok(layout.generateButton.bottom <= layout.tabs.y, `${label} generate/tabs overlap`);
    assert.ok(layout.tabs.bottom <= layout.fields.y, `${label} tabs/fields overlap`);
  }
});

test('fits the compact inscription editor into the field area without overlap', () => {
  for (const [width, height] of TARGET_VIEWPORTS) {
    const layout = getStudioLowHeightLandscapeLayout(getViewport(width, height, 1));
    const label = `${width}x${height}`;

    for (const [name, rect] of Object.entries({
      author: layout.markAuthor,
      style: layout.markStyle,
      placement: layout.markPlacement,
      cardBack: layout.markCardBackButton,
    })) {
      assertInside(rect, layout.fields, `${label} mark ${name}`);
    }

    assert.equal(layout.markAuthor.height, 60, `${label} author input real minimum height`);
    assert.ok(layout.markAuthor.bottom <= layout.markStyle.y, `${label} author/style overlap`);
    assert.ok(layout.markAuthor.bottom <= layout.markPlacement.y, `${label} author/placement overlap`);
    assert.ok(layout.markStyle.right <= layout.markPlacement.x, `${label} style/placement overlap`);
    assert.ok(layout.markStyle.bottom <= layout.markCardBackButton.y, `${label} style/card back overlap`);
    assert.ok(
      layout.markPlacement.bottom <= layout.markCardBackButton.y,
      `${label} placement/card back overlap`,
    );
  }
});
