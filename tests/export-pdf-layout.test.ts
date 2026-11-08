import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PRINT_BLEED_MM,
  PRINT_CARD_HEIGHT_MM,
  PRINT_CARD_WIDTH_MM,
  PRINT_CROP_MARK_STROKE_MM,
  PRINT_PAGE_HEIGHT_MM,
  PRINT_PAGE_WIDTH_MM,
  PRINT_SHEET_CELLS,
  RULE_PAGE_LOGICAL_HEIGHT_PX,
  RULE_PAGE_LOGICAL_WIDTH_PX,
  RULE_PAGE_RASTER_HEIGHT_PX,
  RULE_PAGE_RASTER_WIDTH_PX,
  getCropMarkSegments,
  mirrorPrintCell,
} from '../src/services/print-layout.ts';

const source = readFileSync(
  new URL('../src/services/export-pdf.ts', import.meta.url),
  'utf8',
);

test('uses compact ability terms and elemental numeric badges on printed faces', () => {
  const faceStart = source.indexOf('async function renderPrintCard(');
  const backStart = source.indexOf('async function renderPrintCardBack(');
  const faceRenderer = source.slice(faceStart, backStart);

  assert.ok(faceStart >= 0 && backStart > faceStart);
  assert.match(faceRenderer, /deriveAbilityTerms\(card\.skill, 3\)/u);
  assert.doesNotMatch(faceRenderer, /wrapText\(context, card\.skill/u);
  assert.match(faceRenderer, /drawPrintAttackBadge/u);
  assert.match(faceRenderer, /drawPrintDefenseBadge/u);
  assert.match(faceRenderer, /drawPrintCostBadge/u);
  assert.match(source, /cinnabar-flame/u);
  assert.match(source, /jade-water/u);
  assert.match(source, /gilded-star/u);
});

test('prints shared gameplay identities without replacing the central character artwork', () => {
  const faceStart = source.indexOf('async function renderPrintCard(');
  const backStart = source.indexOf('async function renderPrintCardBack(');
  const faceRenderer = source.slice(faceStart, backStart);
  const gameplayStart = source.indexOf('function drawPrintGameplayMarks(');
  const faceStartAfterGameplay = source.indexOf('async function renderPrintCard(', gameplayStart);
  const gameplayRenderer = source.slice(gameplayStart, faceStartAfterGameplay);

  assert.ok(gameplayStart >= 0 && faceStartAfterGameplay > gameplayStart);
  assert.match(gameplayRenderer, /buildCardGameplayPresentation\(\s*card,\s*deck\.ruleKit\?\.modules \?\? \[\],\s*'full'/u);
  assert.match(gameplayRenderer, /presentation\.rapidSymbols\.slice\(0, 6\)/u);
  assert.match(gameplayRenderer, /const rows = \[0\.32, 0\.39, 0\.46, 0\.53, 0\.6, 0\.67\]/u);
  assert.match(gameplayRenderer, /presentation\.items\.filter\(\(item\) => item\.kind !== 'rapid'\)/u);
  assert.match(gameplayRenderer, /gameplayTagItems\.slice\(0, MAX_GAMEPLAY_MODULE_SEALS\)/u);
  assert.match(gameplayRenderer, /presentation\.overflowCount/u);
  assert.match(source, /item\.primary/u);
  assert.match(source, /item\.secondary \|\| item\.relation \|\| item\.description/u);
  assert.match(source, /item\.moduleGlyph/u);
  assert.match(source, /item\.moduleName/u);
  assert.match(faceRenderer, /drawPrintGameplayMarks\(context, card, deck, x, y\)/u);

  // Gameplay furniture stays in the outer 20% columns; it never redraws or crops the art.
  assert.match(gameplayRenderer, /const leftX = x \+ CARD_WIDTH_PX \* 0\.105/u);
  assert.match(gameplayRenderer, /const tagX = x \+ CARD_WIDTH_PX \* 0\.8/u);
  assert.match(gameplayRenderer, /const tagWidth = CARD_WIDTH_PX \* 0\.145/u);
  assert.doesNotMatch(gameplayRenderer, /rightX/u);
  assert.doesNotMatch(gameplayRenderer, /drawImage\(/u);
});

test('keeps individual abilities off the uniform physical card back', () => {
  const backStart = source.indexOf('async function renderPrintCardBack(');
  const wrapStart = source.indexOf('function wrapText(', backStart);
  const backRenderer = source.slice(backStart, wrapStart);

  assert.ok(backStart >= 0 && wrapStart > backStart);
  assert.doesNotMatch(backRenderer, /card\.skill/u);
  assert.doesNotMatch(backRenderer, /deriveAbilityTerms/u);
});

test('adds the complete card ability glossary to the printed rule book', () => {
  assert.match(source, /buildAbilityGlossaryEntries\(deck\.cards\)/u);
  assert.match(
    source,
    /title: '卡牌能力词条表', items: buildPrintAbilityGlossary\(deck\), ordered: true/u,
  );
});

test('guards the export function with a fresh composition-readiness check', () => {
  const exportStart = source.indexOf('export async function exportDeckPdf(');
  const exportBody = source.slice(exportStart);
  const readinessCheck = exportBody.indexOf('assessDeckPrintReadiness(deck)');
  const pdfCreation = exportBody.indexOf('new jsPDF(');

  assert.ok(exportStart >= 0);
  assert.ok(readinessCheck >= 0 && readinessCheck < pdfCreation);
  assert.match(exportBody, /if \(!printReadiness\.ready\) throw new Error\(printReadiness\.message\)/u);
});

test('preflights artwork before creating any PDF page', () => {
  const exportStart = source.indexOf('export async function exportDeckPdf(');
  const exportBody = source.slice(exportStart);
  const artworkCheck = exportBody.indexOf('await assertPrintArtworkReady(deck.cards, loadImageDimensions)');
  const pdfCreation = exportBody.indexOf('new jsPDF(');

  assert.ok(artworkCheck >= 0 && artworkCheck < pdfCreation);
});

test('renders from an immutable deck snapshot and binds prepared plans to artwork identity', () => {
  const rgbStart = source.indexOf('export async function exportDeckPdf(');
  const rgbBody = source.slice(rgbStart);
  const generatorStart = source.indexOf('export async function* renderDeckPrintPages(');
  const generatorEnd = source.indexOf('function drawCropMarks(', generatorStart);
  const generatorBody = source.slice(generatorStart, generatorEnd);

  assert.match(rgbBody, /deck = createDeckPrintSnapshot\(deck\)/u);
  assert.match(generatorBody, /deck = createDeckPrintSnapshot\(deck\)/u);
  assert.match(generatorBody, /printPlanMatchesDeck\(plan, deck, flavor\)/u);
  assert.match(source, /binding\.artUrl === card\.artUrl/u);
  assert.doesNotMatch(source, /artworkReview|createExportReviewManifest/u);
});

test('uses a centered two-by-three sheet with non-overlapping independent bleed', () => {
  assert.equal(PRINT_SHEET_CELLS.length, 6);
  assert.deepEqual([...new Set(PRINT_SHEET_CELLS.map((cell) => cell.x))], [36, 111]);
  assert.deepEqual([...new Set(PRINT_SHEET_CELLS.map((cell) => cell.y))], [6.6, 104.3, 202]);

  const bounds = PRINT_SHEET_CELLS.map((cell) => ({
    left: cell.x - PRINT_BLEED_MM,
    top: cell.y - PRINT_BLEED_MM,
    right: cell.x + PRINT_CARD_WIDTH_MM + PRINT_BLEED_MM,
    bottom: cell.y + PRINT_CARD_HEIGHT_MM + PRINT_BLEED_MM,
  }));
  for (const bound of bounds) {
    assert.ok(bound.left >= 0 && bound.top >= 0);
    assert.ok(bound.right <= PRINT_PAGE_WIDTH_MM && bound.bottom <= PRINT_PAGE_HEIGHT_MM);
  }
  for (let leftIndex = 0; leftIndex < bounds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < bounds.length; rightIndex += 1) {
      const left = bounds[leftIndex];
      const right = bounds[rightIndex];
      const separated =
        left.right <= right.left ||
        right.right <= left.left ||
        left.bottom <= right.top ||
        right.bottom <= left.top;
      assert.ok(separated, `bleed overlap between cells ${leftIndex} and ${rightIndex}`);
    }
  }

  for (const cell of PRINT_SHEET_CELLS) {
    const mirrored = mirrorPrintCell(cell);
    assert.ok(PRINT_SHEET_CELLS.some((candidate) =>
      candidate.x === mirrored.x && candidate.y === mirrored.y));
    assert.deepEqual(mirrorPrintCell(mirrored), cell);
  }
});

test('keeps crop-mark strokes outside every bleed area and away from one another', () => {
  const strokePadding = PRINT_CROP_MARK_STROKE_MM / 2;
  const bleedBounds = PRINT_SHEET_CELLS.map((cell) => ({
    left: cell.x - PRINT_BLEED_MM,
    top: cell.y - PRINT_BLEED_MM,
    right: cell.x + PRINT_CARD_WIDTH_MM + PRINT_BLEED_MM,
    bottom: cell.y + PRINT_CARD_HEIGHT_MM + PRINT_BLEED_MM,
  }));
  const markBounds = PRINT_SHEET_CELLS.flatMap((cell) =>
    getCropMarkSegments(cell.x, cell.y).map((segment) => ({
      left: Math.min(segment.x1, segment.x2) - strokePadding,
      top: Math.min(segment.y1, segment.y2) - strokePadding,
      right: Math.max(segment.x1, segment.x2) + strokePadding,
      bottom: Math.max(segment.y1, segment.y2) + strokePadding,
    })),
  );
  const overlaps = (
    left: { left: number; top: number; right: number; bottom: number },
    right: { left: number; top: number; right: number; bottom: number },
  ): boolean => !(
    left.right < right.left ||
    right.right < left.left ||
    left.bottom < right.top ||
    right.bottom < left.top
  );

  for (const mark of markBounds) {
    assert.ok(mark.left >= 0 && mark.top >= 0);
    assert.ok(mark.right <= PRINT_PAGE_WIDTH_MM && mark.bottom <= PRINT_PAGE_HEIGHT_MM);
    assert.ok(bleedBounds.every((bleed) => !overlaps(mark, bleed)));
  }
  for (let leftIndex = 0; leftIndex < markBounds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < markBounds.length; rightIndex += 1) {
      assert.equal(overlaps(markBounds[leftIndex], markBounds[rightIndex]), false);
    }
  }
});

test('labels the generated file as an RGB proof with print identity', () => {
  const rgbStart = source.indexOf('export async function exportDeckPdf(');
  const explicitAliasStart = source.indexOf('export async function exportDeckRgbProofPdf(', rgbStart);
  const rgbExporter = source.slice(rgbStart, explicitAliasStart);

  assert.match(source, /RGB PRINT PROOF \/ PRINT-SHOP CMYK CONVERSION REQUIRED/u);
  assert.match(source, /RGB PROOF \/ \$\{side\} \/ 300 PPI/u);
  assert.match(rgbExporter, /identity\.metadataLabel/u);
  assert.match(source, /identity\.watermarkLabel/u);
  assert.match(rgbExporter, /--rgb-proof\.pdf/u);
  assert.doesNotMatch(rgbExporter, /PDF\/X-4/u);
  assert.match(source, /export async function exportDeckRgbProofPdf/u);
});

test('renders A4 rule-book pages at 300 DPI while retaining logical coordinates', () => {
  assert.deepEqual(
    [RULE_PAGE_LOGICAL_WIDTH_PX, RULE_PAGE_LOGICAL_HEIGHT_PX],
    [1400, 1980],
  );
  assert.deepEqual(
    [RULE_PAGE_RASTER_WIDTH_PX, RULE_PAGE_RASTER_HEIGHT_PX],
    [2480, 3508],
  );

  const pageStart = source.indexOf('function createRulePage(');
  const fittedFontStart = source.indexOf('function setFittedFont(', pageStart);
  const pageRenderer = source.slice(pageStart, fittedFontStart);
  assert.match(pageRenderer, /canvas\.width = RULE_PAGE_RASTER_WIDTH_PX/u);
  assert.match(pageRenderer, /canvas\.height = RULE_PAGE_RASTER_HEIGHT_PX/u);
  assert.match(
    pageRenderer,
    /context\.scale\(\s*RULE_PAGE_RASTER_WIDTH_PX \/ RULE_PAGE_WIDTH_PX,\s*RULE_PAGE_RASTER_HEIGHT_PX \/ RULE_PAGE_HEIGHT_PX,/u,
  );
});
