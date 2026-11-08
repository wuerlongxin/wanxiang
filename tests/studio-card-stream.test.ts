import assert from 'node:assert/strict';
import test from 'node:test';

import {
  orderedCurrentStreamedCards,
  reconcileGeneratedCards,
} from '../src/scenes/studio-card-stream.ts';
import type { CardData } from '../src/types.ts';

function card(id: string, attack: number): CardData {
  return {
    id,
    name: id,
    title: '测试职责',
    modeId: 'strategy',
    artUrl: `data:image/webp;base64,${id}`,
    attack,
    defense: 10,
    cost: 1,
    skill: `能力-${attack}`,
    flavor: '测试卡牌',
    rarity: '普通',
    author: '测试作者',
  };
}

test('later streamed slots preserve edits already made to earlier cards', () => {
  const original = card('ai-card-0', 10);
  const edited = { ...original, attack: 88, skill: '玩家刚刚修改的能力' };
  const second = card('ai-card-1', 20);
  const streamed = new Map<number, CardData>([[0, original], [1, second]]);

  const ordered = orderedCurrentStreamedCards(streamed, [edited]);
  assert.equal(ordered[0].attack, 88);
  assert.equal(ordered[0].skill, '玩家刚刚修改的能力');
  assert.equal(ordered[1].id, second.id);

  const reconciled = reconcileGeneratedCards([original, second], streamed, [edited, second]);
  assert.equal(reconciled[0].attack, 88);
  assert.equal(reconciled[0].skill, '玩家刚刚修改的能力');
  assert.ok(reconciled.every((value) => !('artworkReview' in value)));
});
