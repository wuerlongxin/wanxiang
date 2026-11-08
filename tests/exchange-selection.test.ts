import assert from 'node:assert/strict';
import test from 'node:test';

import { canExchangeDeck, createFanStudyDeckContentPolicy } from '../src/services/content-policy.ts';
import { findNextExchangeableDeckIndex } from '../src/scenes/exchange-selection.ts';
import type { DeckData } from '../src/types.ts';

function deck(id: string, fanStudy = false): DeckData {
  return {
    id,
    theme: id,
    name: id,
    modeId: 'strategy',
    story: '',
    rules: '',
    cards: [],
    author: '测试作者',
    ...(fanStudy
      ? {
          contentPolicy: createFanStudyDeckContentPolicy({
            materialsRightsConfirmed: true,
            personalNonCommercialConfirmed: true,
            unofficialAndUnaffiliatedConfirmed: true,
            guardianJointlyConfirmed: true,
          }, 1_800_000_000_000),
        }
      : {}),
  };
}

test('moves from a local-only study deck to the next original deck', () => {
  const decks = [deck('研习套牌', true), deck('原创甲'), deck('原创乙')];
  assert.equal(findNextExchangeableDeckIndex(decks, 0, canExchangeDeck), 1);
});

test('skips local-only decks while rotating and wraps around original decks', () => {
  const decks = [deck('原创甲'), deck('研习套牌', true), deck('原创乙')];
  assert.equal(findNextExchangeableDeckIndex(decks, 0, canExchangeDeck), 2);
  assert.equal(findNextExchangeableDeckIndex(decks, 2, canExchangeDeck), 0);
});

test('returns null when no different original deck can be selected', () => {
  assert.equal(findNextExchangeableDeckIndex([deck('原创甲')], 0, canExchangeDeck), null);
  assert.equal(
    findNextExchangeableDeckIndex([deck('原创甲'), deck('研习套牌', true)], 0, canExchangeDeck),
    null,
  );
  assert.equal(
    findNextExchangeableDeckIndex([deck('研习甲', true), deck('研习乙', true)], 0, canExchangeDeck),
    null,
  );
});
