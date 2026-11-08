import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  FORENSIC_WATERMARK_MAX_CHANNEL_DELTA,
  FORENSIC_WATERMARK_REPETITIONS,
  createForensicWatermarkPayload,
  embedForensicWatermark,
  extractForensicWatermark,
  verifyForensicWatermark,
  type CardForensicWatermarkSubject,
  type ForensicWatermarkPixels,
} from '../src/services/forensic-watermark.ts';

const SUBJECT: CardForensicWatermarkSubject = {
  deckId: 'deck-celestial-forge',
  familyId: 'family-celestial-forge',
  revision: 7,
  cid: `blake3:${'a1'.repeat(32)}`,
  cardId: 'card-jade-dragon',
  side: 'front',
};

function createPixels(width = 240, height = 320): ForensicWatermarkPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 0x4d595df4;
  for (let index = 0; index < data.length; index += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[index] = seed & 0xff;
    data[index + 1] = (seed >>> 8) & 0xff;
    data[index + 2] = (seed >>> 16) & 0xff;
    data[index + 3] = 255;
  }
  return { width, height, data };
}

function clonePixels(pixels: ForensicWatermarkPixels): ForensicWatermarkPixels {
  return {
    width: pixels.width,
    height: pixels.height,
    data: new Uint8ClampedArray(pixels.data),
  };
}

test('builds a deterministic fingerprint bound to deck version, CID, card, and side', async () => {
  const first = await createForensicWatermarkPayload(SUBJECT);
  const repeated = await createForensicWatermarkPayload({ ...SUBJECT });
  assert.deepEqual(repeated, first);
  assert.match(first.fingerprint, /^[0-9a-f]{32}$/u);

  for (const changed of [
    { ...SUBJECT, deckId: 'deck-another-forge' },
    { ...SUBJECT, familyId: 'family-another-forge' },
    { ...SUBJECT, revision: 8 },
    { ...SUBJECT, cid: `blake3:${'b2'.repeat(32)}` },
    { ...SUBJECT, cardId: 'card-vermilion-bird' },
    { ...SUBJECT, side: 'back' as const },
  ]) {
    const payload = await createForensicWatermarkPayload(changed);
    assert.notEqual(payload.fingerprint, first.fingerprint);
  }
});

test('embeds and extracts an imperceptible fingerprint from a lossless pixel copy', async () => {
  const pixels = createPixels();
  const original = clonePixels(pixels);
  const embedding = await embedForensicWatermark(pixels, SUBJECT);

  assert.equal(embedding.samplePairs, 25 * 8 * FORENSIC_WATERMARK_REPETITIONS);
  assert.equal(embedding.maxChannelDelta, FORENSIC_WATERMARK_MAX_CHANNEL_DELTA);
  assert.ok(embedding.modifiedChannels > 0);
  assert.ok(embedding.modifiedChannels <= embedding.samplePairs);

  let changedChannels = 0;
  for (let index = 0; index < pixels.data.length; index += 1) {
    const delta = Math.abs(pixels.data[index] - original.data[index]);
    assert.ok(delta <= FORENSIC_WATERMARK_MAX_CHANNEL_DELTA);
    if (delta > 0) {
      changedChannels += 1;
      assert.notEqual(index % 4, 3, 'alpha must remain untouched');
    }
  }
  assert.equal(changedChannels, embedding.modifiedChannels);

  const losslessCopy = clonePixels(pixels);
  const extracted = await extractForensicWatermark(losslessCopy, SUBJECT);
  assert.equal(extracted?.fingerprint, embedding.payload.fingerprint);
  assert.equal((await verifyForensicWatermark(losslessCopy, SUBJECT)).verified, true);
});

test('rejects an unmarked surface and a mismatched card-side identity', async () => {
  const clean = createPixels();
  assert.equal(await extractForensicWatermark(clean, SUBJECT), null);

  await embedForensicWatermark(clean, SUBJECT);
  const wrongSide = { ...SUBJECT, side: 'back' as const };
  const wrongCard = { ...SUBJECT, cardId: 'card-other' };
  assert.equal((await verifyForensicWatermark(clean, wrongSide)).verified, false);
  assert.equal((await verifyForensicWatermark(clean, wrongCard)).verified, false);
});

test('retains verification after sparse isolated LSB damage', async () => {
  const pixels = createPixels();
  await embedForensicWatermark(pixels, SUBJECT);
  for (let pixel = 0; pixel < pixels.width * pixels.height; pixel += 173) {
    const channel = (pixel % 3);
    const offset = pixel * 4 + channel;
    pixels.data[offset] ^= 1;
  }
  assert.equal((await verifyForensicWatermark(pixels, SUBJECT)).verified, true);
});

test('integrates the hidden mark after both completed card renderers', () => {
  const source = readFileSync(
    new URL('../src/services/export-pdf.ts', import.meta.url),
    'utf8',
  );
  const frontStart = source.indexOf('async function renderPrintCard(');
  const backStart = source.indexOf('async function renderPrintCardBack(');
  const wrapStart = source.indexOf('function wrapText(', backStart);
  const frontRenderer = source.slice(frontStart, backStart);
  const backRenderer = source.slice(backStart, wrapStart);

  assert.match(frontRenderer, /drawPrintOwnershipMark\(context, deck\);[\s\S]*embedPrintForensicWatermark\(context, canvas, deck, card, 'front'\)/u);
  assert.match(backRenderer, /drawPrintOwnershipMark\(context, deck\);[\s\S]*embedPrintForensicWatermark\(context, canvas, deck, card, 'back'\)/u);
});
