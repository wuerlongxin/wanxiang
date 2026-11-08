import { jsPDF } from 'jspdf';
import { buildAbilityGlossaryEntries, deriveAbilityTerms } from '../card-ability-terms.ts';
import { CARD_FACE_LAYOUT } from '../card-art-layout.ts';
import {
  buildCardGameplayPresentation,
  MAX_GAMEPLAY_MODULE_SEALS,
  type GameplayPresentationItem,
  type RapidSymbolPresentation,
} from '../card-gameplay-presentation.ts';
import { MODE_BY_ID } from '../data.ts';
import { assessDeckPrintReadiness } from '../deck-composition.ts';
import { generateRuleBook } from '../rules.ts';
import {
  FAN_STUDY_CONFIRMATION_LABELS,
  FAN_STUDY_DISCLAIMER,
  FAN_STUDY_TERMS_VERSION,
  assertDeckExportAllowed,
  getExportMark,
} from './content-policy.ts';
import {
  createCardForensicWatermarkSubject,
  embedForensicWatermark,
  type ForensicWatermarkSide,
} from './forensic-watermark.ts';
import type { CardData, DeckData, RuleBook } from '../types';
import {
  PRINT_CARD_TRIM_HEIGHT_PX,
  PRINT_CARD_TRIM_WIDTH_PX,
  assertPrintArtworkReady,
  resolveRuntimeArtworkUrl,
} from './print-artwork-preflight.ts';
import { getPrintDeckIdentity } from './print-identity.ts';
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
} from './print-layout.ts';

const CARD_WIDTH_PX = PRINT_CARD_TRIM_WIDTH_PX;
const CARD_HEIGHT_PX = PRINT_CARD_TRIM_HEIGHT_PX;
const BLEED_PX = 36;
const RULE_PAGE_WIDTH_PX = RULE_PAGE_LOGICAL_WIDTH_PX;
const RULE_PAGE_HEIGHT_PX = RULE_PAGE_LOGICAL_HEIGHT_PX;
const RULE_PAGE_MARGIN_PX = 92;
const RULE_PAGE_BOTTOM_PX = RULE_PAGE_HEIGHT_PX - 112;
const RULE_FONT = 'PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif';

export type PrintExportFlavor = 'rgb-proof' | 'pdfx4';
export type DeckPrintPageRole = 'cardFront' | 'cardBack' | 'rulebook' | 'rightsNotice';

export interface DeckPrintPage {
  canvas: HTMLCanvasElement;
  pageIndex: number;
  role: DeckPrintPageRole;
}

export const PRINT_VALUE_BADGE_STYLES = {
  attack: { element: 'cinnabar-flame', label: '攻', color: '#b9342b', highlight: '#ff6458' },
  defense: { element: 'jade-water', label: '御', color: '#16866f', highlight: '#4fddb2' },
  cost: { element: 'gilded-star', label: '费', color: '#ffc857', highlight: '#fff4df' },
} as const;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seedValue: number): () => number {
  let seed = seedValue || 1;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = resolveRuntimeArtworkUrl(url);
  });
}

