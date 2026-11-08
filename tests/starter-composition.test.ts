import assert from 'node:assert/strict';
import test from 'node:test';

import { createStarterDeck } from '../src/data.ts';
import { validateDeckComposition } from '../src/deck-composition.ts';
import type { GameModeId } from '../src/types.ts';

test('starter decks ship as complete playable decks with unique local cards', () => {
  const expected: Record<GameModeId, number> = {
    reflex: 31,
    memory: 48,
    strategy: 56,
    expression: 48,
    mischief: 56,
  };

  for (const modeId of Object.keys(expected) as GameModeId[]) {
    const deck = createStarterDeck(modeId);
    assert.equal(deck.cards.length, expected[modeId]);
    assert.equal(deck.composition?.recommendedTotal, expected[modeId]);
    assert.equal(deck.composition?.status, 'complete');
    assert.equal(
      new Set(deck.cards.map((card) => card.name)).size,
      deck.cards.length,
      `${modeId} cards must all have distinct names`,
    );
    assert.equal(
      new Set(deck.cards.map((card) => card.id)).size,
      deck.cards.length,
      `${modeId} cards must all have distinct ids`,
    );
    assert.ok(deck.cards.every((card) => card.gameplay && card.gameplay.length > 0));
    assert.equal(validateDeckComposition(deck).valid, true);
  }
});
