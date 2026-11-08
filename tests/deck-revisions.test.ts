import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNextDeckRevision,
  deckRevisionReference,
  deckVersionKey,
  describeRevision,
  findDeckVersion,
  mergeDeckVersions,
} from '../src/services/deck-identity.ts';
import type { DeckData } from '../src/types.ts';

const SIGNED_CID = `blake3:${'c'.repeat(64)}`;

function sampleDeck(id = 'deck-local'): DeckData {
  return {
    id,
    theme: '云海机关城',
    name: '云海守卫',
    modeId: 'strategy',
    story: '少年工匠守护云海中的机关城。',
    rules: '部署卡牌并完成机关任务。',
    cards: [{
      id: `${id}-card`,
      name: '铜翼守卫',
      title: '云海先锋',
      modeId: 'strategy',
      artUrl: '/assets/cards/strategy.jpg',
      attack: 5,
      defense: 6,
      cost: 3,
      skill: '入场时获得一点护盾。',
      flavor: '齿轮转动，风暴止息。',
      rarity: '稀有',
      author: '南星',
    }],
    author: '南星',
  };
}

test('creates a local snapshot without mutating or reusing a signed payload', () => {
  const previous: DeckData = {
    ...sampleDeck('received-deck'),
    provenance: {
      cid: SIGNED_CID,
      signerPeerId: '12D3KooWTestPeer',
      signature: 'signed-version',
    },
  };
  const nextContent = { ...previous, story: '重绘后仍守护机关城。' };
  const snapshot = createNextDeckRevision(
    previous,
    nextContent,
    'card-regeneration',
    1_800_000_000_000,
  );

  assert.equal(previous.provenance?.cid, SIGNED_CID);
  assert.equal(nextContent.provenance?.cid, SIGNED_CID);
  assert.equal(snapshot.provenance, undefined);
  assert.deepEqual(snapshot.revision, {
    familyId: 'received-deck',
    revision: 2,
    createdAt: 1_800_000_000_000,
    reason: 'card-regeneration',
  });
  assert.notEqual(deckVersionKey(previous), deckVersionKey(snapshot));
});

test('allocates the next family revision across an existing local branch', () => {
  const initial = sampleDeck();
  const second = createNextDeckRevision(
    initial,
    { ...initial, name: '云海守卫二版' },
    'deck-generation',
    1_800_000_000_000,
  );
  const third = createNextDeckRevision(
    initial,
    { ...initial, id: 'new-ai-id', name: '云海守卫分支' },
    'deck-generation',
    1_800_000_100_000,
    [initial, second],
  );

  assert.equal(second.revision?.revision, 2);
  assert.equal(third.revision?.revision, 3);
  assert.equal(second.revision?.familyId, third.revision?.familyId);
  assert.equal(mergeDeckVersions([initial, second, third]).length, 3);
});

test('describes and restores the explicitly adopted local revision', () => {
  const initial = sampleDeck();
  const second = createNextDeckRevision(
    initial,
    { ...initial, name: '云海守卫二版' },
    'deck-generation',
    1_800_000_000_000,
  );
  const reference = deckRevisionReference(second);
  assert.deepEqual(reference, { familyId: 'deck-local', revision: 2 });
  const description = describeRevision(second);
  assert.equal(description.versionLabel, '第 2 版');
  assert.equal(description.reasonLabel, '整套炼制');
  assert.match(description.createdAtLabel ?? '', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u);
  assert.equal(findDeckVersion([initial, second], second.id, null, reference)?.name, '云海守卫二版');
});

test('deduplicates a local revision by family identity even if its content ID differs', () => {
  const initial = sampleDeck();
  const second = createNextDeckRevision(
    initial,
    { ...initial, name: '云海守卫二版' },
    'deck-generation',
    1_800_000_000_000,
  );
  const duplicateWithDifferentDeckId: DeckData = {
    ...second,
    id: 'different-content-id',
  };
  assert.equal(deckVersionKey(second), deckVersionKey(duplicateWithDifferentDeckId));
  assert.deepEqual(mergeDeckVersions([second, duplicateWithDifferentDeckId]), [
    duplicateWithDifferentDeckId,
  ]);
});
