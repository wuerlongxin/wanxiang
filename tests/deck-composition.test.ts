import assert from 'node:assert/strict';
import test from 'node:test';

import { gameplayBindingsForSlot, planDeckComposition } from '../src/deck-composition.ts';
import { createCustomRuleModule, createRuleKit, createRuleKitForMode } from '../src/rules.ts';
import type { DeckCompositionPlan } from '../src/deck-composition.ts';
import type { CardGameplayBinding } from '../src/types.ts';

function assertCompletePlan(plan: DeckCompositionPlan): void {
  assert.equal(plan.slots.length, plan.totalCards);
  assert.equal(plan.parts.reduce((sum, part) => sum + part.count, 0), plan.totalCards);
  assert.equal(new Set(plan.slots.map((slot) => slot.id)).size, plan.totalCards);
  assert.equal(new Set(plan.slots.map((slot) => slot.uniqueKey)).size, plan.totalCards);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
}

function projectedBindings(plan: DeckCompositionPlan): Array<{ slotId: string; binding: CardGameplayBinding }> {
  return plan.slots.flatMap((slot) => gameplayBindingsForSlot(plan, slot).map((binding) => ({
    slotId: slot.id,
    binding,
  })));
}

function assertRapidProjection(
  bindings: Array<Extract<CardGameplayBinding, { kind: 'rapid' }>>,
): void {
  assert.equal(bindings.length, 31);
  const symbolSets = bindings.map((binding) => new Set(binding.symbolIds));
  assert.ok(symbolSets.every((symbols) => symbols.size === 6));
  assert.equal(new Set(symbolSets.flatMap((symbols) => [...symbols])).size, 31);
  for (let left = 0; left < symbolSets.length; left += 1) {
    for (let right = left + 1; right < symbolSets.length; right += 1) {
      assert.equal([...symbolSets[left]].filter((symbol) => symbolSets[right].has(symbol)).length, 1);
    }
  }
  const frequencies = new Map<string, number>();
  for (const symbols of symbolSets) {
    for (const symbol of symbols) frequencies.set(symbol, (frequencies.get(symbol) ?? 0) + 1);
  }
  assert.ok([...frequencies.values()].every((frequency) => frequency === 6));
}

test('reflex plan is a 31-card projective plane with exactly one shared symbol per pair', () => {
  const plan = planDeckComposition('reflex');
  assertCompletePlan(plan);
  assert.equal(plan.totalCards, 31);

  const symbolSets = plan.slots.map((slot) => new Set(slot.attributes.symbolIds as string[]));
  assert.ok(symbolSets.every((symbols) => symbols.size === 6));
  assert.equal(new Set(symbolSets.flatMap((symbols) => [...symbols])).size, 31);

  for (let left = 0; left < symbolSets.length; left += 1) {
    for (let right = left + 1; right < symbolSets.length; right += 1) {
      const intersection = [...symbolSets[left]].filter((symbol) => symbolSets[right].has(symbol));
      assert.equal(intersection.length, 1, `cards ${left + 1} and ${right + 1}`);
    }
  }

  const frequencies = new Map<string, number>();
  for (const symbols of symbolSets) {
    for (const symbol of symbols) frequencies.set(symbol, (frequencies.get(symbol) ?? 0) + 1);
  }
  assert.ok([...frequencies.values()].every((frequency) => frequency === 6));
});

test('memory defaults to 24 complementary pairs and respects a rule-kit pair count', () => {
  const defaultPlan = planDeckComposition('memory');
  assertCompletePlan(defaultPlan);
  assert.equal(defaultPlan.totalCards, 48);
  assert.deepEqual(defaultPlan.parts.map((part) => part.count), [24, 24]);

  const ruleKit = createRuleKitForMode('memory');
  const pairParameter = ruleKit.modules[0].parameters.find((parameter) => parameter.id === 'pairCount');
  assert.ok(pairParameter);
  pairParameter.value = 12;
  const customPlan = planDeckComposition(ruleKit);
  assertCompletePlan(customPlan);
  assert.equal(customPlan.totalCards, 24);

  const pairs = new Map<string, typeof customPlan.slots>();
  for (const slot of customPlan.slots) {
    const pairId = String(slot.attributes.pairId);
    pairs.set(pairId, [...(pairs.get(pairId) ?? []), slot]);
  }
  assert.equal(pairs.size, 12);
  for (const pair of pairs.values()) {
    assert.equal(pair.length, 2);
    assert.deepEqual(new Set(pair.map((slot) => slot.attributes.pairSide)), new Set(['A', 'B']));
    assert.equal(pair[0].attributes.complementSlotId, pair[1].id);
    assert.equal(pair[1].attributes.complementSlotId, pair[0].id);
  }
});