async function loadImageDimensions(
  url: string,
): Promise<{ width: number; height: number } | null> {
  const image = await loadImage(url);
  return image
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : null;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawFanStudyCardMark(
  context: CanvasRenderingContext2D,
  deck: DeckData,
  x: number,
  y: number,
  width: number,
): void {
  const mark = getExportMark(deck);
  if (!mark) return;
  context.save();
  context.fillStyle = 'rgba(48, 18, 16, .88)';
  context.strokeStyle = 'rgba(241, 200, 106, .92)';
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(x, y, width, 34, 5);
  context.fill();
  context.stroke();
  context.fillStyle = '#f1c86a';
  context.font = '700 18px PingFang SC, Microsoft YaHei, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(mark, x + width / 2, y + 17, width - 18);
  context.restore();
}

function drawPrintOwnershipMark(
  context: CanvasRenderingContext2D,
  deck: DeckData,
): void {
  const identity = getPrintDeckIdentity(deck);
  context.save();
  context.globalAlpha = 0.035;
  context.fillStyle = '#ffffff';
  context.font = '600 14px monospace';
  context.rotate(-0.36);
  for (let row = -4; row < 18; row += 1) {
    for (let col = -4; col < 14; col += 1) {
      context.fillText(identity.watermarkLabel, col * 190, row * 90);
    }
  }
  context.restore();
}

async function embedPrintForensicWatermark(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  deck: DeckData,
  card: CardData,
  side: ForensicWatermarkSide,
): Promise<void> {
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  await embedForensicWatermark(
    pixels,
    createCardForensicWatermarkSubject(deck, card, side),
  );
  context.putImageData(pixels, 0, 0);
}

function drawPrintBadgeNumber(
  context: CanvasRenderingContext2D,
  value: number,
  centerX: number,
  centerY: number,
  radius: number,
  label: string,
  stroke: string,
): void {
  const text = String(value);
  let size = radius * 1.03;
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  do {
    context.font = `800 ${size}px Georgia, Times New Roman, serif`;
    if (context.measureText(text).width <= radius * 1.38) break;
    size -= 2;
  } while (size > radius * 0.55);
  context.lineJoin = 'round';
  context.lineWidth = Math.max(3, radius * 0.105);
  context.strokeStyle = stroke;
  context.fillStyle = '#fff4df';
  context.strokeText(text, centerX, centerY - radius * 0.1);
  context.fillText(text, centerX, centerY - radius * 0.1);
  context.font = `700 ${Math.max(12, radius * 0.36)}px ${RULE_FONT}`;
  context.fillStyle = '#fff4df';
  context.fillText(label, centerX, centerY + radius * 0.61);
  context.restore();
}

function drawPrintAttackBadge(
  context: CanvasRenderingContext2D,
  value: number,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  const style = PRINT_VALUE_BADGE_STYLES.attack;
  context.save();
  context.beginPath();
  context.moveTo(centerX - radius * 0.86, centerY + radius * 0.42);
  context.bezierCurveTo(
    centerX - radius * 1.18,
    centerY - radius * 0.18,
    centerX - radius * 0.42,
    centerY - radius * 0.86,
    centerX - radius * 0.2,
    centerY - radius * 1.46,
  );
  context.bezierCurveTo(
    centerX + radius * 0.12,
    centerY - radius * 0.92,
    centerX + radius * 0.34,
    centerY - radius * 0.42,
    centerX + radius * 0.16,
    centerY + radius * 0.48,
  );
  context.closePath();
  context.fillStyle = style.color;
  context.globalAlpha = 0.9;
  context.fill();

  context.beginPath();
  context.moveTo(centerX + radius * 0.08, centerY + radius * 0.46);
  context.bezierCurveTo(
    centerX + radius * 0.5,
    centerY - radius * 0.3,
    centerX + radius * 0.84,
    centerY - radius * 0.55,
    centerX + radius * 0.7,
    centerY - radius * 1.08,
  );
  context.bezierCurveTo(
    centerX + radius * 1.2,
    centerY - radius * 0.5,
    centerX + radius * 1.14,
    centerY + radius * 0.32,
    centerX + radius * 0.62,
    centerY + radius * 0.68,
  );
  context.closePath();
  context.fillStyle = style.highlight;
  context.globalAlpha = 0.62;
  context.fill();

  context.globalAlpha = 1;
  context.beginPath();
  context.arc(centerX, centerY, radius * 1.1, 0, Math.PI * 2);
  context.fillStyle = 'rgba(0,0,0,.52)';
  context.fill();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fillStyle = '#541813';
  context.fill();
  context.strokeStyle = '#ff9a74';
  context.lineWidth = 5;
  context.stroke();
  drawPrintBadgeNumber(context, value, centerX, centerY, radius, style.label, '#2b0807');
  context.restore();
}

function drawPrintDefenseBadge(
  context: CanvasRenderingContext2D,
  value: number,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  const style = PRINT_VALUE_BADGE_STYLES.defense;
  context.save();
  context.strokeStyle = '#62d9e8';
  context.lineWidth = 4;
  context.globalAlpha = 0.62;
  context.beginPath();
  context.ellipse(centerX, centerY + radius * 0.62, radius * 1.42, radius * 0.42, 0, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = style.highlight;
  context.lineWidth = 3;
  context.beginPath();
  context.ellipse(centerX, centerY + radius * 0.82, radius * 1.14, radius * 0.28, 0, 0, Math.PI * 2);
  context.stroke();

  context.globalAlpha = 1;
  context.beginPath();
  context.arc(centerX, centerY, radius * 1.1, 0, Math.PI * 2);
  context.fillStyle = 'rgba(0,0,0,.52)';
  context.fill();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fillStyle = '#0f5147';
  context.fill();
  context.strokeStyle = '#7ce7c8';
  context.lineWidth = 5;
  context.stroke();
  context.beginPath();
  context.moveTo(centerX - radius * 0.66, centerY + radius * 0.3);
  context.quadraticCurveTo(centerX - radius * 0.32, centerY, centerX, centerY + radius * 0.3);
  context.quadraticCurveTo(centerX + radius * 0.32, centerY + radius * 0.6, centerX + radius * 0.66, centerY + radius * 0.3);
  context.strokeStyle = '#b7f6ec';
  context.lineWidth = 3;
  context.globalAlpha = 0.7;
  context.stroke();
  context.globalAlpha = 1;
  drawPrintBadgeNumber(context, value, centerX, centerY, radius, style.label, '#062c26');
  context.restore();
}

function drawPrintCostBadge(
  context: CanvasRenderingContext2D,
  value: number,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  const style = PRINT_VALUE_BADGE_STYLES.cost;
  context.save();
  context.beginPath();
  for (let index = 0; index < 16; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 8;
    const pointRadius = index % 2 === 0 ? radius * 1.48 : radius * 1.02;
    const pointX = centerX + Math.cos(angle) * pointRadius;
    const pointY = centerY + Math.sin(angle) * pointRadius;
    if (index === 0) context.moveTo(pointX, pointY);
    else context.lineTo(pointX, pointY);
  }
  context.closePath();
  context.fillStyle = style.color;
  context.globalAlpha = 0.56;
  context.fill();
  context.strokeStyle = style.highlight;
  context.lineWidth = 3;
  context.stroke();

  context.globalAlpha = 1;
  context.beginPath();
  context.arc(centerX, centerY, radius * 1.12, 0, Math.PI * 2);
  context.fillStyle = 'rgba(0,0,0,.5)';
  context.fill();
  const gold = context.createRadialGradient(
    centerX - radius * 0.28,
    centerY - radius * 0.32,
    radius * 0.08,
    centerX,
    centerY,
    radius,
  );
  gold.addColorStop(0, '#fff4c4');
  gold.addColorStop(0.34, '#ffc857');
  gold.addColorStop(1, '#9f6621');
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fillStyle = gold;
  context.fill();
  context.strokeStyle = '#fff4df';
  context.lineWidth = 5;
  context.stroke();
  drawPrintBadgeNumber(context, value, centerX, centerY, radius, style.label, '#59330d');
  context.restore();
}

function gameplayTextLines(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const glyphs = Array.from(value.trim());
  if (!glyphs.length || maxLines <= 0) return [];
  const lines: string[] = [];
  let cursor = 0;
  while (cursor < glyphs.length && lines.length < maxLines) {
    let line = '';
    while (cursor < glyphs.length) {
      const candidate = `${line}${glyphs[cursor]}`;
      if (line && context.measureText(candidate).width > maxWidth) break;
      line = candidate;
      cursor += 1;
    }
    if (!line) {
      line = glyphs[cursor] ?? '';
      cursor += 1;
    }
    lines.push(line);
  }
  if (cursor < glyphs.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && context.measureText(`${last}…`).width > maxWidth) {
      last = Array.from(last).slice(0, -1).join('');
    }
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

function drawPrintRapidSymbol(
  context: CanvasRenderingContext2D,
  symbol: RapidSymbolPresentation,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  context.save();
  const ink = context.createRadialGradient(
    centerX - radius * 0.25,
    centerY - radius * 0.28,
    radius * 0.08,
    centerX,
    centerY,
    radius,
  );
  ink.addColorStop(0, 'rgba(68, 34, 25, .98)');
  ink.addColorStop(0.58, 'rgba(20, 14, 13, .96)');
  ink.addColorStop(1, 'rgba(7, 9, 9, .98)');
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fillStyle = ink;
  context.fill();
  context.strokeStyle = '#f1c86a';
  context.lineWidth = 3;
  context.stroke();
  context.beginPath();
  context.arc(centerX, centerY, radius - 6, 0, Math.PI * 2);
  context.strokeStyle = symbol.accentHex;
  context.lineWidth = 2;
  context.globalAlpha = 0.92;
  context.stroke();

  context.globalAlpha = 1;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.font = `800 ${Math.round(radius * 0.92)}px ${RULE_FONT}`;
  context.strokeStyle = 'rgba(3, 4, 4, .88)';
  context.lineWidth = 4;
  context.fillStyle = '#fff4df';
  context.strokeText(symbol.glyph, centerX, centerY - radius * 0.13);
  context.fillText(symbol.glyph, centerX, centerY - radius * 0.13);
  context.font = `700 ${Math.max(10, Math.round(radius * 0.31))}px ${RULE_FONT}`;
  context.fillStyle = symbol.accentHex;
  context.fillText(symbol.label, centerX, centerY + radius * 0.62, radius * 1.62);
  context.restore();
}

function drawPrintRapidLegend(
  context: CanvasRenderingContext2D,
  item: GameplayPresentationItem,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.save();
  const ink = context.createLinearGradient(x, y, x + width, y + height);
  ink.addColorStop(0, 'rgba(9, 12, 12, .97)');
  ink.addColorStop(1, 'rgba(53, 22, 17, .92)');
  context.fillStyle = ink;
  context.strokeStyle = '#f1c86a';
  context.lineWidth = 2.5;
  roundedRect(context, x, y, width, height, 8);
  context.fill();
  context.stroke();
  context.fillStyle = item.accentHex;
  context.fillRect(x + 7, y + 7, 4, height - 14);
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillStyle = '#fff4df';
  setFittedFont(context, item.primary, '800', 18, 13, width - 28);
  context.fillText(item.primary, x + 19, y + height * 0.34, width - 28);
  context.fillStyle = item.accentHex;
  setFittedFont(context, item.secondary, '600', 13, 10, width - 28);
  context.fillText(item.secondary, x + 19, y + height * 0.72, width - 28);
  context.restore();
}

function drawPrintGameplayTag(
  context: CanvasRenderingContext2D,
  item: GameplayPresentationItem,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.save();
  const lacquer = context.createLinearGradient(x, y, x + width, y + height);
  lacquer.addColorStop(0, 'rgba(12, 13, 13, .97)');
  lacquer.addColorStop(0.52, 'rgba(49, 22, 18, .96)');
  lacquer.addColorStop(1, 'rgba(11, 10, 10, .98)');
  context.fillStyle = lacquer;
  context.strokeStyle = '#f1c86a';
  context.lineWidth = 2.5;
  roundedRect(context, x, y, width, height, 9);
  context.fill();
  context.stroke();
  context.strokeStyle = item.accentHex;
  context.lineWidth = 2;
  roundedRect(context, x + 6, y + 6, width - 12, height - 12, 6);
  context.stroke();

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = item.accentHex;
  const moduleLabel = `${item.moduleGlyph} · ${item.moduleName}`;
  setFittedFont(context, moduleLabel, '700', 13, 10, width - 18);
  context.fillText(moduleLabel, x + width / 2, y + 16, width - 18);

  const sealY = y + 43;
  const sealRadius = 18;
  context.beginPath();
  context.arc(x + width / 2, sealY, sealRadius, 0, Math.PI * 2);
  context.fillStyle = 'rgba(7, 8, 8, .94)';
  context.fill();
  context.strokeStyle = '#f1c86a';
  context.lineWidth = 2;
  context.stroke();
  context.font = `800 20px ${RULE_FONT}`;
  context.fillStyle = '#fff4df';
  context.fillText(item.mark, x + width / 2, sealY + 1, sealRadius * 1.45);

  context.fillStyle = '#fff4df';
  setFittedFont(context, item.primary, '800', 17, 12, width - 16);
  context.fillText(item.primary, x + width / 2, y + 71, width - 16);
  context.fillStyle = 'rgba(241, 200, 106, .74)';
  context.fillRect(x + 13, y + 83, width - 26, 1.5);

  context.font = `600 13px ${RULE_FONT}`;
  context.fillStyle = item.accentHex;
  const detail = item.secondary || item.relation || item.description;
  const secondaryLines = gameplayTextLines(context, detail, width - 18, 2);
  secondaryLines.forEach((line, index) => {
    context.fillText(line, x + width / 2, y + 96 + index * 15, width - 18);
  });
  context.restore();
}

function drawPrintGameplayOverflow(
  context: CanvasRenderingContext2D,
  count: number,
  x: number,
  y: number,
  width: number,
): void {
  if (count <= 0) return;
  context.save();
  context.fillStyle = 'rgba(32, 16, 14, .96)';
  context.strokeStyle = '#f1c86a';
  context.lineWidth = 2;
  roundedRect(context, x, y, width, 32, 7);
  context.fill();
  context.stroke();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `800 15px ${RULE_FONT}`;
  context.fillStyle = '#fff4df';
  context.fillText(`+${count} 层玩法`, x + width / 2, y + 16, width - 12);
  context.restore();
}

function drawPrintGameplayMarks(
  context: CanvasRenderingContext2D,
  card: CardData,
  deck: DeckData,
  x: number,
  y: number,
): void {
  const presentation = buildCardGameplayPresentation(
    card,
    deck.ruleKit?.modules ?? [],
    'full',
  );
  if (!presentation.items.length) return;

  const hasRapidSymbols = presentation.rapidSymbols.length > 0;
  if (hasRapidSymbols) {
    const rapidItem = presentation.items.find((item) => item.kind === 'rapid');
    if (rapidItem) {
      drawPrintRapidLegend(
        context,
        rapidItem,
        x + CARD_WIDTH_PX * 0.055,
        y + CARD_HEIGHT_PX * 0.225,
        CARD_WIDTH_PX * 0.14,
        58,
      );
    }
    const radius = CARD_WIDTH_PX * 0.033;
    const leftX = x + CARD_WIDTH_PX * 0.105;
    const rows = [0.32, 0.39, 0.46, 0.53, 0.6, 0.67];
    presentation.rapidSymbols.slice(0, 6).forEach((symbol, index) => {
      drawPrintRapidSymbol(
        context,
        symbol,
        leftX,
        y + CARD_HEIGHT_PX * rows[index],
        radius,
      );
    });
  }

  const gameplayTagItems = presentation.items.filter((item) => item.kind !== 'rapid');
  const tagItems = gameplayTagItems.slice(0, MAX_GAMEPLAY_MODULE_SEALS);
  if (!tagItems.length) return;
  const tagX = x + CARD_WIDTH_PX * 0.8;
  const tagWidth = CARD_WIDTH_PX * 0.145;
  const tagStartY = y + CARD_HEIGHT_PX * 0.225;
  const tagHeight = tagItems.length <= 2 ? 118 : 110;
  const tagGap = 8;
  tagItems.forEach((item, index) => {
    drawPrintGameplayTag(
      context,
      item,
      tagX,
      tagStartY + index * (tagHeight + tagGap),
      tagWidth,
      tagHeight,
    );
  });
  const hiddenItems = Math.max(0, gameplayTagItems.length - tagItems.length);
  const overflowCount = Math.max(presentation.overflowCount, hiddenItems);
  drawPrintGameplayOverflow(
    context,
    overflowCount,
    tagX,
    tagStartY + tagItems.length * (tagHeight + tagGap),
    tagWidth,
  );
}

async function renderPrintCard(card: CardData, deck: DeckData): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH_PX + BLEED_PX * 2;
  canvas.height = CARD_HEIGHT_PX + BLEED_PX * 2;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');

  const mode = MODE_BY_ID[card.modeId];
  const fullWidth = canvas.width;
  const fullHeight = canvas.height;
  const x = BLEED_PX;
  const y = BLEED_PX;
  const gradient = context.createLinearGradient(0, 0, fullWidth, fullHeight);
  gradient.addColorStop(0, '#090d0e');
  gradient.addColorStop(0.55, `#${mode.deep.toString(16).padStart(6, '0')}`);
  gradient.addColorStop(1, '#07090a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, fullWidth, fullHeight);

  context.save();
  roundedRect(context, x, y, CARD_WIDTH_PX, CARD_HEIGHT_PX, 34);
  context.clip();

  const image = await loadImage(card.artUrl);
  const artX = x + Math.round(CARD_WIDTH_PX * CARD_FACE_LAYOUT.artwork.x);
  const artY = y + Math.round(CARD_HEIGHT_PX * CARD_FACE_LAYOUT.artwork.y);
  const artW = Math.round(CARD_WIDTH_PX * CARD_FACE_LAYOUT.artwork.width);
  const artH = Math.round(CARD_HEIGHT_PX * CARD_FACE_LAYOUT.artwork.height);
  context.save();
  roundedRect(context, artX, artY, artW, artH, 20);
  context.clip();
  if (image) {
    const sourceRatio = image.naturalWidth / image.naturalHeight;
    const targetRatio = artW / artH;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    let sourceX = 0;
    let sourceY = 0;
    if (sourceRatio > targetRatio) {
      sourceWidth = image.naturalHeight * targetRatio;
      sourceX = (image.naturalWidth - sourceWidth) / 2;
    } else {
      sourceHeight = image.naturalWidth / targetRatio;
      sourceY = (image.naturalHeight - sourceHeight) / 2;
    }
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, artX, artY, artW, artH);
  } else {
    const artGradient = context.createRadialGradient(
      artX + artW * 0.42,
      artY + artH * 0.36,
      20,
      artX + artW * 0.5,
      artY + artH * 0.5,
      artW * 0.72,
    );
    artGradient.addColorStop(0, mode.accentHex);
    artGradient.addColorStop(1, '#101617');
    context.fillStyle = artGradient;
    context.fillRect(artX, artY, artW, artH);
  }
  const artShade = context.createLinearGradient(0, artY + artH * 0.48, 0, artY + artH);
  artShade.addColorStop(0, 'rgba(4, 7, 8, 0)');
  artShade.addColorStop(0.66, 'rgba(4, 7, 8, .18)');
  artShade.addColorStop(1, 'rgba(4, 7, 8, .7)');
  context.fillStyle = artShade;
  context.fillRect(artX, artY, artW, artH);
  context.restore();

  context.strokeStyle = 'rgba(245, 240, 221, .58)';
  context.lineWidth = 3;
  roundedRect(context, artX, artY, artW, artH, 20);
  context.stroke();

  const panelX = x + Math.round(CARD_WIDTH_PX * CARD_FACE_LAYOUT.infoPanel.x);
  const panelY = y + Math.round(CARD_HEIGHT_PX * CARD_FACE_LAYOUT.infoPanel.y);
  const panelW = Math.round(CARD_WIDTH_PX * CARD_FACE_LAYOUT.infoPanel.width);
  const panelH = Math.round(CARD_HEIGHT_PX * CARD_FACE_LAYOUT.infoPanel.height);
  context.fillStyle = 'rgba(6, 9, 10, .86)';
  context.strokeStyle = 'rgba(245, 240, 221, .42)';
  context.lineWidth = 2;
  roundedRect(context, panelX, panelY, panelW, panelH, 15);
  context.fill();
  context.stroke();
  context.fillStyle = mode.accentHex;
  context.fillRect(panelX + 26, panelY + 31, panelW - 52, 2);

  context.strokeStyle = mode.accentHex;
  context.lineWidth = 9;
  roundedRect(context, x + 18, y + 18, CARD_WIDTH_PX - 36, CARD_HEIGHT_PX - 36, 25);
  context.stroke();
  context.strokeStyle = 'rgba(245, 240, 221, .72)';
  context.lineWidth = 3;
  roundedRect(context, x + 32, y + 32, CARD_WIDTH_PX - 64, CARD_HEIGHT_PX - 64, 18);
  context.stroke();

  const titleX = x + Math.round(CARD_WIDTH_PX * CARD_FACE_LAYOUT.titlePlate.x);
  const titleY = y + Math.round(CARD_HEIGHT_PX * CARD_FACE_LAYOUT.titlePlate.y);
  const titleW = Math.round(CARD_WIDTH_PX * CARD_FACE_LAYOUT.titlePlate.width);
  const titleH = Math.round(CARD_HEIGHT_PX * CARD_FACE_LAYOUT.titlePlate.height);
  context.fillStyle = 'rgba(8, 10, 10, .9)';
  context.strokeStyle = 'rgba(241, 200, 106, .82)';
  context.lineWidth = 3;
  roundedRect(context, titleX, titleY, titleW, titleH, 10);
  context.fill();
  context.stroke();

  context.fillStyle = 'rgba(242,240,232,.72)';
  context.font = '600 16px PingFang SC, Microsoft YaHei, sans-serif';
  context.fillText(`${mode.english} / ${card.title}`, titleX + 22, titleY + 24, titleW - 150);
  context.fillStyle = '#f5f2e8';
  setFittedFont(context, card.name, '700', 47, 31, titleW - 160);
  context.fillText(card.name, titleX + 22, titleY + 76, titleW - 160);

  drawPrintCostBadge(
    context,
    card.cost,
    x + CARD_WIDTH_PX * CARD_FACE_LAYOUT.cost.x,
    y + CARD_HEIGHT_PX * CARD_FACE_LAYOUT.cost.y,
    CARD_WIDTH_PX * CARD_FACE_LAYOUT.cost.radius,
  );

  drawPrintGameplayMarks(context, card, deck, x, y);

  context.fillStyle = mode.accentHex;
  context.font = '700 20px PingFang SC, Microsoft YaHei, sans-serif';
  context.fillText(`◆ ${card.rarity}`, panelX + 24, panelY + 25, panelW - 150);
  context.textAlign = 'right';
  context.fillStyle = 'rgba(242,240,232,.62)';
  context.font = '600 16px PingFang SC, Microsoft YaHei, sans-serif';
  context.fillText('能力词条', panelX + panelW - 24, panelY + 24);
  context.textAlign = 'left';

  const terms = deriveAbilityTerms(card.skill, 3);
  const termTop = panelY + 35;
  const termGap = 3;
  const termCount = Math.max(1, terms.length);
  const termHeight = Math.max(22, (panelY + panelH - 6 - termTop - termGap * (termCount - 1)) / termCount);
  const termColors = [mode.accentHex, '#f1c86a', '#4fddb2'];
  terms.forEach((term, index) => {
    const rowY = termTop + index * (termHeight + termGap);
    context.fillStyle = 'rgba(12, 16, 16, .62)';
    context.strokeStyle = termColors[index % termColors.length];
    context.lineWidth = 1.5;
    roundedRect(context, panelX + 18, rowY, panelW - 36, termHeight, 6);
    context.fill();
    context.globalAlpha = 0.82;
    context.fillStyle = termColors[index % termColors.length];
    context.fillRect(panelX + 26, rowY + termHeight * 0.2, 5, termHeight * 0.6);
    context.globalAlpha = 1;
    context.fillStyle = '#fff4df';
    setFittedFont(
      context,
      `「${term.keyword}」${term.effect}`,
      '600',
      Math.min(22, termHeight * 0.68),
      16,
      panelW - 80,
    );
    context.textBaseline = 'middle';
    context.fillText(`「${term.keyword}」${term.effect}`, panelX + 42, rowY + termHeight / 2, panelW - 80);
    context.textBaseline = 'alphabetic';
  });

  const statY = y + CARD_HEIGHT_PX * CARD_FACE_LAYOUT.stats.y;
  const statRadius = CARD_WIDTH_PX * CARD_FACE_LAYOUT.stats.radius;
  drawPrintAttackBadge(
    context,
    card.attack,
    x + CARD_WIDTH_PX * CARD_FACE_LAYOUT.stats.leftX,
    statY,
    statRadius,
  );
  drawPrintDefenseBadge(
    context,
    card.defense,
    x + CARD_WIDTH_PX * CARD_FACE_LAYOUT.stats.rightX,
    statY,
    statRadius,
  );

  context.textAlign = 'center';
  context.fillStyle = 'rgba(242,240,232,.54)';
  context.font = '400 17px PingFang SC, Microsoft YaHei, sans-serif';
  context.fillText(`${deck.name} · ${card.author}`, x + CARD_WIDTH_PX / 2, y + CARD_HEIGHT_PX - 10);

  if ((card.inscriptionPlacement ?? 'front') === 'front') {
    drawInscription(context, card, x + CARD_WIDTH_PX / 2, y + CARD_HEIGHT_PX - 70, mode.accentHex);
  }
  drawFanStudyCardMark(
    context,
    deck,
    artX + 12,
    Math.max(artY + 14, titleY + titleH + 12),
    artW - 24,
  );

  drawPrintOwnershipMark(context, deck);
  context.restore();
  await embedPrintForensicWatermark(context, canvas, deck, card, 'front');
  return canvas;
}

function drawInscription(
  context: CanvasRenderingContext2D,
  card: CardData,
  centerX: number,
  centerY: number,
  accent: string,
): void {
  const seal = (card.inscriptionStyle ?? 'seal') === 'seal';
  const text = (card.inscriptionText || card.author || '佚名').slice(0, 24);
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = seal
    ? '700 22px PingFang SC, Microsoft YaHei, sans-serif'
    : 'italic 500 27px KaiTi, STKaiti, PingFang SC, sans-serif';
  const width = Math.min(300, Math.max(94, context.measureText(text).width + 42));
  if (seal) {
    context.fillStyle = 'rgba(193, 68, 62, .2)';
    context.strokeStyle = '#f1c86a';
    context.lineWidth = 3;
    context.beginPath();
    context.roundRect(centerX - width / 2, centerY - 21, width, 42, 7);
    context.fill();
    context.stroke();
    context.fillStyle = '#f1c86a';
  } else {
    context.strokeStyle = accent;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(centerX - width / 2, centerY + 17);
    context.bezierCurveTo(centerX - width * 0.2, centerY - 3, centerX + width * 0.2, centerY + 27, centerX + width / 2, centerY + 8);
    context.stroke();
    context.fillStyle = accent;
  }
  context.fillText(text, centerX, centerY);
  context.restore();
}

async function renderPrintCardBack(card: CardData, deck: DeckData): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH_PX + BLEED_PX * 2;
  canvas.height = CARD_HEIGHT_PX + BLEED_PX * 2;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');

  const mode = MODE_BY_ID[deck.modeId];
  const design = deck.cardBack ?? {
    style: 'forge' as const,
    seed: hashString(deck.id),
    label: deck.name,
  };
  const random = makeRandom((design.seed ^ hashString(design.style)) >>> 0);
  const fullWidth = canvas.width;
  const fullHeight = canvas.height;
  const x = BLEED_PX;
  const y = BLEED_PX;
  const centerX = x + CARD_WIDTH_PX / 2;
  const centerY = y + CARD_HEIGHT_PX * 0.47;
  const gradient = context.createLinearGradient(0, 0, fullWidth, fullHeight);
  gradient.addColorStop(0, '#080b0c');
  gradient.addColorStop(0.55, `#${mode.deep.toString(16).padStart(6, '0')}`);
  gradient.addColorStop(1, '#050707');
  context.fillStyle = gradient;
  context.fillRect(0, 0, fullWidth, fullHeight);

  context.save();
  roundedRect(context, x, y, CARD_WIDTH_PX, CARD_HEIGHT_PX, 34);
  context.clip();
  if (design.textureUrl) {
    const texture = await loadImage(design.textureUrl);
    if (texture) {
      context.globalAlpha = 0.48;
      context.drawImage(texture, x, y, CARD_WIDTH_PX, CARD_HEIGHT_PX);
      context.globalAlpha = 1;
    }
  }

  context.strokeStyle = mode.accentHex;
  context.lineWidth = 12;
  roundedRect(context, x + 18, y + 18, CARD_WIDTH_PX - 36, CARD_HEIGHT_PX - 36, 27);
  context.stroke();
  context.strokeStyle = '#f1c86a';
  context.lineWidth = 4;
  roundedRect(context, x + 38, y + 38, CARD_WIDTH_PX - 76, CARD_HEIGHT_PX - 76, 20);
  context.stroke();

  context.strokeStyle = mode.accentHex;
  context.fillStyle = mode.accentHex;
  if (design.style === 'constellation') {
    let previousX = centerX;
    let previousY = centerY;
    for (let index = 0; index < 22; index += 1) {
      const starX = x + CARD_WIDTH_PX * (0.15 + random() * 0.7);
      const starY = y + CARD_HEIGHT_PX * (0.14 + random() * 0.64);
      if (index > 0 && index % 2 === 0) {
        context.globalAlpha = 0.28;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(previousX, previousY);
        context.lineTo(starX, starY);
        context.stroke();
      }
      context.globalAlpha = 0.55 + random() * 0.4;
      context.beginPath();
      context.arc(starX, starY, 3 + random() * 7, 0, Math.PI * 2);
      context.fill();
      previousX = starX;
      previousY = starY;
    }
  } else if (design.style === 'circuit') {
    context.globalAlpha = 0.52;
    context.lineWidth = 5;
    for (let index = 0; index < 14; index += 1) {
      const startX = x + CARD_WIDTH_PX * (0.12 + random() * 0.76);
      const startY = y + CARD_HEIGHT_PX * (0.15 + random() * 0.66);
      const direction = index % 2 === 0 ? 1 : -1;
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(startX + direction * 74, startY);
      context.lineTo(startX + direction * 74, startY + 52);
      context.lineTo(startX + direction * 128, startY + 52);
      context.stroke();
      context.beginPath();
      context.arc(startX, startY, 8, 0, Math.PI * 2);
      context.fill();
    }
  } else {
    context.globalAlpha = 0.68;
    for (let ring = 0; ring < 5; ring += 1) {
      context.lineWidth = Math.max(3, 9 - ring);
      context.strokeStyle = ring % 2 === 0 ? mode.accentHex : '#f1c86a';
      context.beginPath();
      if (design.style === 'sigil') {
        const size = 115 + ring * 48;
        context.moveTo(centerX, centerY - size);
        context.lineTo(centerX + size * 0.76, centerY);
        context.lineTo(centerX, centerY + size);
        context.lineTo(centerX - size * 0.76, centerY);
        context.closePath();
      } else {
        context.arc(centerX, centerY, 92 + ring * 51, 0, Math.PI * 2);
      }
      context.stroke();
    }
  }
  context.globalAlpha = 1;
  context.fillStyle = '#f4f0e5';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 142px STKaiti, KaiTi, PingFang SC, sans-serif';
  context.fillText(mode.glyph, centerX, centerY);
  context.font = '600 34px STKaiti, KaiTi, PingFang SC, sans-serif';
  context.fillText((design.label || deck.name).slice(0, 20), centerX, y + CARD_HEIGHT_PX * 0.83, CARD_WIDTH_PX - 150);

  if ((card.inscriptionPlacement ?? 'front') === 'back') {
    drawInscription(context, card, centerX, y + CARD_HEIGHT_PX * 0.92, mode.accentHex);
  }
  drawFanStudyCardMark(context, deck, x + 72, y + CARD_HEIGHT_PX - 132, CARD_WIDTH_PX - 144);

  drawPrintOwnershipMark(context, deck);
  context.restore();
  await embedPrintForensicWatermark(context, canvas, deck, card, 'back');
  return canvas;
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let current = '';
  for (const char of chars) {
    const candidate = current + char;
    if (context.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = char;
      if (lines.length === maxLines - 1) break;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.join('').length < chars.length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  }
  return lines;
}

function wrapRuleText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const char of Array.from(paragraph)) {
      const candidate = current + char;
      if (context.measureText(candidate).width > maxWidth && current) {
        lines.push(current);
        current = char;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function createRulePage(
  deck: DeckData,
  pageNumber: number,
  sectionLabel: string,
  flavor: PrintExportFlavor,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = RULE_PAGE_RASTER_WIDTH_PX;
  canvas.height = RULE_PAGE_RASTER_HEIGHT_PX;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.scale(
    RULE_PAGE_RASTER_WIDTH_PX / RULE_PAGE_WIDTH_PX,
    RULE_PAGE_RASTER_HEIGHT_PX / RULE_PAGE_HEIGHT_PX,
  );
  const mode = MODE_BY_ID[deck.modeId];

  const paper = context.createLinearGradient(0, 0, RULE_PAGE_WIDTH_PX, RULE_PAGE_HEIGHT_PX);
  paper.addColorStop(0, '#fff6e5');
  paper.addColorStop(0.52, '#f4e2c3');
  paper.addColorStop(1, '#ead0a9');
  context.fillStyle = paper;
  context.fillRect(0, 0, RULE_PAGE_WIDTH_PX, RULE_PAGE_HEIGHT_PX);

  context.fillStyle = '#3b1d19';
  context.fillRect(0, 0, RULE_PAGE_WIDTH_PX, 28);
  context.fillRect(0, RULE_PAGE_HEIGHT_PX - 28, RULE_PAGE_WIDTH_PX, 28);
  context.fillStyle = mode.accentHex;
  context.fillRect(0, 28, RULE_PAGE_WIDTH_PX, 8);
  context.fillRect(0, RULE_PAGE_HEIGHT_PX - 36, RULE_PAGE_WIDTH_PX, 8);

  context.strokeStyle = '#9f6733';
  context.lineWidth = 4;
  context.strokeRect(48, 54, RULE_PAGE_WIDTH_PX - 96, RULE_PAGE_HEIGHT_PX - 108);
  context.strokeStyle = 'rgba(84, 43, 29, .34)';
  context.lineWidth = 1.5;
  context.strokeRect(62, 68, RULE_PAGE_WIDTH_PX - 124, RULE_PAGE_HEIGHT_PX - 136);

  context.save();
  context.globalAlpha = 0.07;
  context.strokeStyle = '#5a3021';
  context.lineWidth = 2;
  for (let offset = -RULE_PAGE_HEIGHT_PX; offset < RULE_PAGE_WIDTH_PX; offset += 74) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset + RULE_PAGE_HEIGHT_PX, RULE_PAGE_HEIGHT_PX);
    context.stroke();
  }
  context.restore();

  context.fillStyle = '#513027';
  context.font = `600 22px ${RULE_FONT}`;
  context.textAlign = 'left';
  context.fillText(deck.name.slice(0, 34), RULE_PAGE_MARGIN_PX, 102, 720);
  context.fillStyle = mode.accentHex;
  context.textAlign = 'right';
  context.fillText(sectionLabel, RULE_PAGE_WIDTH_PX - RULE_PAGE_MARGIN_PX, 102, 420);

  context.fillStyle = '#6f4a36';
  context.font = `500 18px ${RULE_FONT}`;
  context.textAlign = 'left';
  const exportMark = getExportMark(deck);
  const identity = getPrintDeckIdentity(deck);
  const productionLabel = flavor === 'pdfx4'
    ? 'PDF/X-4 印厂文件 · CMYK 输出'
    : 'RGB 打样 · 印厂转换 CMYK';
  context.fillText(
    `${exportMark ? `万象卡域 · ${exportMark}` : '万象卡域 · 原创玩法说明书'} · ${productionLabel} · ${identity.footerLabel}`,
    RULE_PAGE_MARGIN_PX,
    RULE_PAGE_HEIGHT_PX - 62,
    850,
  );
  context.textAlign = 'right';
  context.fillText(
    `${String(pageNumber).padStart(2, '0')} / A4 210 × 297 mm / 安全边距 12 mm`,
    RULE_PAGE_WIDTH_PX - RULE_PAGE_MARGIN_PX,
    RULE_PAGE_HEIGHT_PX - 62,
  );
  context.textAlign = 'left';
  return canvas;
}

function setFittedFont(
  context: CanvasRenderingContext2D,
  text: string,
  weight: string,
  preferredSize: number,
  minimumSize: number,
  maxWidth: number,
  family = RULE_FONT,
): number {
  let size = preferredSize;
  while (size > minimumSize) {
    context.font = `${weight} ${size}px ${family}`;
    if (context.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  context.font = `${weight} ${size}px ${family}`;
  return size;
}

function drawCreatorMarks(
  context: CanvasRenderingContext2D,
  signature: string,
  sealText: string,
  x: number,
  y: number,
  accent: string,
): void {
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = accent;
  setFittedFont(
    context,
    signature,
    'italic 600',
    48,
    28,
    310,
    'STKaiti, KaiTi, PingFang SC, cursive',
  );
  context.fillText(signature, x, y, 310);
  context.strokeStyle = accent;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(x - 150, y + 34);
  context.bezierCurveTo(x - 55, y + 10, x + 42, y + 52, x + 154, y + 22);
  context.stroke();

  const sealSize = 82;
  const sealX = x + 190;
  const sealY = y - 40;
  context.fillStyle = 'rgba(172, 47, 37, .1)';
  context.fillRect(sealX, sealY, sealSize, sealSize);
  context.strokeStyle = '#a8322a';
  context.lineWidth = 5;
  context.strokeRect(sealX, sealY, sealSize, sealSize);
  context.lineWidth = 2;
  context.strokeRect(sealX + 8, sealY + 8, sealSize - 16, sealSize - 16);
  context.fillStyle = '#a8322a';
  context.font = `700 22px STKaiti, KaiTi, ${RULE_FONT}`;
  const chars = Array.from(sealText.slice(0, 4));
  chars.forEach((char, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    context.fillText(char, sealX + 24 + column * 34, sealY + 24 + row * 34);
  });
  context.restore();
}

function drawRuleBookCover(
  deck: DeckData,
  ruleBook: RuleBook,
  flavor: PrintExportFlavor,
): HTMLCanvasElement {
  const canvas = createRulePage(deck, 1, 'RULE BOOK', flavor);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  const mode = MODE_BY_ID[deck.modeId];
  const plaque = deck.creatorPlaque;
  const creator = plaque?.displayName?.trim() || deck.author || '佚名';
  const signature = plaque?.signatureText?.trim() || creator;
  const sealText = plaque?.sealText?.trim() || `${creator.slice(0, 3)}制`;

  context.textAlign = 'center';
  context.fillStyle = '#9f382c';
  context.font = `700 24px ${RULE_FONT}`;
  context.fillText(
    getExportMark(deck)
      ? `FAN STUDY / NON-COMMERCIAL / UNOFFICIAL / ${flavor === 'pdfx4' ? 'PDF/X-4' : 'RGB PROOF'}`
      : flavor === 'pdfx4'
        ? 'PDF/X-4 PRESS MASTER / CMYK / 300 PPI'
        : 'RGB PRINT PROOF / PRINT-SHOP CMYK CONVERSION REQUIRED',
    RULE_PAGE_WIDTH_PX / 2,
    220,
  );
  context.fillStyle = '#371c18';
  setFittedFont(context, deck.name, '800', 82, 48, 1120);
  context.fillText(deck.name, RULE_PAGE_WIDTH_PX / 2, 330, 1120);
  context.fillStyle = mode.accentHex;
  setFittedFont(context, ruleBook.title, '700', 43, 28, 980);
  context.fillText(ruleBook.title, RULE_PAGE_WIDTH_PX / 2, 404, 980);

  context.strokeStyle = '#a26935';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(330, 462);
  context.lineTo(1070, 462);
  context.stroke();
  context.fillStyle = '#a26935';
  context.save();
  context.translate(RULE_PAGE_WIDTH_PX / 2, 462);
  context.rotate(Math.PI / 4);
  context.fillRect(-9, -9, 18, 18);
  context.restore();

  context.fillStyle = '#54372c';
  context.font = `500 29px ${RULE_FONT}`;
  const storyLines = wrapText(context, ruleBook.world, 1050, 5);
  storyLines.forEach((line, index) => context.fillText(line, RULE_PAGE_WIDTH_PX / 2, 540 + index * 44));

  const metaY = 790;
  const metaItems = [ruleBook.audience, ruleBook.duration, `${deck.cards.length}张套牌`];
  metaItems.forEach((item, index) => {
    const centerX = 360 + index * 340;
    context.fillStyle = 'rgba(255, 249, 235, .62)';
    context.strokeStyle = 'rgba(126, 73, 43, .48)';
    context.lineWidth = 2;
    context.beginPath();
    context.roundRect(centerX - 142, metaY, 284, 74, 8);
    context.fill();
    context.stroke();
    context.fillStyle = '#4b2d24';
    context.font = `600 24px ${RULE_FONT}`;
    context.fillText(item, centerX, metaY + 46, 250);
  });

  const quickY = 930;
  context.textAlign = 'left';
  context.fillStyle = '#371c18';
  context.font = `800 34px ${RULE_FONT}`;
  context.fillText('玩法速览', 150, quickY);
  context.fillStyle = mode.accentHex;
  context.fillRect(150, quickY + 18, 114, 5);
  context.fillStyle = '#5b3a2c';
  context.font = `500 25px ${RULE_FONT}`;
  let quickLineY = quickY + 74;
  for (const item of ruleBook.quickReference.slice(0, 5)) {
    const lines = wrapRuleText(context, item, 1080);
    if (quickLineY + Math.min(2, lines.length) * 37 > 1314) break;
    lines.slice(0, 2).forEach((line, index) => {
      context.fillText(index === 0 ? `◆ ${line}` : `   ${line}`, 164, quickLineY);
      quickLineY += 37;
    });
    quickLineY += 8;
  }

  const plaqueX = 130;
  const plaqueY = 1360;
  const plaqueW = RULE_PAGE_WIDTH_PX - 260;
  const plaqueH = 380;
  context.fillStyle = 'rgba(255, 247, 229, .72)';
  context.strokeStyle = '#9c6333';
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(plaqueX, plaqueY, plaqueW, plaqueH, 10);
  context.fill();
  context.stroke();
  context.fillStyle = '#9f382c';
  context.fillRect(plaqueX, plaqueY, 14, plaqueH);

  context.fillStyle = '#371c18';
  context.font = `800 31px ${RULE_FONT}`;
  context.fillText('创作者铭牌', plaqueX + 54, plaqueY + 68);
  context.fillStyle = '#654536';
  context.font = `500 23px ${RULE_FONT}`;
  const plaqueLines = [
    `创作者：${creator}`,
    plaque?.studioName ? `创作单位：${plaque.studioName}` : '',
    `版本：${plaque?.edition || '原创定制版'}`,
    `作品编号：${plaque?.serialNumber || deck.id}`,
  ].filter(Boolean);
  plaqueLines.forEach((line, index) => context.fillText(line, plaqueX + 54, plaqueY + 124 + index * 43, 530));
  if (plaque?.dedication) {
    context.fillStyle = '#7b503a';
    setFittedFont(
      context,
      plaque.dedication,
      'italic 500',
      21,
      17,
      600,
      `STKaiti, KaiTi, ${RULE_FONT}`,
    );
    context.fillText(plaque.dedication, plaqueX + 54, plaqueY + 305, 600);
  }
  drawCreatorMarks(context, signature, sealText, plaqueX + 820, plaqueY + 212, mode.accentHex);
  return canvas;
}

function drawFanStudyNoticePage(
  deck: DeckData,
  pageNumber: number,
  flavor: PrintExportFlavor,
): HTMLCanvasElement {
  const policy = assertDeckExportAllowed(deck);
  if (policy.mode !== 'fan-study') throw new Error('Fan-study notice requested for original deck');
  const canvas = createRulePage(deck, pageNumber, 'RIGHTS NOTICE', flavor);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  const mode = MODE_BY_ID[deck.modeId];
  const agreement = deck.contentPolicy?.mode === 'fan-study' ? deck.contentPolicy.agreement : null;

  context.fillStyle = '#371c18';
  context.font = `800 48px ${RULE_FONT}`;
  context.fillText('个人同人研习声明', RULE_PAGE_MARGIN_PX, 190);
  context.fillStyle = mode.accentHex;
  context.fillRect(RULE_PAGE_MARGIN_PX, 218, 220, 7);

  context.fillStyle = 'rgba(159, 56, 44, .1)';
  context.strokeStyle = '#9f382c';
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(RULE_PAGE_MARGIN_PX, 270, RULE_PAGE_WIDTH_PX - RULE_PAGE_MARGIN_PX * 2, 126, 8);
  context.fill();
  context.stroke();
  context.fillStyle = '#8f2f28';
  context.font = `800 31px ${RULE_FONT}`;
  context.fillText('非商业同人创作 / 非官方授权', RULE_PAGE_MARGIN_PX + 34, 326);
  context.fillStyle = '#5c352d';
  context.font = `600 22px ${RULE_FONT}`;
  context.fillText('勾选、免责声明与本软件均不会授予知识产权许可，也不构成合法性背书。', RULE_PAGE_MARGIN_PX + 34, 365);

  context.fillStyle = '#3a201a';
  context.font = `800 31px ${RULE_FONT}`;
  context.fillText('已逐项确认', RULE_PAGE_MARGIN_PX, 474);
  let cursorY = 526;
  context.font = `500 23px ${RULE_FONT}`;
  for (const label of Object.values(FAN_STUDY_CONFIRMATION_LABELS)) {
    context.fillStyle = mode.accentHex;
    context.font = `800 24px ${RULE_FONT}`;
    context.fillText('✓', RULE_PAGE_MARGIN_PX + 8, cursorY);
    context.fillStyle = '#53352a';
    context.font = `500 23px ${RULE_FONT}`;
    const lines = wrapRuleText(context, label, RULE_PAGE_WIDTH_PX - RULE_PAGE_MARGIN_PX * 2 - 70);
    lines.forEach((line, index) => {
      context.fillText(line, RULE_PAGE_MARGIN_PX + 54, cursorY + index * 32);
    });
    cursorY += Math.max(1, lines.length) * 32 + 15;
  }

  cursorY += 24;
  context.fillStyle = '#3a201a';
  context.font = `800 31px ${RULE_FONT}`;
  context.fillText('完整免责声明', RULE_PAGE_MARGIN_PX, cursorY);
  cursorY += 52;
  context.fillStyle = '#5b3a2c';
  context.font = `500 24px ${RULE_FONT}`;
  const disclaimerLines = wrapRuleText(
    context,
    FAN_STUDY_DISCLAIMER,
    RULE_PAGE_WIDTH_PX - RULE_PAGE_MARGIN_PX * 2,
  );
  disclaimerLines.forEach((line, index) => {
    context.fillText(line, RULE_PAGE_MARGIN_PX, cursorY + index * 37);
  });

  const acceptedAt = agreement?.acceptedAt
    ? new Date(agreement.acceptedAt).toLocaleString('zh-CN', { hour12: false })
    : '未记录';
  context.fillStyle = '#74503b';
  context.font = `600 20px ${RULE_FONT}`;
  context.fillText(
    `条款版本 ${agreement?.termsVersion ?? FAN_STUDY_TERMS_VERSION} · 本机确认时间 ${acceptedAt} · 套牌编号 ${deck.id}`,
    RULE_PAGE_MARGIN_PX,
    RULE_PAGE_BOTTOM_PX - 14,
    RULE_PAGE_WIDTH_PX - RULE_PAGE_MARGIN_PX * 2,
  );
  return canvas;
}

export function buildPrintAbilityGlossary(deck: Pick<DeckData, 'cards'>): string[] {
  return buildAbilityGlossaryEntries(deck.cards);
}

interface RuleBookHeadingInstruction {
  kind: 'heading';
  title: string;
  continuation: boolean;
  y: number;
}

interface RuleBookLineInstruction {
  kind: 'line';
  prefix: string;
  text: string;
  emphasized: boolean;
  y: number;
}

type RuleBookInstruction = RuleBookHeadingInstruction | RuleBookLineInstruction;

interface RuleBookContentPagePlan {
  instructions: RuleBookInstruction[];
}

export interface DeckPrintPlan {
  readonly deckId: string;
  readonly cardCount: number;
  readonly flavor: PrintExportFlavor;
  readonly cardBindings: readonly DeckPrintCardBinding[];
  readonly sheetCount: number;
  readonly pageCount: number;
  readonly ruleBook: RuleBook;
  readonly ruleBookContentPages: readonly RuleBookContentPagePlan[];
  readonly includesRightsNotice: boolean;
}

interface DeckPrintCardBinding {
  readonly id: string;
  readonly artUrl: string;
}

function freezeRecursively<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) freezeRecursively(child, seen);
  return Object.freeze(value);
}

/** Captures the exact JSON-safe deck revision that one export operation will render. */
export function createDeckPrintSnapshot(deck: DeckData): DeckData {
  let snapshot: DeckData;
  try {
    snapshot = typeof structuredClone === 'function'
      ? structuredClone(deck)
      : JSON.parse(JSON.stringify(deck)) as DeckData;
  } catch {
    throw new Error('套牌包含无法复制的内容，请保存并重新打开后再导出。');
  }
  return freezeRecursively(snapshot);
}

function bindPrintCards(cards: readonly CardData[]): readonly DeckPrintCardBinding[] {
  return Object.freeze(cards.map((card) => Object.freeze({
    id: card.id,
    artUrl: card.artUrl,
  })));
}

function printPlanMatchesDeck(
  plan: DeckPrintPlan,
  deck: DeckData,
  flavor: PrintExportFlavor,
): boolean {
  return plan.deckId === deck.id
    && plan.cardCount === deck.cards.length
    && plan.flavor === flavor
    && plan.cardBindings.length === deck.cards.length
    && plan.cardBindings.every((binding, index) => {
      const card = deck.cards[index];
      return binding.id === card.id
        && binding.artUrl === card.artUrl;
    });
}

function ruleBookSections(deck: DeckData, ruleBook: RuleBook): Array<{
  title: string;
  items: string[];
  ordered?: boolean;
}> {
  return [
    { title: '套装专属规则', items: ruleBook.deckRules, ordered: true },
    { title: '游戏目标', items: ruleBook.objective },
    { title: '组件清单', items: ruleBook.components },
    { title: '初始设置', items: ruleBook.setup, ordered: true },
    {
      title: '回合流程',
      items: ruleBook.flow.map((step) => `【${step.moduleName}】${step.instruction}`),
      ordered: true,
    },
    { title: '胜负判定', items: ruleBook.victory },
    {
      title: '进阶变体',
      items: ruleBook.variants.map((variant) => `${variant.name}：${variant.description}`),
    },
    { title: '创作者补充', items: ruleBook.notes },
    { title: '卡牌能力词条表', items: buildPrintAbilityGlossary(deck), ordered: true },
  ];
}

function buildRuleBookContentPagePlans(
  deck: DeckData,
  ruleBook: RuleBook,
): RuleBookContentPagePlan[] {
  const measurementCanvas = document.createElement('canvas');
  measurementCanvas.width = 1;
  measurementCanvas.height = 1;
  const context = measurementCanvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  const pages: RuleBookContentPagePlan[] = [];
  let page: RuleBookContentPagePlan;
  let cursorY = 0;

  const startContentPage = (): void => {
    page = { instructions: [] };
    pages.push(page);
    cursorY = 246;
  };
  const addHeading = (title: string, continuation = false): void => {
    page.instructions.push({ kind: 'heading', title, continuation, y: cursorY });
    cursorY += 78;
  };

  startContentPage();
  for (const section of ruleBookSections(deck, ruleBook)) {
    if (!section.items.length) continue;
    context.font = `500 26px ${RULE_FONT}`;
    const contentWidth = RULE_PAGE_WIDTH_PX - RULE_PAGE_MARGIN_PX * 2 - 72;
    const previewHeight = section.items.slice(0, 2).reduce((height, item) => {
      const lineCount = Math.max(1, wrapRuleText(context, item, contentWidth).length);
      return height + lineCount * 39 + 10;
    }, 0);
    if (cursorY + 78 + previewHeight + 14 > RULE_PAGE_BOTTOM_PX) startContentPage();
    addHeading(section.title);

    section.items.forEach((item, itemIndex) => {
      context.font = `500 26px ${RULE_FONT}`;
      const prefix = section.ordered ? `${itemIndex + 1}.` : '•';
      const lines = wrapRuleText(context, item, contentWidth);
      lines.forEach((line, lineIndex) => {
        if (cursorY + 42 > RULE_PAGE_BOTTOM_PX) {
          startContentPage();
          addHeading(section.title, true);
        }
        page.instructions.push({
          kind: 'line',
          prefix: lineIndex === 0 ? prefix : '',
          text: line,
          emphasized: lineIndex === 0,
          y: cursorY,
        });
        cursorY += 39;
      });
      cursorY += 10;
    });
    cursorY += 14;
  }
  measurementCanvas.width = 1;
  measurementCanvas.height = 1;
  return pages;
}

function drawRuleBookContentPage(
  deck: DeckData,
  pageNumber: number,
  plan: RuleBookContentPagePlan,
  flavor: PrintExportFlavor,
): HTMLCanvasElement {
  const canvas = createRulePage(deck, pageNumber, 'PLAY GUIDE', flavor);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  const mode = MODE_BY_ID[deck.modeId];
  context.fillStyle = '#371c18';
  context.font = `800 39px ${RULE_FONT}`;
  context.fillText('完整玩法', RULE_PAGE_MARGIN_PX, 174);
  context.fillStyle = mode.accentHex;
  context.fillRect(RULE_PAGE_MARGIN_PX, 194, 132, 6);

  for (const instruction of plan.instructions) {
    if (instruction.kind === 'heading') {
      context.fillStyle = mode.accentHex;
      context.fillRect(RULE_PAGE_MARGIN_PX, instruction.y + 8, 12, 44);
      context.fillStyle = '#3a201a';
      context.font = `800 31px ${RULE_FONT}`;
      context.fillText(
        `${instruction.title}${instruction.continuation ? '（续）' : ''}`,
        RULE_PAGE_MARGIN_PX + 34,
        instruction.y + 42,
      );
      continue;
    }
    context.fillStyle = instruction.emphasized ? mode.accentHex : '#5b3a2c';
    context.font = instruction.emphasized ? `800 25px ${RULE_FONT}` : `500 25px ${RULE_FONT}`;
    context.fillText(instruction.prefix, RULE_PAGE_MARGIN_PX + 12, instruction.y + 28);
    context.fillStyle = '#53352a';
    context.font = `500 25px ${RULE_FONT}`;
    context.fillText(instruction.text, RULE_PAGE_MARGIN_PX + 68, instruction.y + 28);
  }
  return canvas;
}

function* renderDeckRuleBookPageSequence(
  deck: DeckData,
  flavor: PrintExportFlavor,
  plan?: DeckPrintPlan,
): Generator<{ canvas: HTMLCanvasElement; role: 'rulebook' | 'rightsNotice' }, void, void> {
  const prepared = plan ?? prepareDeckPrintPages(deck, flavor);
  yield { canvas: drawRuleBookCover(deck, prepared.ruleBook, flavor), role: 'rulebook' };
  for (let index = 0; index < prepared.ruleBookContentPages.length; index += 1) {
    yield {
      canvas: drawRuleBookContentPage(
        deck,
        index + 2,
        prepared.ruleBookContentPages[index],
        flavor,
      ),
      role: 'rulebook',
    };
  }
  if (prepared.includesRightsNotice) {
    yield {
      canvas: drawFanStudyNoticePage(
        deck,
        prepared.ruleBookContentPages.length + 2,
        flavor,
      ),
      role: 'rightsNotice',
    };
  }
}

export function prepareDeckPrintPages(
  deck: DeckData,
  flavor: PrintExportFlavor = 'pdfx4',
): DeckPrintPlan {
  const exportPolicy = assertDeckExportAllowed(deck);
  const ruleBook = generateRuleBook(deck);
  const ruleBookContentPages = buildRuleBookContentPagePlans(deck, ruleBook);
  const sheetCount = Math.max(1, Math.ceil(deck.cards.length / PRINT_SHEET_CELLS.length));
  const includesRightsNotice = exportPolicy.mode === 'fan-study';
  return {
    deckId: deck.id,
    cardCount: deck.cards.length,
    flavor,
    cardBindings: bindPrintCards(deck.cards),
    sheetCount,
    pageCount: sheetCount * 2 + 1 + ruleBookContentPages.length + (includesRightsNotice ? 1 : 0),
    ruleBook,
    ruleBookContentPages,
    includesRightsNotice,
  };
}

export function renderDeckRuleBookPages(
  deck: DeckData,
  flavor: PrintExportFlavor = 'rgb-proof',
): HTMLCanvasElement[] {
  const plan = prepareDeckPrintPages(deck, flavor);
  return [...renderDeckRuleBookPageSequence(deck, flavor, plan)].map((page) => page.canvas);
}

export async function assertDeckPrintExportReady(deck: DeckData): Promise<void> {
  const printReadiness = assessDeckPrintReadiness(deck);
  if (!printReadiness.ready) throw new Error(printReadiness.message);
  assertDeckExportAllowed(deck);
  await assertPrintArtworkReady(deck.cards, loadImageDimensions);
}

function createA4PrintCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = RULE_PAGE_RASTER_WIDTH_PX;
  canvas.height = RULE_PAGE_RASTER_HEIGHT_PX;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return canvas;
}

