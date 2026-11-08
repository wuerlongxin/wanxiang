import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRINT_ARTWORK_MIN_HEIGHT_PX,
  PRINT_ARTWORK_MIN_WIDTH_PX,
  PRINT_ARTWORK_TARGET_HEIGHT_PX,
  PRINT_ARTWORK_TARGET_WIDTH_PX,
  PrintArtworkPreflightError,
  assessPrintArtworkResolution,
  assertPrintArtworkReady,
  inspectPrintArtwork,
} from '../src/services/print-artwork-preflight.ts';

const cards = [
  { id: 'card-1', name: '榫星司南', artUrl: 'asset://shared' },
  { id: 'card-2', name: '云纹藏书灵', artUrl: 'asset://shared' },
  { id: 'card-3', name: '火浣巡城将', artUrl: 'asset://missing' },
];

test('accepts current starter artwork without upscaling and rejects clearly undersized art', () => {
  const starter = assessPrintArtworkResolution(768, 1152);
  assert.equal(starter.ready, true);
  assert.equal(starter.upscaleFactor < 1, true);
  assert.equal(starter.effectivePpi, 300);

  const exactTarget = assessPrintArtworkResolution(
    PRINT_ARTWORK_TARGET_WIDTH_PX,
    PRINT_ARTWORK_TARGET_HEIGHT_PX,
  );
  assert.equal(exactTarget.ready, true);
  assert.equal(exactTarget.effectivePpi, 300);

  const undersized = assessPrintArtworkResolution(320, 480);
  assert.equal(undersized.ready, false);
  assert.equal(undersized.effectivePpi < 240, true);
  assert.deepEqual(
    [PRINT_ARTWORK_MIN_WIDTH_PX, PRINT_ARTWORK_MIN_HEIGHT_PX],
    [546, 740],
  );
});

test('loads shared artwork once and returns card-specific resolution issues', async () => {
  const calls: string[] = [];
  const issues = await inspectPrintArtwork(cards, async (url) => {
    calls.push(url);
    return url === 'asset://shared' ? { width: 320, height: 480 } : null;
  });

  assert.deepEqual(calls, ['asset://shared', 'asset://missing']);
  assert.deepEqual(
    issues.map((issue) => [issue.cardName, issue.reason, issue.width, issue.height]),
    [
      ['榫星司南', 'undersized', 320, 480],
      ['云纹藏书灵', 'undersized', 320, 480],
      ['火浣巡城将', 'unreadable', 0, 0],
    ],
  );
});

test('resolves a legacy bundled path only for loading while preserving card data', async () => {
  const legacyCard = {
    id: 'legacy-card',
    name: '旧版霜脉棋师',
    artUrl: '/assets/cards/strategy.webp',
  };
  const calls: string[] = [];

  const issues = await inspectPrintArtwork([legacyCard], async (url) => {
    calls.push(url);
    return { width: 768, height: 1152 };
  });

  assert.deepEqual(calls, ['/assets/cards/strategy.jpg']);
  assert.deepEqual(issues, []);
  assert.equal(legacyCard.artUrl, '/assets/cards/strategy.webp');
});

test('blocks export with an actionable Chinese error that names affected cards', async () => {
  await assert.rejects(
    assertPrintArtworkReady(cards, async (url) =>
      url === 'asset://shared' ? { width: 320, height: 480 } : null),
    (error: unknown) => {
      assert.ok(error instanceof PrintArtworkPreflightError);
      assert.equal(error.code, 'PRINT_ARTWORK_NOT_READY');
      assert.match(error.message, /榫星司南/u);
      assert.match(error.message, /云纹藏书灵/u);
      assert.match(error.message, /火浣巡城将/u);
      assert.match(error.message, /320x480/u);
      assert.match(error.message, /最低 546x740 像素/u);
      assert.match(error.message, /设计台重绘/u);
      return true;
    },
  );
});

test('treats loader failures as unreadable artwork instead of continuing silently', async () => {
  const issues = await inspectPrintArtwork(
    [{ id: 'card-4', name: '失落画轴', artUrl: 'asset://broken' }],
    async () => {
      throw new Error('decode failed');
    },
  );

  assert.deepEqual(issues.map((issue) => [issue.cardName, issue.reason]), [
    ['失落画轴', 'unreadable'],
  ]);
});
