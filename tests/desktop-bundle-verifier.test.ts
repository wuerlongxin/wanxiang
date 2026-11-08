import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';

import {
  BUNDLED_NOTICE_FILES,
  FOGRA39L_ICC_SHA256,
  FOGRA39L_ICC_SOURCE_PATH,
  MAX_STARTUP_TEXTURE_DECODE_BYTES,
  STARTUP_TEXTURE_ASSETS,
  collectLocalRuntimeImageReferences,
  collectDistRuntimeAssets,
  collectEntryAssets,
  containsCredentialMaterial,
  extractEntryAsset,
  findRendererRuntimeAssets,
  findUnsupportedRuntimeImageReferences,
  missingEmbeddedAssets,
  missingEmbeddedImagePayloads,
  verifyBundledIccProfile,
  verifyBundledNotices,
  verifyDistRuntimeImages,
  verifyIccProfileFile,
  verifyRuntimeImageHeader,
  verifyRuntimeSourceImages,
  verifyStartupTextureBudget,
  unexpectedEmbeddedEntryAssets,
} from '../scripts/verify-desktop-bundle.mjs';

function validPngBytes(seed = 0): Buffer {
  const bytes = Buffer.alloc(40, seed);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(2, 16);
  bytes.writeUInt32BE(3, 20);
  return bytes;
}

function validJpegBytes(seed = 0, width = 2, height = 3): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, seed, seed,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

test('extracts the exact hashed Vite entry from the built index', () => {
  assert.equal(
    extractEntryAsset('<script type="module" src="/assets/index-Ab_19-x.js"></script>'),
    'assets/index-Ab_19-x.js',
  );
  assert.equal(
    extractEntryAsset('<script type="module" src="./assets/index-Relative_2.js"></script>'),
    'assets/index-Relative_2.js',
  );
  assert.throws(() => extractEntryAsset('<script src="/assets/main.js"></script>'));
});

test('collects unique embedded entry assets without accepting unrelated chunks', () => {
  assert.deepEqual(
    collectEntryAssets('assets/index-old.js assets/index-new_2.js assets/index-old.js index.es-other.js'),
    ['assets/index-new_2.js', 'assets/index-old.js'],
  );
  assert.deepEqual(
    unexpectedEmbeddedEntryAssets(
      'assets/index-entry.js assets/index-pixi.js assets/index-stale.js',
      ['assets/index-entry.js', 'assets/index-pixi.js'],
    ),
    ['assets/index-stale.js'],
  );
});

