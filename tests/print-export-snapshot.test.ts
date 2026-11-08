import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeckPrintSnapshot } from '../src/services/export-pdf.ts';
import type { DeckData } from '../src/types.ts';

function deck(): DeckData {
  return {
    id: 'ai-deck-snapshot',
    theme: '云海机关',
    name: '快照测试套牌',
    modeId: 'strategy',
    story: '测试导出快照。',
    rules: '轮流行动。',
    cards: [{
      id: 'ai-snapshot-card',
      name: '云纹守卫',
      title: '机关先锋',
      modeId: 'strategy',
      artUrl: 'data:image/webp;base64,original-art',
      attack: 4,
      defense: 5,
      cost: 2,
      skill: '守护云门。',
      flavor: '齿轮随风而行。',
      rarity: '稀有',
      author: '测试作者',
    }],
    author: '测试作者',
  };
}

test('print snapshots do not observe later artwork or content mutations', () => {
  const source = deck();
  const snapshot = createDeckPrintSnapshot(source);
  source.cards[0].artUrl = 'data:image/webp;base64,new-art';
  source.cards[0].skill = '后来修改的能力';

  assert.notEqual(snapshot, source);
  assert.notEqual(snapshot.cards, source.cards);
  assert.equal(snapshot.cards[0].artUrl, 'data:image/webp;base64,original-art');
  assert.equal(snapshot.cards[0].skill, '守护云门。');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.cards), true);
  assert.equal(Object.isFrozen(snapshot.cards[0]), true);
});
