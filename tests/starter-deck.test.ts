import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('starter decks use four distinct local artworks and gameplay-specific cards', () => {
  const modes = ['reflex', 'memory', 'strategy', 'expression', 'mischief'];
  const source = readFileSync('src/data.ts', 'utf8');
  assert.match(source, /STARTER_CARD_BLUEPRINTS/u);
  assert.match(source, /\/assets\/cards\/starter\/\$\{modeId\}-\$\{normalizedIndex \+ 1\}\.jpg/u);

  for (const mode of modes) {
    const hashes = Array.from({ length: 4 }, (_, index) => {
      const bytes = readFileSync(`public/assets/cards/starter/${mode}-${index + 1}.jpg`);
      assert.equal(bytes[0], 0xff);
      assert.equal(bytes[1], 0xd8);
      assert.equal(bytes.at(-2), 0xff);
      assert.equal(bytes.at(-1), 0xd9);
      return createHash('sha256').update(bytes).digest('hex');
    });
    assert.equal(new Set(hashes).size, 4, `${mode} should use four distinct images`);
  }
});