test('memory faction variant assigns one balanced faction to both halves of every pair', () => {
  const ruleKit = createRuleKitForMode('memory');
  const factionVariant = ruleKit.modules[0].content.variants.find(
    (variant) => variant.id === 'memory-faction',
  );
  assert.ok(factionVariant);
  factionVariant.enabled = true;

  const plan = planDeckComposition(ruleKit);
  const memoryBindings = projectedBindings(plan)
    .map(({ binding }) => binding)
    .filter((binding): binding is Extract<CardGameplayBinding, { kind: 'memory' }> => (
      binding.kind === 'memory'
    ));
  const pairs = new Map<string, typeof memoryBindings>();
  for (const binding of memoryBindings) {
    pairs.set(binding.pairId, [...(pairs.get(binding.pairId) ?? []), binding]);
  }

  assert.equal(pairs.size, 24);
  assert.ok([...pairs.values()].every((pair) => (
    pair.length === 2
    && pair[0].factionId !== undefined
    && pair[0].factionId === pair[1].factionId
  )));
  assert.deepEqual(
    Object.fromEntries(['faction-朱', 'faction-青'].map((factionId) => [
      factionId,
      memoryBindings.filter((binding) => binding.factionId === factionId).length,
    ])),
    { 'faction-朱': 24, 'faction-青': 24 },
  );
});

test('strategy has four balanced categories and the required value distribution', () => {
  const plan = planDeckComposition('strategy');
  assertCompletePlan(plan);
  assert.equal(plan.totalCards, 56);
  assert.deepEqual(plan.parts.map((part) => part.count), [14, 14, 14, 14]);

  for (let category = 1; category <= 4; category += 1) {
    const distribution = new Map<number, number>();
    for (const slot of plan.slots.filter((candidate) => candidate.attributes.category === category)) {
      const value = slot.attributes.quantityValue as number;
      distribution.set(value, (distribution.get(value) ?? 0) + 1);
    }
    assert.deepEqual(Object.fromEntries(distribution), { 1: 5, 2: 3, 3: 3, 4: 2, 5: 1 });
  }
});

