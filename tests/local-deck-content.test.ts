import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalDeckCard, createStarterCard, createStarterDeck } from '../src/data.ts';
import { validateDeckComposition } from '../src/deck-composition.ts';
import { generateDeck } from '../src/services/api.ts';
import type { GameModeId } from '../src/types.ts';

const MODES: GameModeId[] = ['reflex', 'memory', 'strategy', 'expression', 'mischief'];
const EXPECTED: Record<GameModeId, number> = {
  reflex: 31,
  memory: 48,
  strategy: 56,
  expression: 48,
  mischief: 56,
};

test('local deck cards keep the four hand-written archetypes first, then derive unique cards', () => {
  for (const modeId of MODES) {
    for (let index = 0; index < 4; index += 1) {
      assert.equal(createLocalDeckCard(modeId, index).name, createStarterCard(modeId, index).name);
    }
    const deck = createStarterDeck(modeId);
    const names = deck.cards.map((card) => card.name);
    assert.equal(new Set(names).size, names.length, `${modeId} names must be unique`);
    assert.ok(names.every((name) => !name.includes('其二') && !name.includes('其三')));
    // Deriving the same slot twice yields the same card content.
    assert.equal(createLocalDeckCard(modeId, 10).name, createLocalDeckCard(modeId, 10).name);
    assert.equal(createLocalDeckCard(modeId, 10).skill, createLocalDeckCard(modeId, 10).skill);
  }
});

test('generated decks are complete, unique and pass composition validation', async () => {
  for (const modeId of MODES) {
    const deck = await generateDeck('本地完整套牌', modeId);
    assert.equal(deck.cards.length, EXPECTED[modeId]);
    assert.equal(new Set(deck.cards.map((card) => card.name)).size, deck.cards.length);
    assert.equal(new Set(deck.cards.map((card) => card.id)).size, deck.cards.length);
    assert.ok(deck.cards.every((card) => card.gameplay && card.gameplay.length > 0));
    assert.ok(deck.cards.every((card) => card.skill.length > 0 && card.flavor.length > 0));
    assert.equal(validateDeckComposition(deck).valid, true);
    assert.equal(deck.composition?.status, 'complete');
  }
});

test('generated deck content is deterministic across runs', async () => {
  const first = await generateDeck('本地完整套牌', 'strategy');
  const second = await generateDeck('本地完整套牌', 'strategy');
  assert.deepEqual(
    first.cards.map((card) => card.name),
    second.cards.map((card) => card.name),
  );
  assert.deepEqual(
    first.cards.map((card) => card.skill),
    second.cards.map((card) => card.skill),
  );
});

test('artwork groups cards the way each mode is played', () => {
  const memory = createStarterDeck('memory');
  const byPair = new Map<string, string>();
  for (const card of memory.cards) {
    const binding = card.gameplay?.find((entry) => entry.kind === 'memory');
    assert.ok(binding && binding.kind === 'memory');
    const previous = byPair.get(binding.pairId);
    if (previous === undefined) byPair.set(binding.pairId, card.artUrl);
    else assert.equal(card.artUrl, previous, 'both sides of a pair share artwork');
  }
  assert.equal(byPair.size, 24);

  const strategy = createStarterDeck('strategy');
  const byCategory = new Map<string, string>();
  for (const card of strategy.cards) {
    const binding = card.gameplay?.find((entry) => entry.kind === 'quantity');
    assert.ok(binding && binding.kind === 'quantity');
    const previous = byCategory.get(binding.categoryId);
    if (previous === undefined) byCategory.set(binding.categoryId, card.artUrl);
    else assert.equal(card.artUrl, previous, 'cards of one quantity category share artwork');
  }
  assert.equal(byCategory.size, 4);

  const mischief = createStarterDeck('mischief');
  const byFamily = new Map<string, string>();
  for (const card of mischief.cards) {
    const binding = card.gameplay?.find((entry) => entry.kind === 'risk');
    assert.ok(binding && binding.kind === 'risk');
    const family = binding.cardKind === 'action' ? binding.actionKind ?? 'action' : binding.cardKind;
    const previous = byFamily.get(family);
    if (previous === undefined) byFamily.set(family, card.artUrl);
    else assert.equal(card.artUrl, previous, 'cards of one effect family share artwork');
  }
  assert.equal(byFamily.size, 10);
});
