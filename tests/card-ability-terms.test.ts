import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAbilityGlossaryEntries, deriveAbilityTerms } from '../src/card-ability-terms.ts';

test('turns long authored ability copy into concise front-face entries', () => {
  const terms = deriveAbilityTerms(
    '发现本牌与公共牌的唯一同纹并喊出名称后，立即将本牌覆盖到公共牌上。',
  );

  assert.deepEqual(terms, [
    { keyword: '识纹', effect: '喊出唯一同纹' },
    { keyword: '覆牌', effect: '覆盖到公共牌' },
  ]);
});

test('keeps at most three entries and converts rule quantities to compact Arabic notation', () => {
  const terms = deriveAbilityTerms(
    '查看牌堆顶三张牌并任意重排，然后将本牌弃置；下一位玩家可旋转九十度，再获得一枚标记。',
  );

  assert.ok(terms.length <= 3);
  assert.equal(terms[0].keyword, '篡序');
  assert.match(terms[0].effect, /3张/u);
  assert.equal(terms[1].effect, '弃置');
  assert.match(terms[2].effect, /90°/u);
  assert.ok(terms.every((term) => Array.from(term.effect).length <= 18));
});

test('simplifies miniature cards to one term and handles empty abilities', () => {
  assert.deepEqual(
    deriveAbilityTerms('配对失败并盖回时，可将其中一张旋转九十度，作为位置提示。', 1),
    [{ keyword: '配对', effect: '配对失败盖回' }],
  );
  assert.deepEqual(deriveAbilityTerms(''), []);
});

test('builds a printable glossary with compact terms and the complete authored meaning', () => {
  const fullSkill = '查看牌堆顶三张牌并任意重排，然后将本牌弃置。';
  const entries = buildAbilityGlossaryEntries([
    { name: '观星使', skill: fullSkill },
    { name: '守卷童子', skill: '' },
  ]);

  assert.equal(entries.length, 2);
  assert.match(entries[0], /^《观星使》【篡序】/u);
  assert.match(entries[0], /【弃策】弃置/u);
  assert.ok(entries[0].endsWith(`完整释义：${fullSkill}`));
  assert.match(entries[1], /【常驻】依照玩法说明执行/u);
  assert.match(entries[1], /完整释义：无额外能力。/u);
});
