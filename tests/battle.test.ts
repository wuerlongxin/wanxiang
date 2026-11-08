import assert from 'node:assert/strict';
import test from 'node:test';

import { createStarterDeck } from '../src/data.ts';
import {
  BATTLE_MAX_HAND,
  battleEnergyForTurn,
  createBattle,
  endOpponentTurn,
  endPlayerTurn,
  planOpponentPlays,
  playCard,
  startOpponentTurn,
  type BattleState,
} from '../src/services/battle.ts';
import type { CardData, GameModeId } from '../src/types.ts';

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function battle(modeId: GameModeId = 'strategy', difficulty: 'apprentice' | 'craftsman' | 'master' = 'craftsman'): BattleState {
  return createBattle(createStarterDeck(modeId), difficulty, mulberry32(42));
}

test('battle setup deals starting hands and first-turn energy', () => {
  const state = battle();
  assert.equal(state.turn, 1);
  assert.equal(state.phase, 'player');
  assert.equal(state.player.hp, 20);
  assert.equal(state.opponent.hp, 20);
  assert.equal(state.player.hand.length, 3);
  assert.equal(state.opponent.hand.length, 3);
  assert.equal(state.player.deck.length, 56 - 3);
  assert.equal(state.player.energy, 2);
  assert.equal(state.winner, null);
  assert.equal(battleEnergyForTurn(1), 2);
  assert.equal(battleEnergyForTurn(4), 5);
  assert.equal(battleEnergyForTurn(9), 5);
});

test('playing a card pays cost, deals attack and grants defense as armor', () => {
  const state = battle();
  const card = state.player.hand.find((candidate) => candidate.cost <= state.player.energy);
  assert.ok(card);
  const foeHp = state.opponent.hp;
  const result = playCard(state, 'player', card.id);
  assert.equal(result.ok, true);
  assert.equal(result.damageDealt, card.attack);
  assert.equal(result.armorGained, card.defense);
  assert.equal(state.player.energy, 2 - card.cost);
  assert.equal(state.opponent.hp, foeHp - card.attack);
  assert.equal(state.player.armor, card.defense);
  assert.equal(state.player.hand.length, 2);
  assert.equal(state.player.discard.length, 1);
});

test('playing a card rejects unaffordable cards and wrong turns', () => {
  const state = battle();
  const expensive = state.player.hand.find((candidate) => candidate.cost > state.player.energy);
  if (expensive) {
    assert.equal(playCard(state, 'player', expensive.id).ok, false);
  }
  assert.equal(playCard(state, 'player', 'no-such-card').ok, false);
  assert.equal(playCard(state, 'opponent', state.opponent.hand[0].id).ok, false);
});

test('armor absorbs damage first and clears at the start of the owner turn', () => {
  const state = battle();
  const card = state.player.hand.find((candidate) => candidate.cost <= state.player.energy);
  assert.ok(card);
  playCard(state, 'player', card.id);
  const armor = state.player.armor;
  assert.ok(armor > 0);
  // Opponent turn: opponent plays a card against the armored player.
  assert.equal(endPlayerTurn(state), true);
  startOpponentTurn(state);
  const foeCard = state.opponent.hand.find((candidate) => candidate.cost <= state.opponent.energy);
  assert.ok(foeCard);
  const hpBefore = state.player.hp;
  playCard(state, 'opponent', foeCard.id);
  const absorbed = Math.min(armor, foeCard.attack);
  assert.equal(state.player.hp, hpBefore - (foeCard.attack - absorbed));
  assert.equal(state.player.armor, armor - absorbed);
  // Player turn starts again: remaining armor clears and energy refills.
  assert.equal(endOpponentTurn(state), true);
  assert.equal(state.player.armor, 0);
  assert.equal(state.player.energy, battleEnergyForTurn(2));
  assert.equal(state.player.hand.length, 3);
  assert.equal(state.turn, 2);
});

test('reducing a side to zero health ends the battle with a winner', () => {
  const state = battle();
  state.opponent.hp = 3;
  state.opponent.armor = 0;
  const card = state.player.hand.find((candidate) => candidate.cost <= state.player.energy && candidate.attack >= 3);
  assert.ok(card);
  const result = playCard(state, 'player', card.id);
  assert.equal(result.ok, true);
  assert.equal(state.winner, 'player');
  assert.equal(state.phase, 'over');
  assert.equal(playCard(state, 'player', state.player.hand[0]?.id ?? '').ok, false);
});

test('apprentice plays at most two cards', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const state = createBattle(createStarterDeck('strategy'), 'apprentice', mulberry32(seed));
    assert.equal(endPlayerTurn(state), true);
    startOpponentTurn(state);
    const plays = planOpponentPlays(state, mulberry32(seed + 100));
    assert.ok(plays.length <= 2, `apprentice played ${plays.length} cards`);
    let energy = state.opponent.energy;
    for (const cardId of plays) {
      const card = state.opponent.hand.find((candidate) => candidate.id === cardId);
      assert.ok(card && card.cost <= energy);
      energy -= card.cost;
    }
  }
});

test('craftsman plays affordable cards and prefers armor when low on health', () => {
  const state = battle('strategy', 'craftsman');
  state.opponent.hp = 6;
  assert.equal(endPlayerTurn(state), true);
  startOpponentTurn(state);
  const plays = planOpponentPlays(state);
  assert.ok(plays.length > 0);
  let energy = state.opponent.energy;
  for (const cardId of plays) {
    const card = state.opponent.hand.find((candidate) => candidate.id === cardId);
    assert.ok(card && card.cost <= energy);
    energy -= card.cost;
  }
});

test('master takes a lethal line when one exists', () => {
  const state = battle('strategy', 'master');
  state.player.hp = 5;
  state.player.armor = 0;
  assert.equal(endPlayerTurn(state), true);
  startOpponentTurn(state);
  state.opponent.energy = 5;
  // Give the opponent a hand with a guaranteed lethal combination.
  const lethal: CardData[] = [
    { ...state.opponent.hand[0], id: 'test-lethal-1', cost: 2, attack: 3 },
    { ...state.opponent.hand[0], id: 'test-lethal-2', cost: 3, attack: 4 },
  ];
  state.opponent.hand = lethal;
  const plays = planOpponentPlays(state);
  assert.deepEqual(new Set(plays), new Set(['test-lethal-1', 'test-lethal-2']));
});

test('empty deck reshuffles the discard pile on draw', () => {
  const state = battle('reflex');
  // Exhaust the player's deck by drawing until it is empty.
  state.player.deck = [];
  state.player.discard = state.player.hand.splice(0);
  state.player.hand = [];
  assert.equal(endPlayerTurn(state), true);
  startOpponentTurn(state);
  assert.equal(endOpponentTurn(state), true);
  assert.ok(state.player.hand.length > 0, 'player should draw from the reshuffled discard');
});

test('hand limit discards the drawn card instead of growing the hand', () => {
  const state = battle('reflex');
  while (state.player.hand.length < BATTLE_MAX_HAND) {
    state.player.hand.push(state.player.deck.shift()!);
  }
  assert.equal(endPlayerTurn(state), true);
  startOpponentTurn(state);
  assert.equal(endOpponentTurn(state), true);
  assert.equal(state.player.hand.length, BATTLE_MAX_HAND);
});
