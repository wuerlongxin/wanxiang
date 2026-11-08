import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Texture } from 'pixi.js';

import {
  createLocalTextureLoader,
  normalizeLocalTextureSource,
  type LocalTextureRuntime,
} from '../src/services/local-texture.ts';

function createRuntime(
  overrides: Partial<LocalTextureRuntime> = {},
): LocalTextureRuntime {
  return {
    isTauri: () => false,
    loadWithAssets: async () => Texture.EMPTY,
    createImage: () => {
      throw new Error('native Image path should not be used');
    },
    textureFromImage: () => {
      throw new Error('native Image path should not be used');
    },
    ...overrides,
  };
}

function createLoadedImage(
  loadedSources: string[],
  crossOriginAccesses?: { reads: number; writes: number },
): HTMLImageElement {
  const image = {
    onload: null,
    onerror: null,
  } as unknown as HTMLImageElement;
  let currentSource = '';

  Object.defineProperty(image, 'src', {
    configurable: true,
    get: () => currentSource,
    set: (value: string) => {
      currentSource = value;
      loadedSources.push(value);
      queueMicrotask(() => image.onload?.(new Event('load')));
    },
  });
  if (crossOriginAccesses) {
    Object.defineProperty(image, 'crossOrigin', {
      configurable: true,
      get: () => {
        crossOriginAccesses.reads += 1;
        return null;
      },
      set: () => {
        crossOriginAccesses.writes += 1;
      },
    });
  }
  return image;
}

test('normalizes equivalent local asset paths and preserves other URL forms', () => {
  assert.equal(normalizeLocalTextureSource('assets/cards/a.png'), '/assets/cards/a.png');
  assert.equal(normalizeLocalTextureSource('./assets/cards/a.png'), '/assets/cards/a.png');
  assert.equal(normalizeLocalTextureSource('/assets/cards/a.png'), '/assets/cards/a.png');
  assert.equal(normalizeLocalTextureSource('data:image/png;base64,AA=='), 'data:image/png;base64,AA==');
  assert.equal(normalizeLocalTextureSource('blob:https://example.test/id'), 'blob:https://example.test/id');
  assert.equal(normalizeLocalTextureSource('https://example.test/a.png'), 'https://example.test/a.png');
});

test('browser path keeps Pixi Assets loading and receives the normalized source', async () => {
  const sources: string[] = [];
  const expected = Texture.EMPTY;
  const loader = createLocalTextureLoader(createRuntime({
    loadWithAssets: async (source) => {
      sources.push(source);
      return expected;
    },
  }));

  assert.equal(await loader('./assets/ui/paper.jpg'), expected);
  assert.deepEqual(sources, ['/assets/ui/paper.jpg']);
});

test('Tauri path decodes through native Image without touching crossOrigin', async () => {
  const loadedSources: string[] = [];
  const crossOriginAccesses = { reads: 0, writes: 0 };
  const image = createLoadedImage(loadedSources, crossOriginAccesses);
  const expected = Texture.EMPTY;
  let receivedImage: HTMLImageElement | undefined;
  let assetsCalls = 0;
  const loader = createLocalTextureLoader(createRuntime({
    isTauri: () => true,
    loadWithAssets: async () => {
      assetsCalls += 1;
      return Texture.EMPTY;
    },
    createImage: () => image,
    textureFromImage: (value) => {
      receivedImage = value;
      return expected;
    },
  }));

  assert.equal(await loader('assets/ui/paper.jpg'), expected);
  assert.equal(receivedImage, image);
  assert.deepEqual(loadedSources, ['/assets/ui/paper.jpg']);
  assert.equal(assetsCalls, 0);
  assert.deepEqual(crossOriginAccesses, { reads: 0, writes: 0 });
});

test('equivalent local paths share one in-flight request', async () => {
  let resolveRequest: ((texture: Texture) => void) | undefined;
  let callCount = 0;
  const loader = createLocalTextureLoader(createRuntime({
    loadWithAssets: () => {
      callCount += 1;
      return new Promise<Texture>((resolve) => {
        resolveRequest = resolve;
      });
    },
  }));

  const first = loader('assets/ui/paper.jpg');
  const second = loader('./assets/ui/paper.jpg');
  assert.equal(first, second);
  assert.equal(callCount, 1);
  resolveRequest?.(Texture.EMPTY);
  await first;
  assert.equal(await loader('/assets/ui/paper.jpg'), Texture.EMPTY);
  assert.equal(callCount, 1);
});

test('a failed request is evicted so a later attempt can retry', async () => {
  let callCount = 0;
  const loader = createLocalTextureLoader(createRuntime({
    loadWithAssets: async () => {
      callCount += 1;
      if (callCount === 1) throw new Error('decode failed');
      return Texture.EMPTY;
    },
  }));

  await assert.rejects(loader('/assets/ui/paper.jpg'), /decode failed/u);
  assert.equal(await loader('/assets/ui/paper.jpg'), Texture.EMPTY);
  assert.equal(callCount, 2);
});

test('a destroyed cached texture is evicted and decoded again', async () => {
  const first = { destroyed: false } as Texture;
  const second = { destroyed: false } as Texture;
  let callCount = 0;
  const loader = createLocalTextureLoader(createRuntime({
    loadWithAssets: async () => {
      callCount += 1;
      return callCount === 1 ? first : second;
    },
  }));

  assert.equal(await loader('/assets/ui/paper.jpg'), first);
  first.destroyed = true;
  assert.equal(await loader('/assets/ui/paper.jpg'), second);
  assert.equal(callCount, 2);
});

test('all Pixi runtime texture call sites use the shared loader', () => {
  const files = [
    '../src/background.ts',
    '../src/card-view.ts',
    '../src/chrome.ts',
    '../src/ui.ts',
    '../src/scenes/showcase.ts',
  ];

  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import \{ loadLocalTexture \} from ['"][^'"]+local-texture['"]/u, file);
    assert.match(source, /loadLocalTexture\(/u, file);
    assert.doesNotMatch(source, /Assets\.load<Texture>/u, file);
  }
});

test('shared eastern materials retry after a failed load and never bind destroyed cache entries', () => {
  const source = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /easternMaterialRequests\.get\(kind\) === request[\s\S]*easternMaterialRequests\.delete\(kind\)/u,
  );
  assert.match(
    source,
    /cached && !cached\.destroyed \? cached : Texture\.EMPTY/u,
  );
});

test('PDF export keeps its independent native image preflight path', () => {
  const source = readFileSync(new URL('../src/services/export-pdf.ts', import.meta.url), 'utf8');
  assert.match(source, /new Image\(\)/u);
  assert.doesNotMatch(source, /local-texture|loadLocalTexture/u);
});
