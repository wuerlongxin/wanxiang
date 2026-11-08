export type CardAbilityPopoverPlacement = 'auto' | 'below' | 'above';

export interface CardAbilityPopoverLayoutInput {
  cardWidth: number;
  cardHeight: number;
  globalCenterX: number;
  globalCenterY: number;
  viewportWidth: number;
  viewportHeight: number;
  preferredPlacement?: CardAbilityPopoverPlacement;
}

export interface CardAbilityPopoverLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  placement: Exclude<CardAbilityPopoverPlacement, 'auto'>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export const CARD_ABILITY_LONG_PRESS_MS = 520;

export function resolveCardAbilityPopoverLayout(
  input: CardAbilityPopoverLayoutInput,
): CardAbilityPopoverLayout {
  const cardWidth = Math.max(1, input.cardWidth);
  const cardHeight = Math.max(1, input.cardHeight);
  const viewportWidth = Math.max(240, input.viewportWidth);
  const viewportHeight = Math.max(320, input.viewportHeight);
  const sideMargin = 12;
  const width = Math.min(
    Math.max(210, cardWidth * 1.18),
    360,
    viewportWidth - sideMargin * 2,
  );
  const height = clamp(92 + cardWidth * 0.08, 98, 118);
  const gap = clamp(cardWidth * 0.035, 8, 14);
  const belowSpace = viewportHeight - (input.globalCenterY + cardHeight / 2);
  const aboveSpace = input.globalCenterY - cardHeight / 2;
  const belowFits = belowSpace >= height + gap + sideMargin;
  const aboveFits = aboveSpace >= height + gap + sideMargin;
  const preferred = input.preferredPlacement ?? 'auto';
  const placement: CardAbilityPopoverLayout['placement'] = preferred === 'above'
    ? 'above'
    : preferred === 'below'
      ? 'below'
      : belowFits || !aboveFits && belowSpace >= aboveSpace
        ? 'below'
        : 'above';

  const desiredGlobalLeft = input.globalCenterX - width / 2;
  const globalLeft = clamp(
    desiredGlobalLeft,
    sideMargin,
    Math.max(sideMargin, viewportWidth - width - sideMargin),
  );
  const horizontalCorrection = globalLeft - desiredGlobalLeft;

  return {
    x: (cardWidth - width) / 2 + horizontalCorrection,
    y: placement === 'below' ? cardHeight + gap : -height - gap,
    width,
    height,
    placement,
  };
}