function drawCanvasCropMarks(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  const scaleX = RULE_PAGE_RASTER_WIDTH_PX / PRINT_PAGE_WIDTH_MM;
  const scaleY = RULE_PAGE_RASTER_HEIGHT_PX / PRINT_PAGE_HEIGHT_MM;
  context.save();
  context.strokeStyle = '#1c1c1c';
  context.lineWidth = PRINT_CROP_MARK_STROKE_MM * (scaleX + scaleY) / 2;
  context.beginPath();
  for (const segment of getCropMarkSegments(x, y, PRINT_CARD_WIDTH_MM, PRINT_CARD_HEIGHT_MM)) {
    context.moveTo(segment.x1 * scaleX, segment.y1 * scaleY);
    context.lineTo(segment.x2 * scaleX, segment.y2 * scaleY);
  }
  context.stroke();
  context.restore();
}

function drawCanvasPrintFooter(
  context: CanvasRenderingContext2D,
  deck: DeckData,
  side: 'FACE' | 'BACK',
  flavor: PrintExportFlavor,
): void {
  const identity = getPrintDeckIdentity(deck);
  const policyLabel = getExportMark(deck) ? ' / FAN STUDY / NON-COMMERCIAL' : '';
  const productionLabel = flavor === 'pdfx4'
    ? `PDF/X-4 PRESS MASTER / ${side} / CMYK / 300 PPI / BLEED 3 MM`
    : `RGB PROOF / ${side} / 300 PPI / BLEED 3 MM / PRINT-SHOP CMYK REQUIRED`;
  context.save();
  context.fillStyle = '#787878';
  context.font = `600 17px ${RULE_FONT}`;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillText(
    `${productionLabel}${policyLabel} / ${identity.footerLabel}`,
    RULE_PAGE_RASTER_WIDTH_PX / 2,
    RULE_PAGE_RASTER_HEIGHT_PX - 10,
    RULE_PAGE_RASTER_WIDTH_PX - 96,
  );
  context.restore();
}

