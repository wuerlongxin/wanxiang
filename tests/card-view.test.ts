import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARTWORK_COVER_OVERSCAN,
  CARD_FACE_LAYOUT,
  computeArtworkCoverLayout,
} from '../src/card-art-layout.ts';
import { CARD_RATIO } from '../src/theme.ts';

test('fits portrait artwork without stretching and keeps crop within the card-art safe zone', () => {
  const cardWidth = 150;
  const artWidth = cardWidth * CARD_FACE_LAYOUT.artwork.width;
  const artHeight = cardWidth * CARD_RATIO * CARD_FACE_LAYOUT.artwork.height;
  const layout = computeArtworkCoverLayout(artWidth, artHeight, 768, 1152);

  assert.ok(layout.renderedWidth >= artWidth);
  assert.ok(layout.renderedHeight >= artHeight);
  assert.ok(Math.abs(layout.renderedWidth / layout.renderedHeight - 768 / 1152) < 1e-12);
  assert.ok(layout.cropRatioX < 0.01, 'horizontal overscan should remain subtle');
  assert.ok(layout.cropRatioY < 0.12, 'the expanded portrait window should retain about 90% of the source');
  assert.equal(ARTWORK_COVER_OVERSCAN, 1.002);
});

test('uses a full-art face with restrained information and numeric badges', () => {
  const { artwork, cost, infoPanel, stats, titlePlate } = CARD_FACE_LAYOUT;

  assert.ok(artwork.width >= 0.91, 'artwork should fill nearly the entire card width');
  assert.ok(artwork.height >= 0.88, 'artwork should remain the dominant vertical surface');
  assert.ok(artwork.y + artwork.height <= 0.97, 'artwork must remain inside the print-safe frame');
  assert.ok(infoPanel.height <= 0.12, 'the information ribbon should not dominate the illustration');
  assert.ok(infoPanel.y > 0.76, 'the information ribbon should stay near the lower edge');
  assert.ok(stats.radius <= 0.044, 'attack and defense seals should remain compact');
  assert.ok(cost.radius <= 0.043, 'the cost seal should remain compact');
  assert.ok(
    infoPanel.y + infoPanel.height < stats.y - stats.radius / CARD_RATIO,
    'the information ribbon and stat seals should retain optical clearance',
  );
  assert.ok(titlePlate.width >= 0.9, 'the name plate should give long names enough contrast and width');
});

test('preserves source aspect ratio for both portrait and landscape art', () => {
  const portrait = computeArtworkCoverLayout(220, 310, 768, 1152);
  const landscape = computeArtworkCoverLayout(220, 310, 1536, 1024);

  assert.ok(Math.abs(portrait.renderedWidth / portrait.renderedHeight - 2 / 3) < 1e-12);
  assert.ok(Math.abs(landscape.renderedWidth / landscape.renderedHeight - 3 / 2) < 1e-12);
  assert.equal(portrait.renderedWidth / 768, portrait.renderedHeight / 1152);
  assert.equal(landscape.renderedWidth / 1536, landscape.renderedHeight / 1024);
});

test('rejects invalid artwork dimensions without producing NaN layout values', () => {
  assert.deepEqual(computeArtworkCoverLayout(120, 180, 0, 0), {
    scale: 0,
    renderedWidth: 0,
    renderedHeight: 0,
    cropRatioX: 0,
    cropRatioY: 0,
  });
});
