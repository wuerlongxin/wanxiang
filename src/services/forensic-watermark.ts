import type { CardData, DeckData } from '../types.ts';
import { getPrintDeckIdentity } from './print-identity.ts';

export const FORENSIC_WATERMARK_VERSION = 1 as const;
export const FORENSIC_WATERMARK_REPETITIONS = 9;
export const FORENSIC_WATERMARK_MAX_CHANNEL_DELTA = 1;

const WATERMARK_NAMESPACE = 'wanxiang-deck/card-forensic-watermark';
const FRAME_MAGIC = new Uint8Array([0x41, 0x44, 0x46, 0x57]); // ADFW
const FINGERPRINT_BYTES = 16;
const CHECKSUM_BYTES = 4;
const FRAME_BYTES = FRAME_MAGIC.length + 1 + FINGERPRINT_BYTES + CHECKSUM_BYTES;
const MIN_SURFACE_EDGE = 96;

export type ForensicWatermarkSide = 'front' | 'back';

export interface CardForensicWatermarkSubject {
  readonly deckId: string;
  readonly familyId: string | null;
  readonly revision: number | null;
  readonly cid: string | null;
  readonly cardId: string;
  readonly side: ForensicWatermarkSide;
}

export interface ForensicWatermarkPayload extends CardForensicWatermarkSubject {
  readonly namespace: typeof WATERMARK_NAMESPACE;
  readonly version: typeof FORENSIC_WATERMARK_VERSION;
  readonly fingerprint: string;
}

export interface ForensicWatermarkPixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface ForensicWatermarkEmbedding {
  readonly payload: ForensicWatermarkPayload;
  readonly samplePairs: number;
  readonly modifiedChannels: number;
  readonly maxChannelDelta: typeof FORENSIC_WATERMARK_MAX_CHANNEL_DELTA;
}

export interface ExtractedForensicWatermark {
  readonly version: typeof FORENSIC_WATERMARK_VERSION;
  readonly fingerprint: string;
}

export interface ForensicWatermarkVerification {
  readonly verified: boolean;
  readonly expectedFingerprint: string;
  readonly extractedFingerprint: string | null;
}

interface SamplePair {
  readonly first: number;
  readonly second: number;
}

export function createCardForensicWatermarkSubject(
  deck: Pick<DeckData, 'id' | 'revision' | 'provenance'>,
  card: Pick<CardData, 'id'>,
  side: ForensicWatermarkSide,
): CardForensicWatermarkSubject {
  const identity = getPrintDeckIdentity(deck);
  return {
    deckId: identity.deckId,
    familyId: identity.familyId,
    revision: identity.revision,
    cid: identity.cid,
    cardId: card.id,
    side,
  };
}

function canonicalSubject(subject: CardForensicWatermarkSubject): string {
  return JSON.stringify([
    WATERMARK_NAMESPACE,
    FORENSIC_WATERMARK_VERSION,
    subject.deckId,
    subject.familyId,
    subject.revision,
    subject.cid,
    subject.cardId,
    subject.side,
  ]);
}

async function subjectFingerprint(subject: CardForensicWatermarkSubject): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('当前运行环境不支持取证水印所需的 SHA-256。');
  const source = new TextEncoder().encode(canonicalSubject(subject));
  const digest = new Uint8Array(await subtle.digest('SHA-256', source));
  return digest.slice(0, FINGERPRINT_BYTES);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function crc32(bytes: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] * 0x1000000)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  ) >>> 0;
}

function buildFrame(fingerprint: Uint8Array): Uint8Array {
  const frame = new Uint8Array(FRAME_BYTES);
  frame.set(FRAME_MAGIC, 0);
  frame[FRAME_MAGIC.length] = FORENSIC_WATERMARK_VERSION;
  frame.set(fingerprint, FRAME_MAGIC.length + 1);
  const checksumOffset = FRAME_BYTES - CHECKSUM_BYTES;
  writeUint32(frame, checksumOffset, crc32(frame.subarray(0, checksumOffset)));
  return frame;
}