async function renderCardSheetPage(
  deck: DeckData,
  cards: readonly CardData[],
  side: 'FACE' | 'BACK',
  flavor: PrintExportFlavor,
): Promise<HTMLCanvasElement> {
  const canvas = createA4PrintCanvas();
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  const scaleX = RULE_PAGE_RASTER_WIDTH_PX / PRINT_PAGE_WIDTH_MM;
  const scaleY = RULE_PAGE_RASTER_HEIGHT_PX / PRINT_PAGE_HEIGHT_MM;

  for (let index = 0; index < cards.length; index += 1) {
    const faceCell = PRINT_SHEET_CELLS[index];
    const cell = side === 'BACK' ? mirrorPrintCell(faceCell) : faceCell;
    const cardCanvas = side === 'BACK'
      ? await renderPrintCardBack(cards[index], deck)
      : await renderPrintCard(cards[index], deck);
    context.drawImage(
      cardCanvas,
      (cell.x - PRINT_BLEED_MM) * scaleX,
      (cell.y - PRINT_BLEED_MM) * scaleY,
      (PRINT_CARD_WIDTH_MM + PRINT_BLEED_MM * 2) * scaleX,
      (PRINT_CARD_HEIGHT_MM + PRINT_BLEED_MM * 2) * scaleY,
    );
    drawCanvasCropMarks(context, cell.x, cell.y);
    cardCanvas.width = 1;
    cardCanvas.height = 1;
  }
  drawCanvasPrintFooter(context, deck, side, flavor);
  return canvas;
}

