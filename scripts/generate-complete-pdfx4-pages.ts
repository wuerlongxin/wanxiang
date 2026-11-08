import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GlobalFonts, Image, createCanvas } from '@napi-rs/canvas';

import { createCompletePrintProofDeck } from './complete-print-proof-fixture.ts';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUTPUT_DIRECTORY = resolve(PROJECT_ROOT, 'output/pdf');
const ARTWORK_DIRECTORY = resolve(PROJECT_ROOT, 'public/assets/cards/starter');
const FONT_DIRECTORY = resolve(PROJECT_ROOT, 'public/assets/fonts');
const PAGES_PARENT_DIRECTORY = resolve(PROJECT_ROOT, 'tmp/pdfs');
const PAGES_DIRECTORY = resolve(PAGES_PARENT_DIRECTORY, 'pdfx4-complete-pages');
const EXPECTED_PAGE_COUNT = 27;

interface PngBufferCanvas {
  toBuffer(mimeType: 'image/png'): Buffer;
}

function registerFont(fileName: string, family: string): void {
  const path = resolve(FONT_DIRECTORY, fileName);
  if (!GlobalFonts.registerFromPath(path, family)) {
    throw new Error(`无法注册 PDF/X-4 页面字体：${path}`);
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
  const safeName = deckName.replace(/[\\/:*?"<>|]/g, '-').trim() || 'wanxiang-deck';
  return `${safeName}--pdfx4-cmyk.pdf`;
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

function cleanGeneratedPages(): void {
  if (
    dirname(PAGES_DIRECTORY) !== PAGES_PARENT_DIRECTORY ||
    basename(PAGES_DIRECTORY) !== 'pdfx4-complete-pages'
  ) {
    throw new Error('拒绝清理未受控的 PDF/X-4 页面目录。');
  }
  rmSync(PAGES_DIRECTORY, { recursive: true, force: true });
}

try {
  registerFont('source-han-sans-cn-vf.woff2', 'PingFang SC');
  registerFont('source-han-sans-cn-vf.woff2', 'Microsoft YaHei');
  registerFont('source-han-sans-cn-vf.woff2', 'Noto Sans CJK SC');
  registerFont('source-han-serif-cn-vf.woff2', 'STKaiti');
  registerFont('source-han-serif-cn-vf.woff2', 'KaiTi');

  Object.assign(globalThis, {
    Image,
    document: {
      createElement(tagName: string) {
        if (tagName !== 'canvas') throw new Error(`PDF/X-4 页面生成器不支持 ${tagName} 元素。`);
        return createCanvas(1, 1);
      },
    },
  });

  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  mkdirSync(PAGES_PARENT_DIRECTORY, { recursive: true });
  cleanGeneratedPages();
  mkdirSync(PAGES_DIRECTORY, { recursive: true });

  const deckName = availableDeckName(`万象万象 · 完整策略套牌 · ${dateStamp()}`);
  const deck = createCompletePrintProofDeck(ARTWORK_DIRECTORY, deckName);
  if (deck.ruleKit) {
    deck.ruleKit.customNotes = [
      ...deck.ruleKit.customNotes.slice(0, 2),
      '此文件按 FOGRA39L 印刷条件转换为 CMYK，并封装为 PDF/X-4 印厂文件；正式生产前仍需由印厂结合纸张完成实物打样。',
    ];
  }
  if (deck.creatorPlaque) {
    deck.creatorPlaque.edition = '完整套牌 PDF/X-4 印厂版第一版';
  }

  const {
    assertDeckPrintExportReady,
    prepareDeckPrintPages,
    renderDeckPrintPages,
  } = await import('../src/services/export-pdf.ts');
  await assertDeckPrintExportReady(deck);
  const plan = prepareDeckPrintPages(deck, 'pdfx4');
  if (plan.pageCount !== EXPECTED_PAGE_COUNT) {
    throw new Error(
      `完整 PDF/X-4 校样应生成 ${EXPECTED_PAGE_COUNT} 页，实际规划为 ${plan.pageCount} 页。`,
    );
  }

  let completedPages = 0;
  for await (const page of renderDeckPrintPages(deck, 'pdfx4', plan)) {
    try {
      if (
        page.pageIndex !== completedPages ||
        page.canvas.width !== 2480 ||
        page.canvas.height !== 3508
      ) {
        throw new Error(`第 ${page.pageIndex + 1} 页的页序或 A4 像素尺寸无效。`);
      }
      const fileName = `${String(page.pageIndex).padStart(4, '0')}-${page.role}.png`;
      const outputPath = resolve(PAGES_DIRECTORY, fileName);
      const png = (page.canvas as unknown as PngBufferCanvas).toBuffer('image/png');
      writeFileSync(outputPath, png, { flag: 'wx' });
      completedPages += 1;
    } finally {
      page.canvas.width = 1;
      page.canvas.height = 1;
    }
  }

  if (completedPages !== plan.pageCount) {
    throw new Error(`PDF/X-4 页面输出不完整：${completedPages}/${plan.pageCount}。`);
  }

  const outputPath = resolve(OUTPUT_DIRECTORY, safePdfName(deck.name));
  const title = `${deck.name} - 万象卡域 PDF/X-4 印厂文件`;
  console.log(`PAGES_DIR=${PAGES_DIRECTORY}`);
  console.log(`OUTPUT_PATH=${outputPath}`);
  console.log(`TITLE=${title}`);
  console.log(`AUTHOR=${deck.author}`);
  console.log(`PAGE_COUNT=${completedPages}`);
} catch (error) {
  try {
    cleanGeneratedPages();
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      'PDF/X-4 页面生成失败，且固定临时目录无法清理。',
    );
  }
  throw error;
}
