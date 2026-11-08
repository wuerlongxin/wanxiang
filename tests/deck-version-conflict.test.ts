import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deckVersionKey,
  findDeckVersion,
  mergeDeckVersions,
} from '../src/services/deck-identity.ts';

const CID_A = `blake3:${'a'.repeat(64)}`;
const CID_B = `blake3:${'b'.repeat(64)}`;

function deck(cid: string | null, story: string) {
  return {
    id: 'shared-id',
    theme: '云海机械城',
    name: '云海守卫',
    modeId: 'strategy' as const,
    story,
    rules: '部署卡牌并守住核心。',
    cards: [{
      id: 'shared-card',
      name: '铜翼守卫',
      title: '云海先锋',
      modeId: 'strategy' as const,
      artUrl: '/assets/cards/strategy.jpg',
      attack: 5,
      defense: 6,
      cost: 3,
      skill: '入场时获得一点护盾。',
      flavor: '齿轮转动，风暴止息。',
      rarity: '稀有' as const,
      author: '南星',
    }],
    author: '南星',
    ...(cid ? {
      provenance: {
        cid,
        signerPeerId: '12D3KooWTestPeer',
        signature: 'signed-version',
      },
    } : {}),
  };
}

test('keeps same-id decks with different signed content CIDs', () => {
  const first = deck(CID_A, '云城初版');
  const second = deck(CID_B, '云城再版');
  const merged = mergeDeckVersions([first, second]);

  assert.equal(merged.length, 2);
  assert.notEqual(deckVersionKey(first), deckVersionKey(second));
  assert.equal(findDeckVersion(merged, 'shared-id', CID_A)?.story, '云城初版');
  assert.equal(findDeckVersion(merged, 'shared-id', CID_B)?.story, '云城再版');
});

test('deduplicates only an exact id-and-CID retry', () => {
  const first = deck(CID_A, '云城初版');
  const retried = deck(CID_A, '同一签名版本的重试');

  assert.deepEqual(mergeDeckVersions([first, retried]), [retried]);
});

test('selects both persisted versions without changing signed deck IDs', () => {
  const first = deck(CID_A, '云城初版');
  const second = deck(CID_B, '云城再版');
  const decks = mergeDeckVersions([first, second]);

  assert.equal(decks.length, 2);
  assert.deepEqual(decks.map((item) => item.id), ['shared-id', 'shared-id']);
  assert.equal(findDeckVersion(decks, 'shared-id', CID_B)?.story, '云城再版');
});

test('resolves a legacy activeDeckId only when it is unambiguous', () => {
  const legacy = [deck(CID_A, '旧版交换套牌')];

  assert.equal(findDeckVersion(legacy, 'shared-id')?.story, '旧版交换套牌');
  assert.equal(
    findDeckVersion([deck(CID_A, '初版'), deck(CID_B, '再版')], 'shared-id'),
    undefined,
  );
});
