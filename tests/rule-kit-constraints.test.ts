import assert from 'node:assert/strict';
import test from 'node:test';

import { planDeckComposition } from '../src/deck-composition.ts';
import {
  MAX_RULE_MODULES,
  compareRuleModuleIds,
} from '../src/rule-kit-constraints.ts';
import {
  createCustomRuleModule,
  createRuleKit,
  createRuleModule,
  resolveDeckRuleKit,
} from '../src/rules.ts';
import { createStarterDeck } from '../src/data.ts';

test('module ids are normalized once and explicit blank ids are rejected', () => {
  assert.equal(createRuleModule('memory-pair', '　ｍｅｍｏｒｙ-１　').id, 'memory-1');
  assert.equal(createCustomRuleModule({ id: '  custom-Ａ  ' }).id, 'custom-A');
  assert.throws(() => createRuleModule('memory-pair', ' 　 '), /ID 不能为空/u);
  assert.throws(() => createCustomRuleModule({ id: '\n\t' }), /ID 不能为空/u);
});

test('composition planning rejects empty and canonically duplicated module namespaces', () => {
  const duplicate = createRuleKit('重复命名空间', ['memory-pair', 'rapid-match']);
  duplicate.modules[1].id = `　${duplicate.modules[0].id}　`;
  assert.throws(() => planDeckComposition(duplicate), /ID 必须非空且不得重复/u);

  const empty = createRuleKit('空命名空间', ['memory-pair']);
  empty.modules[0].id = '   ';
  assert.throws(() => planDeckComposition(empty), /ID 必须非空且不得重复/u);
});

test('rule-kit creation and planning share the sixteen-module exchange limit', () => {
  const atLimit = createRuleKit(
    '十六枚积木',
    Array.from({ length: MAX_RULE_MODULES }, () => 'memory-pair'),
  );
  assert.equal(atLimit.modules.length, MAX_RULE_MODULES);
  assert.equal(planDeckComposition(atLimit).totalCards, 64);

  assert.throws(
    () => createRuleKit(
      '超出上限',
      Array.from({ length: MAX_RULE_MODULES + 1 }, () => 'memory-pair'),
    ),
    /最多 16 枚/u,
  );

  const bypassed = createRuleKit('绕过创建器', ['memory-pair']);
  bypassed.modules = Array.from({ length: MAX_RULE_MODULES + 1 }, (_, index) => ({
    ...bypassed.modules[0],
    id: `memory-${index + 1}`,
  }));
  assert.throws(() => planDeckComposition(bypassed), /最多 16 枚/u);
});

test('persisted rule kits normalize safe ids and reject canonical collisions', () => {
  const deck = createStarterDeck('memory');
  const normalized = createRuleKit('可规范化', ['memory-pair']);
  normalized.modules[0].id = '　ｍｅｍｏｒｙ-１　';
  const resolved = resolveDeckRuleKit({ ...deck, ruleKit: normalized });
  assert.equal(resolved.modules[0].id, 'memory-1');

  const collision = createRuleKit('碰撞', ['memory-pair', 'rapid-match']);
  collision.modules[1].id = ` ${collision.modules[0].id} `;
  const fallback = resolveDeckRuleKit({ ...deck, ruleKit: collision });
  assert.equal(fallback.modules.length, 1);
  assert.equal(fallback.modules[0].templateId, 'memory-pair');
  assert.notEqual(fallback.title, collision.title);
});

test('persisted templates are constrained to gameplay structures the deck compiler guarantees', () => {
  const rapidDeck = createStarterDeck('reflex');
  const rapidKit = createRuleKit('旧版同色规则', ['rapid-match']);
  const matchRule = rapidKit.modules[0].parameters.find((parameter) => parameter.id === 'matchRule');
  assert.ok(matchRule);
  matchRule.value = 'same-color';
  matchRule.choices?.push({ value: 'same-color', label: '相同色彩' });
  const resolvedRapid = resolveDeckRuleKit({ ...rapidDeck, ruleKit: rapidKit });
  const resolvedMatch = resolvedRapid.modules[0].parameters.find((parameter) => parameter.id === 'matchRule');
  assert.equal(resolvedMatch?.value, 'same-symbol');
  assert.deepEqual(resolvedMatch?.choices, [{ value: 'same-symbol', label: '相同符号' }]);
  assert.ok(planDeckComposition(rapidKit).slots.every(
    (slot) => slot.attributes.matchRule === 'same-symbol',
  ));

  const memoryDeck = createStarterDeck('memory');
  const memoryKit = createRuleKit('旧版多翻规则', ['memory-pair']);
  const flipCount = memoryKit.modules[0].parameters.find((parameter) => parameter.id === 'flipCount');
  assert.ok(flipCount);
  flipCount.value = 4;
  flipCount.max = 4;
  const resolvedMemory = resolveDeckRuleKit({ ...memoryDeck, ruleKit: memoryKit });
  const resolvedFlip = resolvedMemory.modules[0].parameters.find((parameter) => parameter.id === 'flipCount');
  assert.equal(resolvedFlip?.value, 2);
  assert.equal(resolvedFlip?.min, 2);
  assert.equal(resolvedFlip?.max, 2);
});

test('module id tie-break compares Unicode code points without locale state', () => {
  assert.ok(compareRuleModuleIds('\ue000', '😀') < 0);
  assert.ok(compareRuleModuleIds('module-2', 'module-10') > 0);
  assert.equal(compareRuleModuleIds('同名', '同名'), 0);
});
