import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRuntimeArtworkUrl } from '../src/services/print-artwork-preflight.ts';

test('resolves legacy bundled card artwork without changing signed deck data', () => {
  const main = '/assets/cards/strategy.webp';
  const starter = '/assets/cards/starter/reflex-4.webp';

  assert.equal(resolveRuntimeArtworkUrl(main), '/assets/cards/strategy.jpg');
  assert.equal(resolveRuntimeArtworkUrl(starter), '/assets/cards/starter/reflex-4.jpg');
  assert.equal(main, '/assets/cards/strategy.webp');
  assert.equal(starter, '/assets/cards/starter/reflex-4.webp');
});

test('does not rewrite embedded WebP data or unrelated URLs', () => {
  const embedded = 'data:image/webp;base64,UklGRg==';
  const unrelated = '/assets/cards/community.webp';
  const remote = 'https://example.test/cards/strategy.webp';

  assert.equal(resolveRuntimeArtworkUrl(embedded), embedded);
  assert.equal(resolveRuntimeArtworkUrl(unrelated), unrelated);
  assert.equal(resolveRuntimeArtworkUrl(remote), remote);
});