test('strategy rebuilds every card value when the custom trigger target changes', () => {
  const ruleKit = createRuleKitForMode('strategy');
  const target = ruleKit.modules[0].parameters.find((parameter) => parameter.id === 'targetTotal');
  const relation = ruleKit.modules[0].parameters.find((parameter) => parameter.id === 'triggerRelation');
  assert.ok(target);
  assert.ok(relation);
  target.value = 8;
  relation.value = 'two-types';

  const plan = planDeckComposition(ruleKit);
  assertCompletePlan(plan);
  assert.equal(plan.totalCards, 56);
  assert.ok(plan.slots.every((slot) => gameplayBindingsForSlot(plan, slot)[0].moduleId === ruleKit.modules[0].id));
  assert.equal(
    plan.constraints.find((constraint) => constraint.id === 'target-total')?.value,
    8,
  );
  for (let category = 1; category <= 4; category += 1) {
    const categorySlots = plan.slots.filter((slot) => slot.attributes.category === category);
    const values = categorySlots.map((slot) => slot.attributes.quantityValue as number);
    assert.equal(categorySlots.length, 14);
    assert.deepEqual(new Set(values), new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    assert.ok(categorySlots.every((slot) => slot.attributes.targetTotal === 8));
    assert.ok(categorySlots.every((slot) => slot.attributes.triggerRelation === 'two-types'));
    assert.ok(categorySlots.every((slot) => {
      const binding = gameplayBindingsForSlot(plan, slot)[0];
      return binding.kind === 'quantity' && binding.triggerRelation === 'two-types';
    }));
  }
});

test('expression creates 48 semantically unique target slots in five categories', () => {
  const plan = planDeckComposition('expression');
  assertCompletePlan(plan);
  assert.equal(plan.totalCards, 48);
  assert.deepEqual(plan.parts.map((part) => part.count), [12, 12, 8, 8, 8]);
  assert.equal(new Set(plan.slots.map((slot) => slot.uniqueKey)).size, 48);
});

test('mischief uses 5 hazards, 6 rescues and the exact eight-family function distribution', () => {
  const plan = planDeckComposition('mischief');
  assertCompletePlan(plan);
  assert.equal(plan.totalCards, 56);
  assert.equal(plan.parts.find((part) => part.id === 'hazard')?.count, 5);
  assert.equal(plan.parts.find((part) => part.id === 'rescue')?.count, 6);
  assert.deepEqual(
    plan.parts.filter((part) => part.id.startsWith('function-')).map((part) => part.count),
    [6, 5, 6, 6, 5, 6, 5, 6],
  );
  assert.equal(
    plan.parts.filter((part) => part.id.startsWith('function-')).reduce((sum, part) => sum + part.count, 0),
    45,
  );
});

test('composition separates the printable box from the cards used in one session', () => {
  const reflex = planDeckComposition('reflex');
  assert.deepEqual(reflex.playSetup.cardsInPlay, { min: 31, max: 31, default: 31 });

  const memory = planDeckComposition('memory');
  assert.equal(memory.totalCards, 48);
  assert.deepEqual(memory.playSetup.cardsInPlay, { min: 24, max: 48, default: 36 });

  const expression = planDeckComposition(createRuleKitForMode('expression'));
  assert.equal(expression.totalCards, 48);
  assert.deepEqual(expression.playSetup.cardsInPlay, { min: 24, max: 48, default: 36 });
  assert.ok(expression.playSetup.auxiliaryComponents.some((component) => component.includes('图标板')));

  const compactExpressionKit = createRuleKitForMode('expression');
  const compactTarget = compactExpressionKit.modules[0].parameters.find(
    (parameter) => parameter.id === 'targetCount',
  );
  assert.ok(compactTarget);
  compactTarget.value = 24;
  const compactExpression = planDeckComposition(compactExpressionKit);
  assert.match(compactExpression.playSetup.formula, /3–8 人均使用全部 24 张/u);
  assert.doesNotMatch(compactExpression.playSetup.formula, /取 48 张/u);

  const mischief = planDeckComposition(createRuleKitForMode('mischief'));
  assert.equal(mischief.totalCards, 56);
  assert.deepEqual(mischief.playSetup.cardsInPlay, { min: 48, max: 56, default: 52 });
  assert.match(mischief.playSetup.formula, /N−1 张危机、N 张护航/u);
});

test('risk-draw box inventory expands with the selected player range', () => {
  const ruleKit = createRuleKitForMode('mischief');
  ruleKit.playerRange = { min: 3, max: 8 };
  const plan = planDeckComposition(ruleKit);

  assertCompletePlan(plan);
  assert.equal(plan.totalCards, 60);
  assert.equal(plan.parts.find((part) => part.id === 'hazard')?.count, 7);
  assert.equal(plan.parts.find((part) => part.id === 'rescue')?.count, 8);
  assert.deepEqual(plan.playSetup.cardsInPlay, { min: 50, max: 60, default: 52 });
});

test('combined and custom rule kits are deterministic, complete and remain within 12-64 cards', () => {
  const combined = createRuleKit('闪忆试验', ['rapid-match', 'memory-pair'], {
    playerRange: { min: 2, max: 8 },
    durationMinutes: { min: 20, max: 60 },
  });
  const customModule = createCustomRuleModule({ id: 'maker-module', name: '我的机关积木' });
  combined.modules.push(customModule);

  const first = planDeckComposition(combined);
  const second = planDeckComposition(combined);
  assertCompletePlan(first);
  assert.equal(first.totalCards, 48);
  assert.deepEqual(first, second);

  const bindings = projectedBindings(first);
  const rapid = bindings
    .filter(({ binding }) => binding.moduleId === combined.modules[0].id && binding.kind === 'rapid')
    .map(({ binding }) => binding as Extract<CardGameplayBinding, { kind: 'rapid' }>);
  assertRapidProjection(rapid);
  assert.equal(bindings.filter(({ binding }) => binding.moduleId === combined.modules[1].id).length, 48);
  assert.equal(bindings.filter(({ binding }) => binding.moduleId === customModule.id).length, 24);
  const loads = first.slots.map((slot) => gameplayBindingsForSlot(first, slot).length);
  assert.ok(Math.max(...loads) - Math.min(...loads) <= 1);
  assert.ok(first.slots.every((slot) => gameplayBindingsForSlot(first, slot).some(
    (binding) => binding.moduleId === combined.modules[Number(slot.attributes.primaryModule) - 1].id,
  )));

  const customOnly = createRuleKit('自定义', []);
  customOnly.modules = [customModule];
  const customPlan = planDeckComposition(customOnly);
  assertCompletePlan(customPlan);
  assert.equal(customPlan.totalCards, 24);
  assert.deepEqual(customPlan.parts.map((part) => [part.label, part.count]), [
    ['核心牌', 8],
    ['行动牌', 12],
    ['事件牌', 4],
  ]);
  assert.equal(customPlan.playSetup.cardsInPlay.default, 24);
  assert.ok(customPlan.slots.every((slot) => gameplayBindingsForSlot(customPlan, slot)[0].moduleId === customModule.id));
});

test('all five gameplay modules keep 239 native bindings on 60 balanced physical cards', () => {
  const ruleKit = createRuleKit('五艺合炼', [
    'rapid-match',
    'memory-pair',
    'quantity-trigger',
    'icon-coop',
    'risk-draw',
  ]);
  const plan = planDeckComposition(ruleKit);
  const bindings = projectedBindings(plan);
  const moduleByMechanic = new Map(ruleKit.modules.map((module) => [module.templateId, module.id]));

  assertCompletePlan(plan);
  assert.equal(plan.totalCards, 60);
  assert.equal(bindings.length, 239);
  assert.deepEqual(plan.playSetup.cardsInPlay, { min: 24, max: 56, default: 56 });
  assert.match(plan.playSetup.summary, /4人组合局按阶段投入 24–56 张（盒装 60 张）/u);
  assert.match(plan.playSetup.formula, /每个阶段只取带对应玩法积木标记的牌/u);
  assert.doesNotMatch(plan.playSetup.formula, /使用全部 60 张实体牌/u);
  assert.deepEqual(
    Object.fromEntries(ruleKit.modules.map((module) => [
      module.id,
      bindings.filter(({ binding }) => binding.moduleId === module.id).length,
    ])),
    Object.fromEntries(ruleKit.modules.map((module) => [
      module.id,
      module.templateId === 'rapid-match'
        ? 31
        : module.templateId === 'memory-pair'
          ? 48
          : module.templateId === 'quantity-trigger'
            ? 56
            : 48 + (module.templateId === 'risk-draw' ? 8 : 0),
    ])),
  );
  const loads = plan.slots.map((slot) => gameplayBindingsForSlot(plan, slot).length);
  assert.deepEqual(new Set(loads), new Set([3, 4]));
  assert.equal(loads.filter((load) => load === 3).length, 1);
  assert.equal(loads.filter((load) => load === 4).length, 59);
  assert.ok(!plan.constraints.some((item) => item.id === 'surface-density-overflow'));

  const rapidId = moduleByMechanic.get('rapid-match');
  const rapid = bindings
    .map(({ binding }) => binding)
    .filter((binding): binding is Extract<CardGameplayBinding, { kind: 'rapid' }> => (
      binding.kind === 'rapid' && binding.moduleId === rapidId
    ));
  assertRapidProjection(rapid);
  assert.ok(rapid.every((binding) => binding.symbolIds.every((symbolId) => symbolId.startsWith(`${rapidId}:`))));

  const memoryId = moduleByMechanic.get('memory-pair');
  const memory = bindings
    .map(({ binding }) => binding)
    .filter((binding): binding is Extract<CardGameplayBinding, { kind: 'memory' }> => (
      binding.kind === 'memory' && binding.moduleId === memoryId
    ));
  const pairs = new Map<string, typeof memory>();
  for (const binding of memory) pairs.set(binding.pairId, [...(pairs.get(binding.pairId) ?? []), binding]);
  assert.equal(pairs.size, 24);
  assert.ok([...pairs.values()].every((pair) => (
    pair.length === 2 && new Set(pair.map((binding) => binding.pairRole)).size === 2
  )));

  const quantityId = moduleByMechanic.get('quantity-trigger');
  const quantity = bindings
    .map(({ binding }) => binding)
    .filter((binding): binding is Extract<CardGameplayBinding, { kind: 'quantity' }> => (
      binding.kind === 'quantity' && binding.moduleId === quantityId
    ));
  const quantityCategories = new Map<string, typeof quantity>();
  for (const binding of quantity) {
    quantityCategories.set(binding.categoryId, [...(quantityCategories.get(binding.categoryId) ?? []), binding]);
  }
  assert.equal(quantityCategories.size, 4);
  for (const category of quantityCategories.values()) {
    assert.equal(category.length, 14);
    const distribution = new Map<number, number>();
    for (const binding of category) distribution.set(binding.value, (distribution.get(binding.value) ?? 0) + 1);
    assert.deepEqual(Object.fromEntries(distribution), { 1: 5, 2: 3, 3: 3, 4: 2, 5: 1 });
  }

  const expressionId = moduleByMechanic.get('icon-coop');
  const expression = bindings
    .map(({ binding }) => binding)
    .filter((binding): binding is Extract<CardGameplayBinding, { kind: 'expression' }> => (
      binding.kind === 'expression' && binding.moduleId === expressionId
    ));
  assert.equal(new Set(expression.map((binding) => binding.targetId)).size, 48);
  assert.deepEqual(
    Object.fromEntries(['animal', 'object', 'place', 'action', 'emotion'].map((category) => [
      category,
      expression.filter((binding) => binding.targetCategory === category).length,
    ])),
    { animal: 12, object: 12, place: 8, action: 8, emotion: 8 },
  );

  const riskId = moduleByMechanic.get('risk-draw');
  const risk = bindings
    .map(({ binding }) => binding)
    .filter((binding): binding is Extract<CardGameplayBinding, { kind: 'risk' }> => (
      binding.kind === 'risk' && binding.moduleId === riskId
    ));
  assert.equal(risk.filter((binding) => binding.cardKind === 'hazard').length, 5);
  assert.equal(risk.filter((binding) => binding.cardKind === 'rescue').length, 6);
  assert.equal(risk.filter((binding) => binding.cardKind === 'action').length, 45);
  assert.deepEqual(
    Object.fromEntries(['skip', 'reverse', 'attack', 'forecast', 'reorder', 'steal', 'exchange', 'demand'].map((action) => [
      action,
      risk.filter((binding) => binding.actionKind === action).length,
    ])),
    { skip: 6, reverse: 5, attack: 6, forecast: 6, reorder: 5, steal: 6, exchange: 5, demand: 6 },
  );
});

test('two instances of the same mechanic keep independent module namespaces', () => {
  const ruleKit = createRuleKit('双重记阵', ['memory-pair', 'memory-pair']);
  const plan = planDeckComposition(ruleKit);
  const bindings = projectedBindings(plan);

  assert.equal(plan.totalCards, 48);
  assert.equal(ruleKit.modules.length, 2);
  for (const module of ruleKit.modules) {
    const moduleBindings = bindings
      .map(({ binding }) => binding)
      .filter((binding): binding is Extract<CardGameplayBinding, { kind: 'memory' }> => (
        binding.kind === 'memory' && binding.moduleId === module.id
      ));
    assert.equal(moduleBindings.length, 48);
    assert.equal(new Set(moduleBindings.map((binding) => binding.pairId)).size, 24);
    assert.ok(moduleBindings.every((binding) => binding.pairId.startsWith(`${module.id}:`)));
  }
  const namespaces = ruleKit.modules.map((module) => new Set(
    bindings
      .map(({ binding }) => binding)
      .filter((binding): binding is Extract<CardGameplayBinding, { kind: 'memory' }> => (
        binding.kind === 'memory' && binding.moduleId === module.id
      ))
      .map((binding) => binding.pairId),
  ));
  assert.equal([...namespaces[0]].filter((pairId) => namespaces[1].has(pairId)).length, 0);
});

test('multiple rapid modules reserve separate 31-card stages before sharing any card surface', () => {
  const doubleRapid = createRuleKit('双瞬纹阵', ['rapid-match', 'rapid-match']);
  const doublePlan = planDeckComposition(doubleRapid);
  assertCompletePlan(doublePlan);
  assert.equal(doublePlan.totalCards, 62);
  assert.ok(doublePlan.slots.every((slot) => (
    gameplayBindingsForSlot(doublePlan, slot).filter((binding) => binding.kind === 'rapid').length === 1
  )));
  assert.ok(!doublePlan.constraints.some((constraint) => constraint.id === 'rapid-symbol-overflow'));

  const tripleRapid = createRuleKit('三重瞬纹阵', [
    'rapid-match',
    'rapid-match',
    'rapid-match',
  ]);
  const triplePlan = planDeckComposition(tripleRapid);
  assertCompletePlan(triplePlan);
  assert.equal(triplePlan.totalCards, 64);
  assert.ok(triplePlan.constraints.some((constraint) => constraint.id === 'rapid-symbol-overflow'));
});

test('dense maximum combinations cap at 64 cards without dropping bindings', () => {
  const ruleKit = createRuleKit('极限合炼', [
    'rapid-match',
    'memory-pair',
    'quantity-trigger',
    'icon-coop',
    'risk-draw',
  ]);
  const memoryPairs = ruleKit.modules[1].parameters.find((parameter) => parameter.id === 'pairCount');
  const expressionTargets = ruleKit.modules[3].parameters.find((parameter) => parameter.id === 'targetCount');
  assert.ok(memoryPairs && expressionTargets);
  memoryPairs.value = 32;
  expressionTargets.value = 64;
  ruleKit.modules.push(createCustomRuleModule({ id: 'dense-custom', name: '密层机关' }));

  const plan = planDeckComposition(ruleKit);
  const bindings = projectedBindings(plan);
  assertCompletePlan(plan);
  assert.equal(plan.totalCards, 64);
  assert.equal(bindings.length, 295);
  assert.ok(plan.constraints.some((item) => item.id === 'surface-density-overflow'));
  assert.ok(plan.slots.every((slot) => gameplayBindingsForSlot(plan, slot).length >= 4));
});

test('combined AI slot batches stay compact while typed gameplay bindings remain complete', () => {
  const ruleKit = createRuleKit('五艺合炼', [
    'rapid-match',
    'memory-pair',
    'quantity-trigger',
    'icon-coop',
    'risk-draw',
  ]);
  const plan = planDeckComposition(ruleKit);
  const batchLengths: number[] = [];

  for (let offset = 0; offset < plan.slots.length; offset += 8) {
    const slots = plan.slots.slice(offset, offset + 8);
    const generationBatch = {
      composition: {
        totalCards: plan.totalCards,
        parts: plan.parts.map(({ id, label, count }) => ({ id, label, count })),
        constraints: plan.constraints.map(({ id, label, description }) => ({ id, label, description })),
      },
      batch: {
        number: Math.floor(offset / 8) + 1,
        count: slots.length,
        slots: slots.map((slot) => ({
          id: slot.id,
          role: slot.role,
          attributes: Object.fromEntries(
            Object.entries(slot.attributes).filter(([key]) => key !== 'contentDirective'),
          ),
        })),
      },
    };
    batchLengths.push(JSON.stringify(generationBatch).length);
  }

  assert.ok(
    Math.max(...batchLengths) <= 4_000,
    `largest generation batch context was ${Math.max(...batchLengths)} characters`,
  );
  assert.equal(projectedBindings(plan).length, 239);
  assert.ok(plan.slots.every((slot) => {
    const attributes = slot.attributes;
    return !('moduleCoverage' in attributes)
      && !('layoutDensity' in attributes)
      && !('symbolIds' in attributes)
      && !('pairId' in attributes)
      && Array.isArray(attributes.moduleSpecs);
  }));
});

test('planning restores the first module when imported rules disable every module', () => {
  const ruleKit = createRuleKitForMode('memory');
  ruleKit.modules[0].enabled = false;
  const plan = planDeckComposition(ruleKit);
  assert.equal(plan.kind, 'memory');
  assert.equal(plan.totalCards, 48);
  assert.equal(plan.parts.find((part) => part.id === 'pair-side-a')?.count, 24);
});

test('mechanic player minima keep session counts playable', () => {
  const reflex = createRuleKitForMode('reflex');
  reflex.playerRange = { min: 1, max: 1 };
  assert.deepEqual(planDeckComposition(reflex).playSetup.playerRange, { min: 2, max: 2 });

  const expression = createRuleKitForMode('expression');
  expression.playerRange = { min: 1, max: 2 };
  assert.deepEqual(planDeckComposition(expression).playSetup.playerRange, { min: 3, max: 3 });
});
