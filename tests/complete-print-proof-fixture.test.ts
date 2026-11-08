import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gameplayBindingsForSlot,
  planDeckComposition,
  assessDeckPrintReadiness,
} from '../src/deck-composition.ts';
import { generateRuleBook } from '../src/rules.ts';
import {
  COMPLETE_PRINT_PROOF_CARD_COUNT,
  createCompletePrintProofDeck,
} from '../scripts/complete-print-proof-fixture.ts';

test('complete print-proof fixture follows the current 56-card strategy composition', () => {
  const deck = createCompletePrintProofDeck('/virtual/artwork');
  const plan = planDeckComposition(deck.ruleKit ?? deck.modeId);

  assert.equal(deck.cards.length, COMPLETE_PRINT_PROOF_CARD_COUNT);
  assert.equal(assessDeckPrintReadiness(deck).ready, true);
  assert.equal(new Set(deck.cards.map((card) => card.id)).size, deck.cards.length);
  assert.equal(new Set(deck.cards.map((card) => card.name)).size, deck.cards.length);
  assert.deepEqual(
    deck.cards.map((card) => card.gameplay),
    plan.slots.map((slot) => gameplayBindingsForSlot(plan, slot)),
  );
  assert.deepEqual(
    Object.fromEntries([1, 2, 3, 4].map((category) => [
      category,
      deck.cards.filter((card) => card.gameplay?.some(
        (binding) => binding.kind === 'quantity' && binding.categoryId === `category-${category}`,
      )).length,
    ])),
    { 1: 14, 2: 14, 3: 14, 4: 14 },
  );
});

test('complete print-proof fixture includes box setup, session setup and print disclaimer', () => {
  const deck = createCompletePrintProofDeck('/virtual/artwork');
  const ruleBook = generateRuleBook(deck);

  assert.ok(ruleBook.setup.some((line) => /完整牌组共56张/u.test(line)));
  assert.ok(ruleBook.quickReference.some((line) => /盒装 56 张/u.test(line)));
  assert.ok(ruleBook.notes.some((line) => /RGB 印刷校样/u.test(line)));
  assert.equal(deck.creatorPlaque?.serialNumber, 'AD-QA-STRATEGY-056');
  assert.equal(deck.contentPolicy?.mode, 'original');
});