function bytesToBits(bytes: Uint8Array): Uint8Array {
  const bits = new Uint8Array(bytes.length * 8);
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    for (let bit = 0; bit < 8; bit += 1) {
      bits[byteIndex * 8 + bit] = (bytes[byteIndex] >>> (7 - bit)) & 1;
    }
  }
  return bits;
}

function bitsToBytes(bits: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let index = 0; index < bits.length; index += 1) {
    bytes[index >>> 3] |= bits[index] << (7 - (index & 7));
  }
  return bytes;
}

function validatePixels(pixels: ForensicWatermarkPixels): void {
  if (
    !Number.isInteger(pixels.width)
    || !Number.isInteger(pixels.height)
    || pixels.width < MIN_SURFACE_EDGE
    || pixels.height < MIN_SURFACE_EDGE
    || pixels.data.length !== pixels.width * pixels.height * 4
  ) {
    throw new TypeError(`取证水印画布至少需要 ${MIN_SURFACE_EDGE} x ${MIN_SURFACE_EDGE} 的有效 RGBA 像素。`);
  }
}

function samplingSeed(fingerprint: Uint8Array, width: number, height: number): number {
  let seed = (0x811c9dc5 ^ width ^ Math.imul(height, 0x9e3779b1)) >>> 0;
  for (const byte of fingerprint) {
    seed ^= byte;
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  return seed || 0x6d2b79f5;
}

function createRandom(seedValue: number): () => number {
  let seed = seedValue >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
}

function createSamplePairs(
  width: number,
  height: number,
  fingerprint: Uint8Array,
  count: number,
): SamplePair[] {
  const random = createRandom(samplingSeed(fingerprint, width, height));
  const margin = Math.max(8, Math.floor(Math.min(width, height) * 0.02));
  const usableWidth = width - margin * 2;
  const usableHeight = height - margin * 2;
  const usedChannels = new Set<number>();
  const pairs: SamplePair[] = [];
  const maximumAttempts = count * 24;

  for (let attempt = 0; attempt < maximumAttempts && pairs.length < count; attempt += 1) {
    const horizontal = (random() & 1) === 0;
    const xRange = usableWidth - (horizontal ? 1 : 0);
    const yRange = usableHeight - (horizontal ? 0 : 1);
    const x = margin + (random() % xRange);
    const y = margin + (random() % yRange);
    const channel = random() % 3;
    const nextX = horizontal ? x + 1 : x;
    const nextY = horizontal ? y : y + 1;
    const first = (y * width + x) * 4 + channel;
    const second = (nextY * width + nextX) * 4 + channel;
    if (usedChannels.has(first) || usedChannels.has(second)) continue;
    usedChannels.add(first);
    usedChannels.add(second);
    pairs.push({ first, second });
  }

  if (pairs.length !== count) {
    throw new Error('画布没有足够的独立像素用于嵌入取证水印。');
  }
  return pairs;
}

function frameIsValid(frame: Uint8Array): boolean {
  if (frame.length !== FRAME_BYTES) return false;
  for (let index = 0; index < FRAME_MAGIC.length; index += 1) {
    if (frame[index] !== FRAME_MAGIC[index]) return false;
  }
  if (frame[FRAME_MAGIC.length] !== FORENSIC_WATERMARK_VERSION) return false;
  const checksumOffset = FRAME_BYTES - CHECKSUM_BYTES;
  return readUint32(frame, checksumOffset) === crc32(frame.subarray(0, checksumOffset));
}

export async function createForensicWatermarkPayload(
  subject: CardForensicWatermarkSubject,
): Promise<ForensicWatermarkPayload> {
  const fingerprint = await subjectFingerprint(subject);
  return {
    namespace: WATERMARK_NAMESPACE,
    version: FORENSIC_WATERMARK_VERSION,
    ...subject,
    fingerprint: bytesToHex(fingerprint),
  };
}

/**
 * Encodes each frame bit in the parity relationship of dispersed adjacent RGB channels.
 * A sample changes at most one channel by one level; nine independent samples vote per bit.
 */
export async function embedForensicWatermark(
  pixels: ForensicWatermarkPixels,
  subject: CardForensicWatermarkSubject,
): Promise<ForensicWatermarkEmbedding> {
  validatePixels(pixels);
  const fingerprint = await subjectFingerprint(subject);
  const payload: ForensicWatermarkPayload = {
    namespace: WATERMARK_NAMESPACE,
    version: FORENSIC_WATERMARK_VERSION,
    ...subject,
    fingerprint: bytesToHex(fingerprint),
  };
  const bits = bytesToBits(buildFrame(fingerprint));
  const samplePairs = createSamplePairs(
    pixels.width,
    pixels.height,
    fingerprint,
    bits.length * FORENSIC_WATERMARK_REPETITIONS,
  );
  let modifiedChannels = 0;

  for (let bitIndex = 0; bitIndex < bits.length; bitIndex += 1) {
    for (let repeat = 0; repeat < FORENSIC_WATERMARK_REPETITIONS; repeat += 1) {
      const pair = samplePairs[bitIndex * FORENSIC_WATERMARK_REPETITIONS + repeat];
      const parity = (pixels.data[pair.first] ^ pixels.data[pair.second]) & 1;
      if (parity === bits[bitIndex]) continue;
      const current = pixels.data[pair.second];
      pixels.data[pair.second] = current === 255 ? current - 1 : current + 1;
      modifiedChannels += 1;
    }
  }

  return {
    payload,
    samplePairs: samplePairs.length,
    modifiedChannels,
    maxChannelDelta: FORENSIC_WATERMARK_MAX_CHANNEL_DELTA,
  };
}

export async function extractForensicWatermark(
  pixels: ForensicWatermarkPixels,
  subject: CardForensicWatermarkSubject,
): Promise<ExtractedForensicWatermark | null> {
  validatePixels(pixels);
  const fingerprint = await subjectFingerprint(subject);
  const bitCount = FRAME_BYTES * 8;
  const samplePairs = createSamplePairs(
    pixels.width,
    pixels.height,
    fingerprint,
    bitCount * FORENSIC_WATERMARK_REPETITIONS,
  );
  const bits = new Uint8Array(bitCount);

  for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
    let ones = 0;
    for (let repeat = 0; repeat < FORENSIC_WATERMARK_REPETITIONS; repeat += 1) {
      const pair = samplePairs[bitIndex * FORENSIC_WATERMARK_REPETITIONS + repeat];
      ones += (pixels.data[pair.first] ^ pixels.data[pair.second]) & 1;
    }
    bits[bitIndex] = ones > FORENSIC_WATERMARK_REPETITIONS / 2 ? 1 : 0;
  }

  const frame = bitsToBytes(bits);
  if (!frameIsValid(frame)) return null;
  const fingerprintOffset = FRAME_MAGIC.length + 1;
  return {
    version: FORENSIC_WATERMARK_VERSION,
    fingerprint: bytesToHex(frame.subarray(
      fingerprintOffset,
      fingerprintOffset + FINGERPRINT_BYTES,
    )),
  };
}

export async function verifyForensicWatermark(
  pixels: ForensicWatermarkPixels,
  subject: CardForensicWatermarkSubject,
): Promise<ForensicWatermarkVerification> {
  const expected = await createForensicWatermarkPayload(subject);
  const extracted = await extractForensicWatermark(pixels, subject);
  return {
    verified: extracted?.fingerprint === expected.fingerprint,
    expectedFingerprint: expected.fingerprint,
    extractedFingerprint: extracted?.fingerprint ?? null,
  };
}
