import assert from 'node:assert/strict';
import test from 'node:test';

import { getPrintDeckIdentity } from '../src/services/print-identity.ts';

test('keeps legacy print identity limited to its stable deck ID', () => {
  const identity = getPrintDeckIdentity({ id: 'deck-original' });

  assert.equal(identity.familyId, null);
  assert.equal(identity.revision, null);
  assert.equal(identity.cid, null);
  assert.equal(identity.metadataLabel, 'deckId=deck-original');
  assert.equal(identity.footerLabel, 'ID:deck-original');
  assert.equal(identity.watermarkLabel, 'AD:deck-original');
});

test('adds the full revision family and signed CID to metadata', () => {
  const cid = `blake3:${'a1'.repeat(32)}`;
  const identity = getPrintDeckIdentity({
    id: 'deck-current',
    revision: {
      familyId: 'family-ancient-forge',
      revision: 7,
      createdAt: 1_785_349_800_000,
      reason: 'card-regeneration',
    },
    provenance: {
      cid,
      signerPeerId: '12D3KooWSigner',
      signature: 'signed',
    },
  });

  assert.equal(identity.familyId, 'family-ancient-forge');
  assert.equal(identity.revision, 7);
  assert.equal(identity.cid, cid);
  assert.match(identity.metadataLabel, /familyId=family-ancient-forge/u);
  assert.match(identity.metadataLabel, /revision=7/u);
  assert.match(identity.metadataLabel, new RegExp(`cid=${cid}`, 'u'));
  assert.match(identity.footerLabel, /F:family-ancient-f~/u);
  assert.match(identity.footerLabel, /R:7/u);
  assert.match(identity.footerLabel, /CID:a1a1a1a1a1a1a1a1/u);
  assert.match(identity.watermarkLabel, /F:family-ancient-forge/u);
  assert.match(identity.watermarkLabel, /R:7/u);
  assert.match(identity.watermarkLabel, /CID:a1a1a1a1a1a1a1a1/u);
});
