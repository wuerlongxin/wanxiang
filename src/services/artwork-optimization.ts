const DEFAULT_MAX_WIDTH = 900;
const DEFAULT_MAX_HEIGHT = 1350;
const DEFAULT_WEBP_QUALITY = 0.9;

const RASTER_IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export interface ArtworkOptimizationOptions {
  /** May lower, but never raise, the storage-safe default width. */
  maxWidth?: number;
  /** May lower, but never raise, the storage-safe default height. */
  maxHeight?: number;
  /** `cover` writes the exact target canvas and center-crops without stretching. */
  fit?: 'contain' | 'cover';
  /** WebP encoder quality between 0 and 1. */
  quality?: number;
}

interface ResolvedArtworkOptimizationOptions {
  maxWidth: number;
  maxHeight: number;
  fit: 'contain' | 'cover';
  quality: number;
}

function resolveMaximum(value: number | undefined, ceiling: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return ceiling;
  return Math.max(1, Math.min(ceiling, Math.floor(value)));
}

function resolveOptions(
  options: ArtworkOptimizationOptions | undefined,
): ResolvedArtworkOptimizationOptions {
  const requestedQuality = options?.quality;
  return {
    maxWidth: resolveMaximum(options?.maxWidth, DEFAULT_MAX_WIDTH),
    maxHeight: resolveMaximum(options?.maxHeight, DEFAULT_MAX_HEIGHT),
    fit: options?.fit === 'cover' ? 'cover' : 'contain',
    quality:
      requestedQuality === undefined || !Number.isFinite(requestedQuality)
        ? DEFAULT_WEBP_QUALITY
        : Math.max(0, Math.min(1, requestedQuality)),
  };
}

interface SourceCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function centeredCoverCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): SourceCrop {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    const width = sourceHeight * targetRatio;
    return { x: (sourceWidth - width) / 2, y: 0, width, height: sourceHeight };
  }
  const height = sourceWidth / targetRatio;
  return { x: 0, y: (sourceHeight - height) / 2, width: sourceWidth, height };
}

function rasterMimeType(dataUrl: string): string | null {
  if (!dataUrl.startsWith('data:')) return null;
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return null;

  const metadata = dataUrl.slice(5, commaIndex);
  const semicolonIndex = metadata.indexOf(';');
  const mimeType = (semicolonIndex < 0
    ? metadata
    : metadata.slice(0, semicolonIndex)
  ).trim().toLowerCase();

  return RASTER_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : null;
}

function fittedDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } | null {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return null;
  }

  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: Math.min(maxWidth, Math.max(1, Math.round(sourceWidth * scale))),
    height: Math.min(maxHeight, Math.max(1, Math.round(sourceHeight * scale))),
  };
}

/**
 * Re-encodes browser artwork as a bounded WebP data URL. Any unsupported or
 * unsuccessful path is deliberately lossless from the caller's perspective:
 * the original string is returned unchanged.
 */
export async function optimizeArtworkDataUrl(
  dataUrl: string,
  options?: ArtworkOptimizationOptions,
): Promise<string> {
  const mimeType = rasterMimeType(dataUrl);
  if (!mimeType) return dataUrl;
  if (
    typeof document === 'undefined' ||
    typeof globalThis.createImageBitmap !== 'function' ||
    typeof globalThis.fetch !== 'function'
  ) {
    return dataUrl;
  }

  let bitmap: ImageBitmap | undefined;
  try {
    const response = await globalThis.fetch(dataUrl);
    if (!response.ok) return dataUrl;
    const sourceBlob = await response.blob();
    if (sourceBlob.size === 0) return dataUrl;

    bitmap = await globalThis.createImageBitmap(sourceBlob);
    const resolved = resolveOptions(options);
    const containedDimensions = fittedDimensions(
      bitmap.width,
      bitmap.height,
      resolved.maxWidth,
      resolved.maxHeight,
    );
    if (!containedDimensions) return dataUrl;
    const dimensions = resolved.fit === 'cover'
      ? { width: resolved.maxWidth, height: resolved.maxHeight }
      : containedDimensions;

    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) return dataUrl;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.clearRect(0, 0, dimensions.width, dimensions.height);
    if (resolved.fit === 'cover') {
      const crop = centeredCoverCrop(
        bitmap.width,
        bitmap.height,
        dimensions.width,
        dimensions.height,
      );
      context.drawImage(
        bitmap,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        dimensions.width,
        dimensions.height,
      );
    } else {
      context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    }

    let optimized: string;
    if (typeof canvas.toBlob === 'function' && typeof globalThis.FileReader === 'function') {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/webp', resolved.quality);
      });
      if (!blob || blob.type !== 'image/webp') return dataUrl;
      optimized = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('Artwork encoding failed.'));
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.readAsDataURL(blob);
      });
    } else if (typeof canvas.toDataURL === 'function') {
      optimized = canvas.toDataURL('image/webp', resolved.quality);
    } else {
      return dataUrl;
    }
    return /^data:image\/webp(?:;|,)/i.test(optimized) ? optimized : dataUrl;
  } catch {
    return dataUrl;
  } finally {
    bitmap?.close();
  }
}

/** Optimizes sequentially to avoid holding several decoded full-size images. */
export async function optimizeArtworkDataUrls(
  dataUrls: readonly string[],
  options?: ArtworkOptimizationOptions,
): Promise<string[]> {
  const optimized: string[] = [];
  for (const dataUrl of dataUrls) {
    optimized.push(await optimizeArtworkDataUrl(dataUrl, options));
  }
  return optimized;
}
