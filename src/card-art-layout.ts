export const ARTWORK_COVER_OVERSCAN = 1.002;

/**
 * Shared face geometry for the full-art card treatment. Ratios are measured
 * against the finished card; badge radii are measured against card width.
 */
export const CARD_FACE_LAYOUT = {
  artwork: {
    x: 0.042,
    y: 0.068,
    width: 0.916,
    height: 0.89,
  },
  titlePlate: {
    x: 0.045,
    y: 0.022,
    width: 0.91,
    height: 0.112,
  },
  infoPanel: {
    x: 0.066,
    y: 0.77,
    width: 0.868,
    height: 0.118,
  },
  stats: {
    leftX: 0.13,
    rightX: 0.87,
    y: 0.93,
    radius: 0.043,
  },
  cost: {
    x: 0.875,
    y: 0.082,
    radius: 0.042,
  },
} as const;

export interface ArtworkCoverLayout {
  scale: number;
  renderedWidth: number;
  renderedHeight: number;
  cropRatioX: number;
  cropRatioY: number;
}

export function computeArtworkCoverLayout(
  frameWidth: number,
  frameHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  overscan = ARTWORK_COVER_OVERSCAN,
): ArtworkCoverLayout {
  if (
    !Number.isFinite(frameWidth) ||
    !Number.isFinite(frameHeight) ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return { scale: 0, renderedWidth: 0, renderedHeight: 0, cropRatioX: 0, cropRatioY: 0 };
  }

  const scale = Math.max(frameWidth / sourceWidth, frameHeight / sourceHeight) * Math.max(1, overscan);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  return {
    scale,
    renderedWidth,
    renderedHeight,
    cropRatioX: Math.max(0, (renderedWidth - frameWidth) / renderedWidth),
    cropRatioY: Math.max(0, (renderedHeight - frameHeight) / renderedHeight),
  };
}
