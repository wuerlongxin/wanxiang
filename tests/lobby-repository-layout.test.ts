import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLobbyCoreLayout,
  getLobbyRepositoryLayout,
  type LobbyRepositoryRect,
} from '../src/scenes/lobby-repository-layout.ts';
import { getViewport } from '../src/utils.ts';

const VIEWPORTS = [
  [320, 568],
  [390, 640],
  [390, 844],
  [740, 360],
  [896, 414],
  [620, 900],
  [768, 1024],
  [960, 540],
  [1440, 900],
] as const;

function intersects(left: LobbyRepositoryRect, right: LobbyRepositoryRect): boolean {
  return left.x < right.right
    && left.right > right.x
    && left.y < right.bottom
    && left.bottom > right.y;
}

function coreBounds(width: number, height: number): LobbyRepositoryRect {
  return getLobbyCoreLayout(getViewport(width, height, 1));
}

function lobbyCardBounds(
  width: number,
  height: number,
  index: number,
): LobbyRepositoryRect {
  const cardWidth = Math.min(116, width * 0.28);
  const cardHeight = cardWidth * (88 / 63);
  const rotation = [-0.16, -0.08, 0, 0.08, 0.16][index];
  const maxSpread = width * 0.19;
  const offset = index - 2;
  const verticalOffset = Math.pow(Math.abs(offset), 1.45) * 10;
  const centerX = width / 2 + offset * maxSpread;
  const centerY = height - cardHeight * 0.48 - 34 + verticalOffset;
  const halfWidth = Math.abs(Math.cos(rotation)) * cardWidth / 2
    + Math.abs(Math.sin(rotation)) * cardHeight / 2;
  const halfHeight = Math.abs(Math.cos(rotation)) * cardHeight / 2
    + Math.abs(Math.sin(rotation)) * cardWidth / 2;
  return {
    x: centerX - halfWidth,
    y: centerY - halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
    right: centerX + halfWidth,
    bottom: centerY + halfHeight,
  };
}

test('keeps the GitHub plaque on-canvas and clear of the central forge card', () => {
  for (const [width, height] of VIEWPORTS) {
    const viewport = getViewport(width, height, 1);
    const layout = getLobbyRepositoryLayout(viewport);
    const core = coreBounds(width, height);

    assert.ok(layout.x >= viewport.safeLeft, `${width}x${height} left safe area`);
    assert.ok(layout.y >= viewport.profile.navigationHeight, `${width}x${height} navigation`);
    assert.ok(layout.right <= width - viewport.safeRight, `${width}x${height} right safe area`);
    assert.ok(layout.bottom <= height - viewport.safeBottom, `${width}x${height} bottom safe area`);
    assert.equal(intersects(layout, core), false, `${width}x${height} forge card overlap`);
  }
});

test('uses a compact stacked plaque only where portrait phone edge space is narrow', () => {
  assert.equal(getLobbyRepositoryLayout(getViewport(390, 844, 1)).stacked, true);
  assert.equal(getLobbyRepositoryLayout(getViewport(740, 360, 1)).stacked, false);
  assert.equal(getLobbyRepositoryLayout(getViewport(1440, 900, 1)).stacked, false);
});

test('keeps the landscape plaque between the AI service card and the fan-card band', () => {
  for (const [width, height] of [[740, 360], [896, 414]] as const) {
    const viewport = getViewport(width, height, 1);
    const layout = getLobbyRepositoryLayout(viewport);
    const serviceWidth = Math.min(176, width * 0.45);
    const aiService = {
      x: width - 18 - serviceWidth,
      y: 70,
      width: serviceWidth,
      height: 56,
      right: width - 18,
      bottom: 126,
    };

    assert.ok(aiService.bottom <= layout.y, `${width}x${height} AI service overlap`);
    for (let index = 0; index < 5; index += 1) {
      assert.equal(
        intersects(layout, lobbyCardBounds(width, height, index)),
        false,
        `${width}x${height} card ${index + 1} overlap`,
      );
    }
  }
});

test('keeps the landscape forge card above the five-card fan', () => {
  for (const [width, height] of [[740, 360], [844, 390], [896, 414]] as const) {
    const viewport = getViewport(width, height, 1);
    const core = getLobbyCoreLayout(viewport);
    for (let index = 0; index < 5; index += 1) {
      assert.equal(
        intersects(core, lobbyCardBounds(width, height, index)),
        false,
        `${width}x${height} forge/card ${index + 1} overlap`,
      );
    }
  }
});
