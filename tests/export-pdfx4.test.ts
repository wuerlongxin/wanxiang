import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PdfX4ExportError,
  exportDeckPdfX4,
  parsePdfX4Error,
} from '../src/services/export-pdfx4.ts';

const rendererSource = readFileSync(
  new URL('../src/services/export-pdf.ts', import.meta.url),
  'utf8',
);
const exporterSource = readFileSync(
  new URL('../src/services/export-pdfx4.ts', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../src/app.ts', import.meta.url),
  'utf8',
);

test('normalizes structured Tauri PDF/X-4 failures without losing their code', () => {
  const direct = parsePdfX4Error({
    code: 'PDFX4_PROFILE_MISSING',
    message: '印刷色彩配置缺失。',
  });
  assert.ok(direct instanceof PdfX4ExportError);
  assert.equal(direct.code, 'PDFX4_PROFILE_MISSING');
  assert.equal(direct.message, '印刷色彩配置缺失。');

  const nested = parsePdfX4Error(JSON.stringify({
    error: {
      code: 'PDFX4_CONFORMANCE_FAILED',
      message: '文件未通过内部检查。',
    },
  }));
  assert.equal(nested.code, 'PDFX4_CONFORMANCE_FAILED');
  assert.equal(nested.message, '文件未通过内部检查。');
});

test('rejects browser PDF/X-4 export explicitly before rendering the deck', async () => {
  await assert.rejects(
    exportDeckPdfX4({} as never),
    (error: unknown) => error instanceof PdfX4ExportError &&
      error.code === 'PDFX4_DESKTOP_REQUIRED' &&
      /桌面版/u.test(error.message),
  );
});

test('streams numbered A4 PNG pages through the four desktop commands', () => {
  assert.match(exporterSource, /begin_pdfx4_export/u);
  assert.match(exporterSource, /append_pdfx4_page/u);
  assert.match(exporterSource, /finish_pdfx4_export/u);
  assert.match(exporterSource, /cancel_pdfx4_export/u);
  assert.match(exporterSource, /suggestedName:[\s\S]*expectedPages: totalPages/u);
  assert.doesNotMatch(exporterSource, /reviewManifest|createExportReviewManifest/u);
  assert.match(exporterSource, /pageIndex: page\.pageIndex/u);
  assert.match(exporterSource, /role: page\.role/u);
  assert.match(exporterSource, /pngBase64/u);
  assert.match(exporterSource, /begin\.pageWidth !== 2480/u);
  assert.match(exporterSource, /begin\.pageHeight !== 3508/u);
  assert.match(exporterSource, /page\.canvas\.width = 1/u);
  assert.match(exporterSource, /throw parsePdfX4Error\(error\)/u);
});

test('builds six-up press pages with independent bleed, mirrored backs, crop marks and roles', () => {
  const generatorStart = rendererSource.indexOf('export async function* renderDeckPrintPages(');
  const rgbStart = rendererSource.indexOf('function drawCropMarks(', generatorStart);
  const generator = rendererSource.slice(generatorStart, rgbStart);
  const sheetStart = rendererSource.indexOf('async function renderCardSheetPage(');
  const countStart = rendererSource.indexOf('export function countDeckPrintPages(', sheetStart);
  const sheetRenderer = rendererSource.slice(sheetStart, countStart);

  assert.match(rendererSource, /canvas\.width = RULE_PAGE_RASTER_WIDTH_PX/u);
  assert.match(rendererSource, /canvas\.height = RULE_PAGE_RASTER_HEIGHT_PX/u);
  assert.match(sheetRenderer, /PRINT_SHEET_CELLS\[index\]/u);
  assert.match(sheetRenderer, /mirrorPrintCell\(faceCell\)/u);
  assert.match(sheetRenderer, /PRINT_BLEED_MM \* 2/u);
  assert.match(sheetRenderer, /drawCanvasCropMarks\(context, cell\.x, cell\.y\)/u);
  assert.match(generator, /role: 'cardFront'/u);
  assert.match(generator, /role: 'cardBack'/u);
  assert.match(generator, /role: rulePage\.role/u);
});

test('parameterizes rule-book wording so PDF/X-4 pages contain no RGB conversion claim', () => {
  assert.match(rendererSource, /flavor: PrintExportFlavor/u);
  assert.match(rendererSource, /flavor === 'pdfx4'/u);
  assert.match(rendererSource, /PDF\/X-4 PRESS MASTER \/ CMYK \/ 300 PPI/u);
  assert.match(rendererSource, /RGB PRINT PROOF \/ PRINT-SHOP CMYK CONVERSION REQUIRED/u);
  assert.match(rendererSource, /renderDeckRuleBookPageSequence\(deck, flavor, plan\)/u);
});

test('counts from a lightweight layout plan and retains only one press page at a time', () => {
  const countStart = rendererSource.indexOf('export function countDeckPrintPages(');
  const generatorStart = rendererSource.indexOf('export async function* renderDeckPrintPages(', countStart);
  const countBody = rendererSource.slice(countStart, generatorStart);
  const generatorEnd = rendererSource.indexOf('function drawCropMarks(', generatorStart);
  const generatorBody = rendererSource.slice(generatorStart, generatorEnd);

  assert.match(countBody, /prepareDeckPrintPages\(deck, flavor\)\.pageCount/u);
  assert.doesNotMatch(countBody, /renderDeckRuleBookPages/u);
  assert.match(rendererSource, /measurementCanvas\.width = 1/u);
  assert.match(generatorBody, /renderDeckRuleBookPageSequence\(deck, flavor, plan\)/u);
  assert.doesNotMatch(generatorBody, /const rulePages = renderDeckRuleBookPages/u);
  assert.match(exporterSource, /renderDeckPrintPages\(deck, 'pdfx4', printPlan\)/u);
});

test('uses PDF/X-4 as the product print-export default and surfaces page progress', () => {
  const exportStart = appSource.indexOf('private async exportDeck(');
  const statusStart = appSource.indexOf('private showStatus(', exportStart);
  const productExporter = appSource.slice(exportStart, statusStart);

  assert.match(productExporter, /import\('\.\/services\/export-pdfx4'\)/u);
  assert.match(productExporter, /exportDeckPdfX4\(deck, \(progress\)/u);
  assert.match(productExporter, /progress\.message/u);
  assert.doesNotMatch(productExporter, /exportDeckPdf\(/u);
  assert.match(productExporter, /PDF\/X-4 印厂文件已保存/u);
});

test('captures an immutable deck snapshot before PDF/X-4 preflight or callbacks', () => {
  const exportStart = exporterSource.indexOf('export async function exportDeckPdfX4(');
  const exportBody = exporterSource.slice(exportStart);
  const snapshot = exportBody.indexOf('deck = createDeckPrintSnapshot(deck)');
  const preflight = exportBody.indexOf('await assertDeckPrintExportReady(deck)');
  const destinationProgress = exportBody.indexOf("phase: 'selectingDestination'");

  assert.ok(snapshot >= 0 && snapshot < preflight);
  assert.ok(snapshot < destinationProgress);
});
