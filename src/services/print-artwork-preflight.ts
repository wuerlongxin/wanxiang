import { CARD_FACE_LAYOUT } from '../card-art-layout.ts';
import { CARD_RATIO } from '../theme.ts';
import type { CardData } from '../types';

const BUILTIN_CARD_ART_ROOT = '/assets/cards/';
const LEGACY_WEBP_EXTENSION = '.webp';
const BUILTIN_GAME_MODES = new Set([
  'reflex',
  'memory',
  'strategy',
  'expression',
  'mischief',
]);

function isBuiltinCardArtworkName(name: string): boolean {
  if (BUILTIN_GAME_MODES.has(name)) return true;
  const starter = name.match(/^starter\/([a-z]+)-([1-4])$/u);
  return Boolean(starter && BUILTIN_GAME_MODES.has(starter[1]));
}

/** Resolves legacy bundled paths without mutating persisted or signed deck data. */
export function resolveRuntimeArtworkUrl(artUrl: string): string {
  if (
    !artUrl.startsWith(BUILTIN_CARD_ART_ROOT) ||
    !artUrl.endsWith(LEGACY_WEBP_EXTENSION)
  ) {
    return artUrl;
  }

  const name = artUrl.slice(
    BUILTIN_CARD_ART_ROOT.length,
    -LEGACY_WEBP_EXTENSION.length,
  );
  return isBuiltinCardArtworkName(name)
    ? `${BUILTIN_CARD_ART_ROOT}${name}.jpg`
    : artUrl;
}

export const PRINT_CARD_TRIM_WIDTH_PX = 744;
export const PRINT_CARD_TRIM_HEIGHT_PX = Math.round(PRINT_CARD_TRIM_WIDTH_PX * CARD_RATIO);
export const PRINT_ARTWORK_TARGET_WIDTH_PX = Math.round(
  PRINT_CARD_TRIM_WIDTH_PX * CARD_FACE_LAYOUT.artwork.width,
);
export const PRINT_ARTWORK_TARGET_HEIGHT_PX = Math.round(
  PRINT_CARD_TRIM_HEIGHT_PX * CARD_FACE_LAYOUT.artwork.height,
);
export const PRINT_OUTPUT_PPI = 300;
export const PRINT_ARTWORK_MIN_EFFECTIVE_PPI = 240;
export const PRINT_ARTWORK_MAX_UPSCALE = PRINT_OUTPUT_PPI / PRINT_ARTWORK_MIN_EFFECTIVE_PPI;
export const PRINT_ARTWORK_MIN_WIDTH_PX = Math.ceil(
  PRINT_ARTWORK_TARGET_WIDTH_PX / PRINT_ARTWORK_MAX_UPSCALE,
);
export const PRINT_ARTWORK_MIN_HEIGHT_PX = Math.ceil(
  PRINT_ARTWORK_TARGET_HEIGHT_PX / PRINT_ARTWORK_MAX_UPSCALE,
);

export interface PrintArtworkDimensions {
  width: number;
  height: number;
}

export interface PrintArtworkResolutionAssessment extends PrintArtworkDimensions {
  ready: boolean;
  effectivePpi: number;
  upscaleFactor: number;
}

export interface PrintArtworkIssue extends PrintArtworkDimensions {
  cardId: string;
  cardName: string;
  reason: 'unreadable' | 'undersized';
}

export type PrintArtworkDimensionLoader = (
  artUrl: string,
) => Promise<PrintArtworkDimensions | null>;

export function assessPrintArtworkResolution(
  width: number,
  height: number,
): PrintArtworkResolutionAssessment {
  const sourceWidth = Number.isFinite(width) && width > 0 ? Math.floor(width) : 0;
  const sourceHeight = Number.isFinite(height) && height > 0 ? Math.floor(height) : 0;
  if (!sourceWidth || !sourceHeight) {
    return { width: sourceWidth, height: sourceHeight, ready: false, effectivePpi: 0, upscaleFactor: Infinity };
  }

  const upscaleFactor = Math.max(
    PRINT_ARTWORK_TARGET_WIDTH_PX / sourceWidth,
    PRINT_ARTWORK_TARGET_HEIGHT_PX / sourceHeight,
  );
  const effectivePpi = Math.min(PRINT_OUTPUT_PPI, PRINT_OUTPUT_PPI / Math.max(1, upscaleFactor));
  return {
    width: sourceWidth,
    height: sourceHeight,
    ready: upscaleFactor <= PRINT_ARTWORK_MAX_UPSCALE,
    effectivePpi: Math.round(effectivePpi),
    upscaleFactor,
  };
}

export async function inspectPrintArtwork(
  cards: readonly Pick<CardData, 'id' | 'name' | 'artUrl'>[],
  loadDimensions: PrintArtworkDimensionLoader,
): Promise<PrintArtworkIssue[]> {
  const dimensionsByUrl = new Map<string, PrintArtworkDimensions | null>();
  const issues: PrintArtworkIssue[] = [];

  for (const card of cards) {
    const artUrl = card.artUrl.trim();
    const runtimeArtUrl = resolveRuntimeArtworkUrl(artUrl);
    if (!dimensionsByUrl.has(runtimeArtUrl)) {
      let dimensions: PrintArtworkDimensions | null = null;
      if (runtimeArtUrl) {
        try {
          dimensions = await loadDimensions(runtimeArtUrl);
        } catch {
          dimensions = null;
        }
      }
      dimensionsByUrl.set(runtimeArtUrl, dimensions);
    }

    const dimensions = dimensionsByUrl.get(runtimeArtUrl) ?? null;
    const assessment = assessPrintArtworkResolution(
      dimensions?.width ?? 0,
      dimensions?.height ?? 0,
    );
    if (!assessment.ready) {
      issues.push({
        cardId: card.id,
        cardName: card.name.trim() || card.id,
        reason: dimensions ? 'undersized' : 'unreadable',
        width: assessment.width,
        height: assessment.height,
      });
    }
  }

  return issues;
}

export function formatPrintArtworkIssues(issues: readonly PrintArtworkIssue[]): string {
  const visibleIssues = issues.slice(0, 4).map((issue) =>
    issue.reason === 'unreadable'
      ? `《${issue.cardName}》无法读取`
      : `《${issue.cardName}》${issue.width}x${issue.height}`,
  );
  const remaining = issues.length > visibleIssues.length ? `等${issues.length}张` : '';
  return `卡牌插画未达到 RGB 印刷打样要求：${visibleIssues.join('、')}${remaining}。最低 ${PRINT_ARTWORK_MIN_WIDTH_PX}x${PRINT_ARTWORK_MIN_HEIGHT_PX} 像素，请在设计台重绘后再导出。`;
}

export class PrintArtworkPreflightError extends Error {
  readonly code = 'PRINT_ARTWORK_NOT_READY';
  readonly issues: readonly PrintArtworkIssue[];

  constructor(issues: readonly PrintArtworkIssue[]) {
    super(formatPrintArtworkIssues(issues));
    this.name = 'PrintArtworkPreflightError';
    this.issues = issues;
  }
}

export async function assertPrintArtworkReady(
  cards: readonly Pick<CardData, 'id' | 'name' | 'artUrl'>[],
  loadDimensions: PrintArtworkDimensionLoader,
): Promise<void> {
  const issues = await inspectPrintArtwork(cards, loadDimensions);
  if (issues.length) throw new PrintArtworkPreflightError(issues);
}
