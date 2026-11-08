import assert from 'node:assert/strict';
import test from 'node:test';

import {
  optimizeArtworkDataUrl,
  optimizeArtworkDataUrls,
} from '../src/services/artwork-optimization.ts';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII=';

type Restore = () => void;

function replaceGlobal(name: string, value: unknown): Restore {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  };
}

interface BrowserMockResult {
  canvas: { width: number; height: number };
  calls: {
    bitmap: number;
    close: number;
    drawImage: unknown[][];
    encode: unknown[][];
  };
  restore: Restore;
}

function installBrowserMock(
  sourceWidth: number,
  sourceHeight: number,
  encoded = 'data:image/webp;base64,b3B0aW1pemVk',
): BrowserMockResult {
  const calls = {
    bitmap: 0,
    close: 0,
    drawImage: [] as unknown[][],
    encode: [] as unknown[][],
  };
  const context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    clearRect: () => undefined,
    drawImage: (...args: unknown[]) => calls.drawImage.push(args),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => kind === '2d' ? context : null,
    toDataURL: (...args: unknown[]) => {
      calls.encode.push(args);
      return encoded;
    },
  };
  const bitmap = {
    width: sourceWidth,
    height: sourceHeight,
    close: () => {
      calls.close += 1;
    },
  };
  const restoreDocument = replaceGlobal('document', {
    createElement: (tag: string) => tag === 'canvas' ? canvas : {},
  });
  const restoreBitmap = replaceGlobal('createImageBitmap', async () => {
    calls.bitmap += 1;
    return bitmap;
  });

  return {
    canvas,
    calls,
    restore: () => {
      restoreBitmap();
      restoreDocument();
    },
  };
}

test('returns the original value when browser image primitives are unavailable', async () => {
  const restoreDocument = replaceGlobal('document', undefined);
  const restoreBitmap = replaceGlobal('createImageBitmap', undefined);
  try {
    assert.equal(await optimizeArtworkDataUrl(PNG_DATA_URL), PNG_DATA_URL);
  } finally {
    restoreBitmap();
    restoreDocument();
  }
});

test('rejects non-image and vector data URLs before decoding', async () => {
  const browser = installBrowserMock(1800, 1200);
  try {
    const text = 'data:text/plain;base64,aGVsbG8=';
    const svg = 'data:image/svg+xml;base64,PHN2Zy8+';
    assert.equal(await optimizeArtworkDataUrl(text), text);
    assert.equal(await optimizeArtworkDataUrl(svg), svg);
    assert.equal(await optimizeArtworkDataUrl('https://example.test/card.png'), 'https://example.test/card.png');
    assert.equal(browser.calls.bitmap, 0);
  } finally {
    browser.restore();
  }
});

test('fits landscape artwork proportionally and encodes WebP at quality 0.9', async () => {
  const browser = installBrowserMock(1800, 1200);
  try {
    const optimized = await optimizeArtworkDataUrl(PNG_DATA_URL);
    assert.match(optimized, /^data:image\/webp/u);
    assert.deepEqual(
      { width: browser.canvas.width, height: browser.canvas.height },
      { width: 900, height: 600 },
    );
    assert.deepEqual(browser.calls.encode, [['image/webp', 0.9]]);
    assert.deepEqual(browser.calls.drawImage[0]?.slice(1), [0, 0, 900, 600]);
    assert.equal(browser.calls.close, 1);
  } finally {
    browser.restore();
  }
});

test('prefers asynchronous WebP encoding when canvas toBlob is available', async () => {
  const browser = installBrowserMock(1800, 1200);
  const blobCalls: unknown[][] = [];
  const canvas = browser.canvas as typeof browser.canvas & {
    toBlob: (
      callback: (blob: Blob | null) => void,
      type?: string,
      quality?: number,
    ) => void;
  };
  canvas.toBlob = (callback, ...args) => {
    blobCalls.push(args);
    queueMicrotask(() => callback(new Blob(['optimized'], { type: 'image/webp' })));
  };
  class MockFileReader {
    error: Error | null = null;
    result: string | null = null;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;

    readAsDataURL(): void {
      this.result = 'data:image/webp;base64,YXN5bmM=';
      queueMicrotask(() => this.onload?.());
    }
  }
  const restoreFileReader = replaceGlobal('FileReader', MockFileReader);
  try {
    assert.equal(
      await optimizeArtworkDataUrl(PNG_DATA_URL),
      'data:image/webp;base64,YXN5bmM=',
    );
    assert.deepEqual(blobCalls, [['image/webp', 0.9]]);
    assert.deepEqual(browser.calls.encode, []);
  } finally {
    restoreFileReader();
    browser.restore();
  }
});

