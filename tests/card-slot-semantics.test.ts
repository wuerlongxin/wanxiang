import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCardGameplayPresentation } from '../src/card-gameplay-presentation.ts';
import {
  compileCardSlotSemantics,
  normalizeGeneratedCardForSlot,
  validateGeneratedCardForSlot,
  type GeneratedCardSemanticFields,
} from '../src/card-slot-semantics.ts';
import { gameplayBindingsForSlot, planDeckComposition } from '../src/deck-composition.ts';
import { createCustomRuleModule, createRuleKit, createRuleKitForMode } from '../src/rules.ts';
import type { CardData, GameModeId } from '../src/types.ts';

const AI_CARD: GeneratedCardSemanticFields = {
  role: '流光机关师',
  ability: '转动星盘后，为同伴点亮一枚灵纹。',
  attack: 99,
  defense: 98,
  rarity: '传说',
};

const BUILTIN_CASES: Array<{
  modeId: GameModeId;
  selectSlot: (slots: ReturnType<typeof planDeckComposition>['slots']) => number;
  expectedAttack: number;
  expectedDefense: number;
  expectedRarity: CardData['rarity'];
}> = [
  {
    modeId: 'reflex',
    selectSlot: () => 0,
    expectedAttack: 6,
    expectedDefense: 1,
    expectedRarity: '普通',
  },
  {
    modeId: 'memory',
    selectSlot: () => 1,
    expectedAttack: 1,
    expectedDefense: 2,
    expectedRarity: '普通',
  },
  {
    modeId: 'strategy',
    selectSlot: (slots) => slots.findIndex((slot) => slot.attributes.quantityValue === 5),
    expectedAttack: 5,
    expectedDefense: 5,
    expectedRarity: '传说',
  },
  {
    modeId: 'expression',
    selectSlot: (slots) => slots.findIndex((slot) => slot.attributes.targetCategory === 'concept'),
    expectedAttack: 5,
    expectedDefense: 1,
    expectedRarity: '史诗',
  },
  {
    modeId: 'mischief',
    selectSlot: () => 0,
    expectedAttack: 9,
    expectedDefense: 1,
    expectedRarity: '传说',
  },
];

test('all five built-in gameplay plans normalize visible fields from their exact slots', () => {
  for (const testCase of BUILTIN_CASES) {
    const ruleKit = createRuleKitForMode(testCase.modeId);
    const plan = planDeckComposition(ruleKit);
    const slotIndex = testCase.selectSlot(plan.slots);
    assert.ok(slotIndex >= 0, `${testCase.modeId} fixture slot must exist`);
    const slot = plan.slots[slotIndex];
    const normalized = normalizeGeneratedCardForSlot(AI_CARD, plan, slot, ruleKit.modules);
    const presentation = buildCardGameplayPresentation(
      { gameplay: gameplayBindingsForSlot(plan, slot) },
      ruleKit.modules,
      'full',
    );

    assert.ok(normalized.role.startsWith(`${slot.role} · `), testCase.modeId);
    assert.ok(normalized.role.endsWith(AI_CARD.role), testCase.modeId);
    assert.ok(normalized.ability.endsWith(AI_CARD.ability), testCase.modeId);
    assert.match(normalized.ability, /【角色灵感·不参与规则结算】/u, testCase.modeId);
    for (const item of presentation.items) {
      assert.ok(normalized.ability.includes(item.description), `${testCase.modeId}: ${item.description}`);
    }
    assert.equal(normalized.attack, testCase.expectedAttack, testCase.modeId);
    assert.equal(normalized.defense, testCase.expectedDefense, testCase.modeId);
    assert.equal(normalized.rarity, testCase.expectedRarity, testCase.modeId);
    assert.equal(
      validateGeneratedCardForSlot(normalized, plan, slot, ruleKit.modules).valid,
      true,
      testCase.modeId,
    );
  }
});

test('keeps generated ability briefs safe for single-card redraw', () => {
  const ruleKit = createRuleKitForMode('memory');
  const plan = planDeckComposition(ruleKit);
  const slot = plan.slots[0];
  const normalized = normalizeGeneratedCardForSlot(
    {
      ...AI_CARD,
      ability: '能力\n'.repeat(100),
    },
    plan,
    slot,
    ruleKit.modules,
  );

  assert.ok(Array.from(normalized.ability).length <= 320);
  assert.doesNotMatch(normalized.ability, /[\u0000-\u001F\u007F]/u);
  assert.equal(validateGeneratedCardForSlot(normalized, plan, slot, ruleKit.modules).valid, true);
});

test('slot validation reports every provider-controlled semantic field after tampering', () => {
  const ruleKit = createRuleKitForMode('strategy');
  const plan = planDeckComposition(ruleKit);
  const slot = plan.slots.find((candidate) => candidate.attributes.quantityValue === 5)!;
  const invalid: GeneratedCardSemanticFields = {
    role: '无关角色',
    ability: '与数量规则无关。',
    attack: 99,
    defense: 99,
    rarity: '普通',
  };

  const validation = validateGeneratedCardForSlot(invalid, plan, slot, ruleKit.modules);
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.issues, ['role', 'ability', 'attack', 'defense', 'rarity']);
});

test('combined and authored custom modules receive deterministic multi-layer semantics', () => {
  const combinedKit = createRuleKit('三艺合炼', [
    'memory-pair',
    'quantity-trigger',
    'risk-draw',
  ]);
  const combinedPlan = planDeckComposition(combinedKit);
  const combinedSlot = combinedPlan.slots.find(
    (slot) => gameplayBindingsForSlot(combinedPlan, slot).length >= 3,
  );
  assert.ok(combinedSlot);

  const first = normalizeGeneratedCardForSlot(AI_CARD, combinedPlan, combinedSlot, combinedKit.modules);
  const second = normalizeGeneratedCardForSlot(first, combinedPlan, combinedSlot, combinedKit.modules);
  const projection = compileCardSlotSemantics(combinedPlan, combinedSlot, combinedKit.modules);
  assert.deepEqual(second, first, 'normalization must be idempotent');
  assert.equal(projection.bindings.length >= 3, true);
  assert.equal(first.rarity === '史诗' || first.rarity === '传说', true);
  assert.equal(validateGeneratedCardForSlot(first, combinedPlan, combinedSlot, combinedKit.modules).valid, true);
  for (const item of buildCardGameplayPresentation(
    { gameplay: projection.bindings },
    combinedKit.modules,
    'full',
  ).items) {
    assert.ok(first.ability.includes(item.description));
  }

  const customModule = createCustomRuleModule({
    id: 'player-authored',
    name: '玩家机关谱',
    deckParts: '角色牌：6\n行动牌：18',
    cardsInPlay: 20,
  });
  const customKit = createRuleKit('玩家原创玩法', []);
  customKit.modules = [customModule];
  const customPlan = planDeckComposition(customKit);
  const customSlot = customPlan.slots[0];
  const custom = normalizeGeneratedCardForSlot(AI_CARD, customPlan, customSlot, customKit.modules);
  assert.match(custom.ability, /自定义牌型/u);
  assert.equal(custom.attack, 1);
  assert.equal(custom.defense, 1);
  assert.equal(custom.rarity, '普通');
  assert.equal(validateGeneratedCardForSlot(custom, customPlan, customSlot, customKit.modules).valid, true);
});
