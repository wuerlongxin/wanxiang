import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GlobalFonts, Image, createCanvas } from '@napi-rs/canvas';

import {
  COMPLETE_PRINT_PROOF_CARD_COUNT,
  createCompletePrintProofDeck,
} from './complete-print-proof-fixture.ts';
import { verifyRgbProof } from './verify-rgb-proof.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUTPUT_DIRECTORY = resolve(PROJECT_ROOT, 'output/pdf');
const ARTWORK_DIRECTORY = resolve(PROJECT_ROOT, 'public/assets/cards/starter');
const FONT_DIRECTORY = resolve(PROJECT_ROOT, 'public/assets/fonts');

function registerFont(fileName: string, family: string): void {
  const path = resolve(FONT_DIRECTORY, fileName);
  if (!GlobalFonts.registerFromPath(path, family)) {
    throw new Error(`无法注册校样字体：${path}`);
  }
}

function dateStamp(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${value('year')}${value('month')}${value('day')}`;
}

function safePdfName(deckName: string): string {
  return `${deckName.replace(/[\\/:*?"<>|]/g, '-')}--rgb-proof.pdf`;
}

function availableDeckName(baseName: string): string {
  let candidate = baseName;
  let suffix = 2;
  while (existsSync(resolve(OUTPUT_DIRECTORY, safePdfName(candidate)))) {
    candidate = `${baseName}-${String(suffix).padStart(2, '0')}`;
    suffix += 1;
  }
  return candidate;
}

registerFont('source-han-sans-cn-vf.woff2', 'PingFang SC');
registerFont('source-han-sans-cn-vf.woff2', 'Microsoft YaHei');
registerFont('source-han-sans-cn-vf.woff2', 'Noto Sans CJK SC');
registerFont('source-han-serif-cn-vf.woff2', 'STKaiti');
registerFont('source-han-serif-cn-vf.woff2', 'KaiTi');

Object.assign(globalThis, {
  Image,
  document: {
    createElement(tagName: string) {
      if (tagName !== 'canvas') throw new Error(`校样生成器不支持 ${tagName} 元素。`);
      return createCanvas(1, 1);
    },
  },
});

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
const deckName = availableDeckName(`万象万象 · 完整策略套牌 · ${dateStamp()}`);
const deck = createCompletePrintProofDeck(ARTWORK_DIRECTORY, deckName);
const outputPath = resolve(OUTPUT_DIRECTORY, safePdfName(deck.name));

const originalWorkingDirectory = process.cwd();
try {
  process.chdir(OUTPUT_DIRECTORY);
  const { exportDeckPdf } = await import('../src/services/export-pdf.ts');
  await exportDeckPdf(deck);
} finally {
  process.chdir(originalWorkingDirectory);
}

const result = verifyRgbProof(outputPath, COMPLETE_PRINT_PROOF_CARD_COUNT);
console.log(`RGB_PROOF_PATH=${result.path}`);
console.log(`RGB_PROOF_BYTES=${result.bytes}`);
console.log(`RGB_PROOF_PAGES=${result.pages}`);
console.log(`RGB_PROOF_CARD_PAGES=${result.cardPages}`);
console.log(`RGB_PROOF_RULEBOOK_PAGES=${result.rulebookPages}`);