export function countDeckPrintPages(
  deck: DeckData,
  flavor: PrintExportFlavor = 'pdfx4',
): number {
  return prepareDeckPrintPages(deck, flavor).pageCount;
}

export async function* renderDeckPrintPages(
  deck: DeckData,
  flavor: PrintExportFlavor = 'pdfx4',
  preparedPlan?: DeckPrintPlan,
): AsyncGenerator<DeckPrintPage, void, void> {
  deck = createDeckPrintSnapshot(deck);
  const plan = preparedPlan ?? prepareDeckPrintPages(deck, flavor);
  if (!printPlanMatchesDeck(plan, deck, flavor)) {
    throw new Error('印刷排版计划与当前牌组不一致，请重新开始导出。');
  }
  let pageIndex = 0;
  for (let sheet = 0; sheet < plan.sheetCount; sheet += 1) {
    const sheetCards = deck.cards.slice(
      sheet * PRINT_SHEET_CELLS.length,
      (sheet + 1) * PRINT_SHEET_CELLS.length,
    );
    yield {
      canvas: await renderCardSheetPage(deck, sheetCards, 'FACE', flavor),
      pageIndex,
      role: 'cardFront',
    };
    pageIndex += 1;
    yield {
      canvas: await renderCardSheetPage(deck, sheetCards, 'BACK', flavor),
      pageIndex,
      role: 'cardBack',
    };
    pageIndex += 1;
  }

  for (const rulePage of renderDeckRuleBookPageSequence(deck, flavor, plan)) {
    yield {
      canvas: rulePage.canvas,
      pageIndex,
      role: rulePage.role,
    };
    pageIndex += 1;
  }
}