test('fits portrait artwork to both limits without stretching', async () => {
  const browser = installBrowserMock(1000, 2000);
  try {
    await optimizeArtworkDataUrl(PNG_DATA_URL);
    assert.deepEqual(
      { width: browser.canvas.width, height: browser.canvas.height },
      { width: 675, height: 1350 },
    );
    assert.equal(browser.canvas.width / browser.canvas.height, 1000 / 2000);
  } finally {
    browser.restore();
  }
});

test('cover-crops the supported portrait source to an exact 700x900 canvas without stretching', async () => {
  const browser = installBrowserMock(1024, 1536);
  try {
    await optimizeArtworkDataUrl(PNG_DATA_URL, {
      maxWidth: 700,
      maxHeight: 900,
      fit: 'cover',
      quality: 0.88,
    });
    assert.deepEqual(
      { width: browser.canvas.width, height: browser.canvas.height },
      { width: 700, height: 900 },
    );
    const [, sourceX, sourceY, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight] =
      browser.calls.drawImage[0] as [unknown, ...number[]];
    assert.equal(sourceX, 0);
    assert.ok(Math.abs(sourceY - 109.71428571428578) < 1e-9);
    assert.equal(sourceWidth, 1024);
    assert.ok(Math.abs(sourceHeight - 1316.5714285714284) < 1e-9);
    assert.deepEqual(
      [targetX, targetY, targetWidth, targetHeight],
      [0, 0, 700, 900],
    );
    assert.ok(Math.abs(targetWidth / sourceWidth - targetHeight / sourceHeight) < 1e-12);
  } finally {
    browser.restore();
  }
});

test('cover-crops landscape sources horizontally instead of deforming them', async () => {
  const browser = installBrowserMock(1800, 1200);
  try {
    await optimizeArtworkDataUrl(PNG_DATA_URL, {
      maxWidth: 700,
      maxHeight: 900,
      fit: 'cover',
    });
    const [, sourceX, sourceY, sourceWidth, sourceHeight, , , targetWidth, targetHeight] =
      browser.calls.drawImage[0] as [unknown, ...number[]];
    assert.ok(Math.abs(sourceX - 433.33333333333337) < 1e-9);
    assert.equal(sourceY, 0);
    assert.ok(Math.abs(sourceWidth - 933.3333333333333) < 1e-9);
    assert.equal(sourceHeight, 1200);
    assert.equal(targetWidth, 700);
    assert.equal(targetHeight, 900);
    assert.ok(Math.abs(targetWidth / sourceWidth - targetHeight / sourceHeight) < 1e-12);
  } finally {
    browser.restore();
  }
});

test('options can reduce bounds while never exceeding the storage-safe defaults', async () => {
  const browser = installBrowserMock(1800, 1200);
  try {
    await optimizeArtworkDataUrl(PNG_DATA_URL, {
      maxWidth: 4000,
      maxHeight: 500,
      quality: 4,
    });
    assert.deepEqual(
      { width: browser.canvas.width, height: browser.canvas.height },
      { width: 750, height: 500 },
    );
    assert.deepEqual(browser.calls.encode, [['image/webp', 1]]);
  } finally {
    browser.restore();
  }
});

test('falls back to the original when WebP encoding is unavailable', async () => {
  const browser = installBrowserMock(900, 1350, 'data:image/png;base64,c3RpbGwtcG5n');
  try {
    assert.equal(await optimizeArtworkDataUrl(PNG_DATA_URL), PNG_DATA_URL);
    assert.equal(browser.calls.close, 1);
  } finally {
    browser.restore();
  }
});

test('batch optimization preserves input order and fallback values', async () => {
  const browser = installBrowserMock(900, 1350);
  try {
    const text = 'data:text/plain;base64,aGVsbG8=';
    assert.deepEqual(await optimizeArtworkDataUrls([PNG_DATA_URL, text]), [
      'data:image/webp;base64,b3B0aW1pemVk',
      text,
    ]);
    assert.equal(browser.calls.bitmap, 1);
  } finally {
    browser.restore();
  }
});
