import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CUSTOM_DECK_PARTS_TEXT,
  parseCustomDeckParts,
  resolveCustomDeckComposition,
} from '../src/custom-composition.ts';
import { planDeckComposition } from '../src/deck-composition.ts';
import { createCustomRuleModule, createRuleKit } from '../src/rules.ts';

test('parses an authored custom deck recipe and rejects ambiguous totals', () => {
  const parsed = parseCustomDeckParts('角色牌：6\n行动牌:30');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.totalCards, 36);
  assert.deepEqual(parsed.parts.map(({ label, count }) => [label, count]), [
    ['角色牌', 6],
    ['行动牌', 30],
  ]);

  const tooSmall = parseCustomDeckParts('角色牌：4\n行动牌：4');
  assert.equal(tooSmall.ok, false);
  const duplicate = parseCustomDeckParts('行动牌：12\n行动牌：12');
  assert.equal(duplicate.ok, false);
  assert.throws(
    () => createCustomRuleModule({ deckParts: '行动牌：8' }),
    /完整盒装需为 12–64 张/u,
  );
});

test('custom rule modules drive complete-box parts and standard-session counts', () => {
  const module = createCustomRuleModule({
    id: 'authored-composition',
    deckParts: '角色牌：6\n行动牌：30',
    cardsInPlay: 28,
  });
  const ruleKit = createRuleKit('原创规则', []);
  ruleKit.modules = [module];

  const resolved = resolveCustomDeckComposition(module);
  const plan = planDeckComposition(ruleKit);
  assert.equal(resolved.totalCards, 36);
  assert.equal(resolved.cardsInPlay, 28);
  assert.equal(plan.totalCards, 36);
  assert.deepEqual(plan.parts.map(({ label, count }) => [label, count]), [
    ['角色牌', 6],
    ['行动牌', 30],
  ]);
  assert.equal(plan.playSetup.cardsInPlay.default, 28);
  assert.match(plan.playSetup.summary, /组合局按阶段投入 28 张（盒装 36 张）/u);
});

test('legacy custom modules without composition metadata receive the editable 24-card recipe', () => {
  const legacy = createCustomRuleModule({ id: 'legacy-custom' });
  legacy.parameters = [];
  const resolved = resolveCustomDeckComposition(legacy);
  assert.equal(resolved.totalCards, 24);
  assert.equal(resolved.cardsInPlay, 24);
  assert.equal(
    resolved.parts.map(({ label, count }) => `${label}：${count}`).join('\n'),
    DEFAULT_CUSTOM_DECK_PARTS_TEXT,
  );
});
