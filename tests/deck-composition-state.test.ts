import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assessDeckPrintReadiness,
  describeDeckComposition,
  gameplayBindingsForSlot,
  planDeckComposition,
  resolveDeckComposition,
  validateDeckComposition,
} from '../src/deck-composition.ts';
import { createStarterCard, createStarterDeck } from '../src/data.ts';
import { createRuleKit, createRuleKitForMode } from '../src/rules.ts';
import type { DeckComposition, DeckData, GameModeId } from '../src/types.ts';

function withCardCount(deck: DeckData, count: number): DeckData {
  const plan = planDeckComposition(deck.ruleKit ?? deck.modeId);
  return {
    ...deck,
    cards: Array.from({ length: count }, (_, index) => ({
      ...createStarterCard(deck.modeId, index),
      gameplay: gameplayBindingsForSlot(plan, plan.slots[index % plan.slots.length]),
    })),
  };
}

test('recomputes standard composition from current rules and ignores stale persisted metadata', () => {
  const expected: Record<GameModeId, number> = {
    reflex: 31,
    memory: 48,
    strategy: 56,
    expression: 48,
    mischief: 56,
  };
  const staleComposition: DeckComposition = {
    schemaVersion: 1,
    recommendedTotal: 12,
    parts: [],
    constraints: [],
    rationale: 'stale',
    status: 'complete',
  };

  for (const modeId of Object.keys(expected) as GameModeId[]) {
    const deck = { ...createStarterDeck(modeId), composition: staleComposition };
    const composition = resolveDeckComposition(deck);
    assert.equal(composition.recommendedTotal, expected[modeId]);
    assert.equal(composition.status, 'complete');
  }
});

test('uses distinct sample, incomplete, excess and complete presentation states', () => {
  const starter = createStarterDeck('reflex');
  assert.equal(describeDeckComposition(starter).summary, '完整盒装 31 张');

  const sample = withCardCount(starter, 4);
  const sampleState = describeDeckComposition(sample);
  assert.equal(sampleState.composition.status, 'sample');
  assert.equal(sampleState.summary, '样卡 4 / 盒装 31 张');

  const incomplete = withCardCount(starter, 10);
  const incompleteState = describeDeckComposition(incomplete);
  assert.equal(incompleteState.composition.status, 'incomplete');
  assert.equal(incompleteState.summary, '待适配 10 / 盒装 31 张');
  assert.equal(incompleteState.remaining, 21);

  const complete = withCardCount(starter, 31);
  const completeState = describeDeckComposition(complete);
  assert.equal(completeState.composition.status, 'complete');
  assert.equal(completeState.summary, '完整盒装 31 张');

  const memoryRules = createRuleKitForMode('memory');
  const pairCount = memoryRules.modules[0].parameters.find((parameter) => parameter.id === 'pairCount');
  assert.ok(pairCount);
  pairCount.value = 6;
  const excess = { ...withCardCount(createStarterDeck('memory'), 48), ruleKit: memoryRules };
  const excessState = describeDeckComposition(excess);
  assert.equal(excessState.composition.status, 'incomplete');
  assert.equal(excessState.summary, '待适配 48 / 盒装 12 张');
  assert.equal(excessState.excess, 36);
});

test('blocks print export until actual card count exactly matches current rules', () => {
  const sample = assessDeckPrintReadiness(withCardCount(createStarterDeck('strategy'), 4));
  assert.equal(sample.ready, false);
  assert.equal(sample.remaining, 52);
  assert.match(sample.message, /还差 52 张/u);

  const incomplete = assessDeckPrintReadiness(withCardCount(createStarterDeck('strategy'), 20));
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.remaining, 36);
  assert.match(incomplete.message, /还差 36 张/u);

  const complete = assessDeckPrintReadiness(withCardCount(createStarterDeck('strategy'), 56));
  assert.equal(complete.ready, true);
  assert.equal(complete.remaining, 0);
  assert.equal(complete.excess, 0);

  const memoryRules = createRuleKitForMode('memory');
  const pairCount = memoryRules.modules[0].parameters.find((parameter) => parameter.id === 'pairCount');
  assert.ok(pairCount);
  pairCount.value = 6;
  const excessDeck = {
    ...withCardCount(createStarterDeck('memory'), 48),
    ruleKit: memoryRules,
  };
  const excess = assessDeckPrintReadiness(excessDeck);
  assert.equal(excess.ready, false);
  assert.equal(excess.excess, 36);
  assert.match(excess.message, /当前多 36 张/u);
});

test('rejects a count-exact deck when gameplay identities are missing or duplicated', () => {
  const complete = withCardCount(createStarterDeck('memory'), 48);
  assert.equal(validateDeckComposition(complete).valid, true);

  const malformed = {
    ...complete,
    cards: complete.cards.map((card, index) => ({
      ...card,
      gameplay: index === 0 ? [] : complete.cards[1].gameplay,
    })),
  };
  const validation = validateDeckComposition(malformed);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'missing-gameplay-bindings'));
  assert.equal(describeDeckComposition(malformed).summary, '牌型未完成 / 盒装 48 张');
  assert.equal(assessDeckPrintReadiness(malformed).ready, false);
  assert.match(assessDeckPrintReadiness(malformed).message, /牌型未完成/u);
});

test('blocks printing when a combined card needs more than four visible gameplay layers', () => {
  const ruleKit = createRuleKit(
    '十六重忆阵',
    Array.from({ length: 16 }, () => 'memory-pair'),
  );
  const deck = withCardCount({ ...createStarterDeck('memory'), ruleKit }, 64);
  const validation = validateDeckComposition(deck);
  const readiness = assessDeckPrintReadiness(deck);

  assert.ok(deck.cards.every((card) => (card.gameplay?.length ?? 0) > 4));
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'surface-density-overflow'));
  assert.equal(readiness.ready, false);
  assert.match(readiness.message, /超过 4 层/u);
  assert.match(readiness.message, /拆分为子套牌/u);
});

test('blocks printing when more than one six-symbol rapid layer lands on a card', () => {
  const ruleKit = createRuleKit('三重瞬纹阵', [
    'rapid-match',
    'rapid-match',
    'rapid-match',
  ]);
  const deck = withCardCount({ ...createStarterDeck('reflex'), ruleKit }, 64);
  const validation = validateDeckComposition(deck);
  const readiness = assessDeckPrintReadiness(deck);

  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === 'rapid-symbol-overflow'));
  assert.equal(readiness.ready, false);
  assert.match(readiness.message, /快速纹样过密/u);
  assert.match(readiness.message, /拆分为子套牌/u);
});

test('studio metadata exposes both the complete deck size and standard session size', () => {
  const studioSource = readFileSync(
    new URL('../src/scenes/studio.ts', import.meta.url),
    'utf8',
  );

  assert.match(studioSource, /const state = describeDeckComposition\(this\.deck\)/u);
  assert.match(studioSource, /state\.composition\.playSetup\?\.cardsInPlay\.default/u);
  assert.match(studioSource, /完整配方/u);
  assert.match(studioSource, /fitTextHeight\(this\.metaText, this\.detailMeta\(\), 86\)/u);
});

test('studio keeps sample-state copy for decks that are not yet complete', () => {
  const studioSource = readFileSync(
    new URL('../src/scenes/studio.ts', import.meta.url),
    'utf8',
  );

  assert.match(studioSource, /样卡.*非完整牌组/u);
  assert.match(studioSource, /完整配方/u);
  assert.match(studioSource, /生成完整牌组/u);
  assert.match(studioSource, /生成后才可游玩与印刷/u);
  assert.match(studioSource, /标准局/u);
});
