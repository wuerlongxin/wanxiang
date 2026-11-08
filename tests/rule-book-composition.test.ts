import assert from 'node:assert/strict';
import test from 'node:test';

import { createStarterDeck } from '../src/data.ts';
import { createRuleKit, generateRuleBook, renderDeckRules } from '../src/rules.ts';

test('renders rule parameters before deck-facing text is shown', () => {
  const deck = createStarterDeck('memory');
  deck.rules = '当前玩家翻开任意{{flipCount}}，成功后追加回合：{{bonusTurn}}。';

  assert.equal(
    renderDeckRules(deck),
    '当前玩家翻开任意2张，成功后追加回合：启用。',
  );
});

test('printed rulebook distinguishes complete box inventory from one-session setup', () => {
  const ruleBook = generateRuleBook(createStarterDeck('mischief'));

  assert.match(ruleBook.setup[0], /完整牌组共56张/u);
  assert.match(ruleBook.setup[1], /N−1 张危机、N 张护航/u);
  assert.ok(ruleBook.quickReference.some((line) => /4人标准局投入 52 张（盒装 56 张）/u.test(line)));
  assert.ok(ruleBook.components.includes('回合方向标记 1 枚'));
});

test('rapid and quantity rulebooks remain playable from setup through deck exhaustion', () => {
  const rapid = generateRuleBook(createStarterDeck('reflex'));
  assert.ok(rapid.setup.some((line) => line.includes('补给牌库')));
  assert.ok(rapid.flow.some((step) => step.instruction.includes('补回1张观察牌')));

  const strategy = generateRuleBook(createStarterDeck('strategy'));
  assert.ok(strategy.flow.some((step) => step.instruction.includes('补回1张手牌')));
});

test('risk rulebook inventory expands visibly when the player range needs more safety cards', () => {
  const deck = createStarterDeck('mischief');
  assert.ok(deck.ruleKit);
  deck.ruleKit.playerRange = { min: 2, max: 8 };
  const hazard = deck.ruleKit.modules[0].parameters.find((parameter) => parameter.id === 'hazardCount');
  const rescue = deck.ruleKit.modules[0].parameters.find((parameter) => parameter.id === 'rescueCount');
  assert.ok(hazard && rescue);
  hazard.value = 1;
  rescue.value = 1;

  const ruleBook = generateRuleBook(deck);
  assert.match(ruleBook.setup[0], /完整牌组共60张/u);
  assert.ok(ruleBook.setup.some((line) => /盒装含7张危机牌与8张护航牌/u.test(line)));
});

test('combined rulebooks use the same stage-based card filtering as composition planning', () => {
  const deck = createStarterDeck('memory');
  deck.ruleKit = createRuleKit('闪忆双轨', ['memory-pair', 'rapid-match']);
  const ruleBook = generateRuleBook(deck);
  const sequence = ruleBook.flow.find((step) => step.moduleName === '组合顺序');

  assert.ok(sequence);
  assert.match(sequence.instruction, /分阶段/u);
  assert.match(sequence.instruction, /只识别带对应玩法印谱的牌/u);
  assert.doesNotMatch(sequence.instruction, /每轮.*依次结算/u);
});