test('finds WebGL and Canvas renderer code even when Vite combines both in one chunk', () => {
  const root = mkdtempSync(join(tmpdir(), 'wanxiang-deck-renderer-assets-'));
  try {
    const combinedPath = join(root, 'index-renderers.js');
    writeFileSync(combinedPath, 'export { WebGLRenderer, CanvasRenderer };');
    assert.deepEqual(findRendererRuntimeAssets(root), {
      webgl: ['assets/index-renderers.js'],
      canvas: ['assets/index-renderers.js'],
      assets: ['assets/index-renderers.js'],
    });

    writeFileSync(combinedPath, 'export { WebGLRenderer };');
    assert.throws(() => findRendererRuntimeAssets(root), /缺少 Pixi CanvasRenderer/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('credential scan detects provider tokens and private keys without flagging ordinary labels', () => {
  assert.equal(containsCredentialMaterial('OPENAI_API_KEY is configured at runtime'), false);
  assert.equal(containsCredentialMaterial('sk-example_token_material_1234567890'), true);
  assert.equal(containsCredentialMaterial('-----BEGIN PRIVATE KEY-----'), true);
});

test('collects every nested dist resource for package verification', () => {
  const root = mkdtempSync(join(tmpdir(), 'wanxiang-deck-dist-assets-'));
  try {
    const files = [
      'index.html',
      'assets/index-build.js',
      'assets/fonts/local.woff2',
      'assets/cards/starter/card.webp',
    ];
    for (const file of files) {
      const path = join(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file);
    }
    assert.deepEqual(collectDistRuntimeAssets(root), files.sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('extracts local runtime image references and rejects WebP or AVIF references', () => {
  const source = [
    'const card = "/assets/cards/reflex.png?revision=2";',
    'const texture = "./assets/ui/lacquer.jpg#foil";',
    'const duplicate = "/assets/cards/reflex.png";',
    'const packaged = "assets/card-back.png";',
  ].join('\n');
  assert.deepEqual(collectLocalRuntimeImageReferences(source), [
    'assets/cards/reflex.png',
    'assets/ui/lacquer.jpg',
  ]);
  assert.deepEqual(
    findUnsupportedRuntimeImageReferences('a.webp assets/card-back.webp /assets/cards/b.AVIF?x=1 https://example.test/c.webp'),
    ['assets/cards/b.AVIF'],
  );
  assert.deepEqual(
    findUnsupportedRuntimeImageReferences([
      'const dynamic = `/assets/cards/starter/${mode}-${index}.webp`;',
      'const remote = "https://example.test/assets/reference.webp";',
      'const migration = /^\\/assets\\/cards\\/.+\\.webp$/u;',
      'const imported = "data:image/webp;base64,AAAA";',
    ].join('\n')),
    ['assets/cards/starter/${mode}-${index}.webp'],
  );
});

test('validates image signatures instead of trusting file extensions', () => {
  const root = mkdtempSync(join(tmpdir(), 'wanxiang-deck-image-headers-'));
  try {
    const pngPath = join(root, 'card.png');
    const jpegPath = join(root, 'card.jpg');
    writeFileSync(pngPath, validPngBytes(0x12));
    writeFileSync(jpegPath, validJpegBytes(0x34));
    const pngResult = verifyRuntimeImageHeader(pngPath);
    const jpegResult = verifyRuntimeImageHeader(jpegPath);
    assert.deepEqual(
      { format: pngResult.format, width: pngResult.width, height: pngResult.height },
      { format: 'png', width: 2, height: 3 },
    );
    assert.deepEqual(
      { format: jpegResult.format, width: jpegResult.width, height: jpegResult.height },
      { format: 'jpeg', width: 2, height: 3 },
    );

    writeFileSync(pngPath, validJpegBytes(0x56));
    assert.throws(() => verifyRuntimeImageHeader(pngPath), /文件头与扩展名不一致/u);
    const webpPath = join(root, 'legacy.webp');
    writeFileSync(webpPath, Buffer.from('RIFF....WEBP'));
    assert.throws(() => verifyRuntimeImageHeader(webpPath), /WebKit 不稳定/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps the six startup textures inside a decoded RGBA memory budget', () => {
  const images = STARTUP_TEXTURE_ASSETS.map((relativePath) => {
    const path = resolve(new URL('../public', import.meta.url).pathname, relativePath);
    return { relativePath, ...verifyRuntimeImageHeader(path) };
  });
  const result = verifyStartupTextureBudget(images);
  assert.equal(result.assets.length, 6);
  assert.equal(result.decodedBytes, 12_529_920);
  assert.ok(result.decodedBytes < MAX_STARTUP_TEXTURE_DECODE_BYTES);

  const oversized = images.map((image, index) => (
    index === 0 ? { ...image, decodedBytes: MAX_STARTUP_TEXTURE_DECODE_BYTES } : image
  ));
  assert.throws(() => verifyStartupTextureBudget(oversized), /启动纹理解码预算超限/u);
});

test('verifies every dist image reference, format, and local file', () => {
  const root = mkdtempSync(join(tmpdir(), 'wanxiang-deck-dist-images-'));
  try {
    const files = new Map<string, Buffer | string>([
      ['index.html', '<img src="./assets/cards/card.png">'],
      ['assets/main.js', 'const table = "/assets/ui/table.jpg?local=1";'],
      ['assets/cards/card.png', validPngBytes(0x11)],
      ['assets/ui/table.jpg', validJpegBytes(0x22)],
    ]);
    for (const [file, content] of files) {
      const path = join(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }

    const result = verifyDistRuntimeImages(root);
    assert.deepEqual(result.formats, ['jpeg', 'png']);
    assert.deepEqual(result.references, [
      'assets/cards/card.png',
      'assets/ui/table.jpg',
    ]);
    assert.deepEqual(
      result.images.map((image) => image.relativePath),
      ['assets/cards/card.png', 'assets/ui/table.jpg'],
    );

    writeFileSync(join(root, 'assets/main.js'), 'const missing = "/assets/ui/missing.png";');
    assert.throws(() => verifyDistRuntimeImages(root), /本地图片引用不存在/u);
    writeFileSync(join(root, 'assets/main.js'), 'const legacy = "/assets/ui/legacy.webp";');
    assert.throws(() => verifyDistRuntimeImages(root), /运行代码仍引用 WebKit 不稳定图片/u);
    writeFileSync(join(root, 'assets/main.js'), 'export {};');
    writeFileSync(join(root, 'assets/ui/legacy.webp'), Buffer.from('RIFF....WEBP'));
    assert.throws(() => verifyDistRuntimeImages(root), /dist 仍包含 WebKit 不稳定图片/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifies runtime source image compatibility against the public asset tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'wanxiang-deck-source-images-'));
  try {
    const sourcePath = join(root, 'src');
    const indexPath = join(root, 'index.html');
    const publicPath = join(root, 'public');
    mkdirSync(sourcePath, { recursive: true });
    mkdirSync(join(publicPath, 'assets/cards'), { recursive: true });
    writeFileSync(indexPath, '<main></main>');
    writeFileSync(join(sourcePath, 'cards.ts'), 'export const art = "/assets/cards/card.png";');
    writeFileSync(join(publicPath, 'assets/cards/card.png'), validPngBytes(0x23));

    const result = verifyRuntimeSourceImages(sourcePath, indexPath, publicPath);
    assert.deepEqual(result.references, ['assets/cards/card.png']);

    writeFileSync(join(sourcePath, 'cards.ts'), 'export const art = "/assets/cards/card.webp";');
    assert.throws(() => verifyRuntimeSourceImages(sourcePath, indexPath, publicPath), /运行源码仍引用/u);
    writeFileSync(join(sourcePath, 'cards.ts'), 'export const art = "/assets/cards/missing.png";');
    assert.throws(() => verifyRuntimeSourceImages(sourcePath, indexPath, publicPath), /本地图片不存在/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires current image payload samples inside the packaged executable', () => {
  const root = mkdtempSync(join(tmpdir(), 'wanxiang-deck-embedded-images-'));
  try {
    const currentPath = join(root, 'current.png');
    const stalePath = join(root, 'stale.jpg');
    writeFileSync(currentPath, validPngBytes(0x2a));
    writeFileSync(stalePath, validJpegBytes(0x3b));
    const images = [
      { path: currentPath, relativePath: 'assets/current.png' },
      { path: stalePath, relativePath: 'assets/stale.jpg' },
    ];
    const compressedPng = brotliCompressSync(readFileSync(currentPath), {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
      },
    });
    const binary = Buffer.concat([
      Buffer.from('binary-prefix'),
      compressedPng,
      Buffer.from('binary-middle'),
      readFileSync(stalePath),
    ]);
    assert.deepEqual(missingEmbeddedImagePayloads(binary, images, 8), []);

    writeFileSync(currentPath, validPngBytes(0x6d));
    writeFileSync(stalePath, validJpegBytes(0x7c));
    assert.deepEqual(missingEmbeddedImagePayloads(binary, images, 8), [
      'assets/current.png',
      'assets/stale.jpg',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires every local static resource inside the packaged binary', () => {
  const required = [
    'assets/fonts/source-han-sans-cn-vf.woff2',
    'assets/fonts/source-han-serif-cn-vf.woff2',
    'assets/WebGLRenderer-build.js',
    'assets/CanvasRenderer-build.js',
  ];
  const embedded = [
    '/assets/fonts/source-han-sans-cn-vf.woff2',
    '/assets/fonts/source-han-serif-cn-vf.woff2',
    '/assets/WebGLRenderer-build.js',
    '/assets/CanvasRenderer-build.js',
  ].join('\n');

  assert.deepEqual(missingEmbeddedAssets(embedded, required), []);
  assert.deepEqual(
    missingEmbeddedAssets(embedded.replace('/assets/CanvasRenderer-build.js', ''), required),
    ['assets/CanvasRenderer-build.js'],
  );
});

test('pins the bundled FOGRA39L Coated ICC by format and SHA-256', () => {
  const sourceBytes = readFileSync(FOGRA39L_ICC_SOURCE_PATH);
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), FOGRA39L_ICC_SHA256);
  const result = verifyIccProfileFile(FOGRA39L_ICC_SOURCE_PATH);
  assert.equal(result.hash, FOGRA39L_ICC_SHA256);
  assert.equal(result.bytes, 121368);
});

test('finds the canonical ICC resource in an app and rejects a changed copy', () => {
  const root = mkdtempSync(join(tmpdir(), 'wanxiang-deck-icc-app-'));
  try {
    const canonicalPath = join(root, '万象卡域.app/Contents/Resources/color/FOGRA39L_coated.icc');
    mkdirSync(dirname(canonicalPath), { recursive: true });
    const sourceBytes = readFileSync(FOGRA39L_ICC_SOURCE_PATH);
    writeFileSync(canonicalPath, sourceBytes);
    const result = verifyBundledIccProfile(resolve(root, '万象卡域.app'));
    assert.equal(result.path, canonicalPath);
    assert.equal(result.hash, FOGRA39L_ICC_SHA256);

    const changed = Buffer.from(sourceBytes);
    changed[changed.length - 1] ^= 0xff;
    writeFileSync(canonicalPath, changed);
    assert.throws(
      () => verifyBundledIccProfile(resolve(root, '万象卡域.app')),
      /SHA-256 不一致/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts the legacy ICC resource path but never accepts a missing profile', () => {
  const root = mkdtempSync(join(tmpdir(), 'wanxiang-deck-icc-legacy-'));
  try {
    const appPath = join(root, '万象卡域.app');
    const legacyPath = join(appPath, 'Contents/Resources/resources/color/FOGRA39L_coated.icc');
    mkdirSync(dirname(legacyPath), { recursive: true });
    writeFileSync(legacyPath, readFileSync(FOGRA39L_ICC_SOURCE_PATH));
    assert.equal(verifyBundledIccProfile(appPath).path, legacyPath);
    rmSync(legacyPath);
    assert.throws(() => verifyBundledIccProfile(appPath), /缺少印刷 ICC/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires exact project and third-party license notices in the application bundle', () => {
  const root = mkdtempSync(join(tmpdir(), 'wanxiang-deck-notices-app-'));
  try {
    const appPath = join(root, '万象卡域.app');
    for (const notice of BUNDLED_NOTICE_FILES) {
      const bundledPath = join(appPath, notice.relativePath);
      mkdirSync(dirname(bundledPath), { recursive: true });
      writeFileSync(bundledPath, readFileSync(notice.sourcePath));
    }

    const results = verifyBundledNotices(appPath);
    assert.deepEqual(
      results.map((result) => result.relativePath),
      ['Contents/Resources/LICENSE', 'Contents/Resources/THIRD_PARTY_NOTICES.md'],
    );
    assert.ok(results.every((result) => result.bytes > 0));

    const thirdParty = BUNDLED_NOTICE_FILES[1];
    const thirdPartyPath = join(appPath, thirdParty.relativePath);
    writeFileSync(thirdPartyPath, Buffer.concat([
      readFileSync(thirdParty.sourcePath),
      Buffer.from('\nchanged\n'),
    ]));
    assert.throws(() => verifyBundledNotices(appPath), /第三方许可声明与仓库源文件不一致/u);

    writeFileSync(thirdPartyPath, readFileSync(thirdParty.sourcePath));
    rmSync(join(appPath, BUNDLED_NOTICE_FILES[0].relativePath));
    assert.throws(() => verifyBundledNotices(appPath), /项目 MIT License.*不存在/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