function drawCropMarks(pdf: jsPDF, x: number, y: number, width: number, height: number): void {
  pdf.setDrawColor(28, 28, 28);
  pdf.setLineWidth(PRINT_CROP_MARK_STROKE_MM);
  for (const segment of getCropMarkSegments(x, y, width, height)) {
    pdf.line(segment.x1, segment.y1, segment.x2, segment.y2);
  }
}

function drawPrintFooter(pdf: jsPDF, deck: DeckData, side: 'FACE' | 'BACK'): void {
  const identity = getPrintDeckIdentity(deck);
  pdf.setFontSize(4.5);
  pdf.setTextColor(120, 120, 120);
  const policyLabel = getExportMark(deck) ? ' / FAN STUDY / NON-COMMERCIAL' : '';
  pdf.text(
    `RGB PROOF / ${side} / 300 PPI / BLEED 3 MM / PRINT-SHOP CMYK REQUIRED${policyLabel} / ${identity.footerLabel}`,
    105,
    296.2,
    { align: 'center' },
  );
}

export async function exportDeckPdf(deck: DeckData): Promise<boolean> {
  deck = createDeckPrintSnapshot(deck);
  const printReadiness = assessDeckPrintReadiness(deck);
  if (!printReadiness.ready) throw new Error(printReadiness.message);
  const exportPolicy = assertDeckExportAllowed(deck);
  await assertPrintArtworkReady(deck.cards, loadImageDimensions);
  const identity = getPrintDeckIdentity(deck);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  pdf.setProperties({
    title: `${deck.name} - 万象卡域 RGB 印刷打样`,
    subject: exportPolicy.exportMark
      ? `Wanxiang Deck RGB proof / print-shop CMYK conversion required / ${identity.metadataLabel} / ${exportPolicy.exportMark}`
      : `Wanxiang Deck RGB proof / print-shop CMYK conversion required / ${identity.metadataLabel}`,
    author: deck.author,
    creator: '万象卡域 Wanxiang Deck',
    keywords: `wanxiang-deck,rgb-proof,print-shop-cmyk-required,${identity.metadataLabel},bleed-3mm,300ppi${exportPolicy.exportMark ? ',fan-study,non-commercial,unofficial' : ''}`,
  });

  const cardWidth = PRINT_CARD_WIDTH_MM;
  const cardHeight = PRINT_CARD_HEIGHT_MM;
  const bleed = PRINT_BLEED_MM;
  const cells = PRINT_SHEET_CELLS;

  const cards = deck.cards.length ? deck.cards : [];
  const sheetCount = Math.max(1, Math.ceil(cards.length / cells.length));
  for (let sheet = 0; sheet < sheetCount; sheet += 1) {
    if (sheet > 0) pdf.addPage('a4', 'portrait');
    const sheetCards = cards.slice(sheet * cells.length, (sheet + 1) * cells.length);
    for (let index = 0; index < sheetCards.length; index += 1) {
      const cell = cells[index];
      const canvas = await renderPrintCard(sheetCards[index], deck);
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.94),
        'JPEG',
        cell.x - bleed,
        cell.y - bleed,
        cardWidth + bleed * 2,
        cardHeight + bleed * 2,
        undefined,
        'FAST',
      );
      drawCropMarks(pdf, cell.x, cell.y, cardWidth, cardHeight);
      canvas.width = 1;
      canvas.height = 1;
    }
    drawPrintFooter(pdf, deck, 'FACE');

    pdf.addPage('a4', 'portrait');
    for (let index = 0; index < sheetCards.length; index += 1) {
      const faceCell = cells[index];
      const backCell = mirrorPrintCell(faceCell);
      const canvas = await renderPrintCardBack(sheetCards[index], deck);
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.94),
        'JPEG',
        backCell.x - bleed,
        backCell.y - bleed,
        cardWidth + bleed * 2,
        cardHeight + bleed * 2,
        undefined,
        'FAST',
      );
      drawCropMarks(pdf, backCell.x, backCell.y, cardWidth, cardHeight);
      canvas.width = 1;
      canvas.height = 1;
    }
    drawPrintFooter(pdf, deck, 'BACK');
  }

  for (const rulePage of renderDeckRuleBookPageSequence(deck, 'rgb-proof')) {
    pdf.addPage('a4', 'portrait');
    pdf.addImage(
      rulePage.canvas.toDataURL('image/jpeg', 0.95),
      'JPEG',
      0,
      0,
      210,
      297,
      undefined,
      'FAST',
    );
    rulePage.canvas.width = 1;
    rulePage.canvas.height = 1;
  }
  const suggestedName = `${deck.name.replace(/[\\/:*?"<>|]/g, '-')}--rgb-proof.pdf`;
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    const { invoke } = await import('@tauri-apps/api/core');
    const dataUri = pdf.output('datauristring');
    const base64Data = dataUri.slice(dataUri.indexOf(',') + 1);
    const result = await invoke<{ saved: boolean }>('save_pdf', {
      base64Data,
      suggestedName,
    });
    return result.saved;
  }
  pdf.save(suggestedName);
  return true;
}

/** Explicit RGB proof entry retained for screen review and print-shop discussion. */
export async function exportDeckRgbProofPdf(deck: DeckData): Promise<boolean> {
  return exportDeckPdf(deck);
}
