import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CARD_ABILITY_LONG_PRESS_MS,
  resolveCardAbilityPopoverLayout,
} from '../src/card-ability-popover.ts';

test('places a desktop ability popover below the focused card', () => {
  const layout = resolveCardAbilityPopoverLayout({
    cardWidth: 312,
    cardHeight: 436,
    globalCenterX: 640,
    globalCenterY: 350,
    viewportWidth: 1280,
    viewportHeight: 900,
  });

  assert.equal(layout.placement, 'below');
  assert.ok(layout.y > 436);
  assert.ok(layout.width <= 360);
});

test('moves the popover above a card near the bottom edge and keeps it on a phone', () => {
  const layout = resolveCardAbilityPopoverLayout({
    cardWidth: 150,
    cardHeight: 210,
    globalCenterX: 288,
    globalCenterY: 430,
    viewportWidth: 320,
    viewportHeight: 568,
  });

  assert.equal(layout.placement, 'above');
  assert.ok(layout.y < 0);
  assert.ok(layout.width <= 296);
  assert.ok(layout.x + layout.width <= 320 - 150 / 2);
});

test('uses a deliberate long press instead of delaying ordinary taps', () => {
  assert.ok(CARD_ABILITY_LONG_PRESS_MS >= 480);
  assert.ok(CARD_ABILITY_LONG_PRESS_MS <= 650);
});
