import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TAURI_CONFIG_PATH = resolve(PROJECT_ROOT, 'src-tauri/tauri.conf.json');
const SOURCE_PATH = resolve(PROJECT_ROOT, 'src');
const SOURCE_INDEX_PATH = resolve(PROJECT_ROOT, 'index.html');
const PUBLIC_PATH = resolve(PROJECT_ROOT, 'public');
const DIST_INDEX_PATH = resolve(PROJECT_ROOT, 'dist/index.html');
const DIST_ASSETS_PATH = resolve(PROJECT_ROOT, 'dist/assets');
const EXEC_BUFFER_BYTES = 128 * 1024 * 1024;
const REQUIRED_LOCAL_FONTS = [
  'assets/fonts/source-han-sans-cn-vf.woff2',
  'assets/fonts/source-han-serif-cn-vf.woff2',
];
const RUNTIME_TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.ts',
  '.tsx',
]);
const RUNTIME_IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);
const WEBKIT_UNSAFE_IMAGE_EXTENSIONS = new Set(['.avif', '.webp']);
const EMBEDDED_IMAGE_SAMPLE_BYTES = 256;
export const MAX_STARTUP_TEXTURE_DECODE_BYTES = 13 * 1024 * 1024;
export const STARTUP_TEXTURE_ASSETS = [
  'assets/cards/expression.jpg',
  'assets/cards/memory.jpg',
  'assets/cards/mischief.jpg',
  'assets/cards/reflex.jpg',
  'assets/cards/strategy.jpg',
  'assets/ui/eastern-scroll-bg.jpg',
];
export const FOGRA39L_ICC_SHA256 = 'b35713ef7eff09349d4c3249e5f377736d06d8a2671c54712971a3546bf17c57';
export const FOGRA39L_ICC_SOURCE_PATH = resolve(
  PROJECT_ROOT,
  'src-tauri/resources/color/FOGRA39L_coated.icc',
);
const BUNDLED_ICC_PATHS = [
  'Contents/Resources/color/FOGRA39L_coated.icc',
  // Compatibility with bundles created before the explicit Tauri resource mapping.
  'Contents/Resources/resources/color/FOGRA39L_coated.icc',
];
export const BUNDLED_NOTICE_FILES = [
  {
    label: '项目 MIT License',
    sourcePath: resolve(PROJECT_ROOT, 'LICENSE'),
    relativePath: 'Contents/Resources/LICENSE',
  },
  {
    label: '第三方许可声明',
    sourcePath: resolve(PROJECT_ROOT, 'THIRD_PARTY_NOTICES.md'),
    relativePath: 'Contents/Resources/THIRD_PARTY_NOTICES.md',
  },
];

function command(commandName, args, options = {}) {
  return execFileSync(commandName, args, {
    encoding: 'utf8',
    maxBuffer: EXEC_BUFFER_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function requirePath(path, label) {
  if (!existsSync(path)) throw new Error(`${label}不存在：${path}`);
  return path;
}

export function extractEntryAsset(indexHtml) {
  const entry = indexHtml.match(
    /<script\b[^>]*\bsrc=["'](?:\.\/|\/)?(assets\/index-[^"']+\.js)["']/u,
  )?.[1];
  if (!entry) throw new Error('dist/index.html 未找到带哈希的前端入口脚本。');
  return entry;
}

export function collectEntryAssets(binaryStrings) {
  return [...new Set(binaryStrings.match(/assets\/index-[A-Za-z0-9_-]+\.js/gu) ?? [])].sort();
}

export function unexpectedEmbeddedEntryAssets(binaryStrings, requiredAssets) {
  const required = new Set(requiredAssets);
  return collectEntryAssets(binaryStrings).filter((asset) => !required.has(asset));
}

export function containsCredentialMaterial(binaryStrings) {
  return /sk-[A-Za-z0-9_-]{20,}/u.test(binaryStrings)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(binaryStrings);
}

export function missingEmbeddedAssets(binaryStrings, requiredAssets) {
  return requiredAssets.filter((asset) => !binaryStrings.includes(`/${asset}`));
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

export function findRendererRuntimeAssets(directory = DIST_ASSETS_PATH) {
  requirePath(directory, '前端渲染资源目录');
  const scripts = walkFiles(directory).filter((path) => normalizedExtension(path) === '.js');
  const webgl = scripts.filter((path) => /\bWebGLRenderer\b/u.test(readFileSync(path, 'utf8')));
  const canvas = scripts.filter((path) => /\bCanvasRenderer\b/u.test(readFileSync(path, 'utf8')));
  if (!webgl.length) throw new Error('dist 缺少 Pixi WebGLRenderer 运行代码。');
  if (!canvas.length) throw new Error('dist 缺少 Pixi CanvasRenderer 运行代码。');
  const toAssetPath = (path) => `assets/${relative(directory, path).split('\\').join('/')}`;
  return {
    webgl: webgl.map(toAssetPath).sort(),
    canvas: canvas.map(toAssetPath).sort(),
    assets: [...new Set([...webgl, ...canvas].map(toAssetPath))].sort(),
  };
}

function normalizedExtension(path) {
  return extname(path).toLowerCase();
}

export function findUnsupportedRuntimeImageReferences(source) {
  const references = new Set(
    collectLocalRuntimeImageReferences(source).filter((reference) => (
      WEBKIT_UNSAFE_IMAGE_EXTENSIONS.has(normalizedExtension(reference))
    )),
  );
  let quote = '';
  let start = -1;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (!quote) {
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
        start = index + 1;
      }
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character !== quote) continue;
    const value = source.slice(start, index);
    const matches = value.matchAll(
      /(?:^|[\s(=,:])((?:\/|\.\.\/|\.\/)assets\/[^\s"'`]*?\.(?:avif|webp))(?:[?#][^\s"'`]*)?/giu,
    );
    for (const match of matches) {
      references.add(match[1].replace(/^(?:\/|\.\/|\.\.\/)/u, ''));
    }
    quote = '';
    start = -1;
  }
  return [...references].sort();
}

export function collectLocalRuntimeImageReferences(source) {
  const matches = source.match(
    /(?<![-A-Za-z0-9.:_\/\\])(?:\/|\.\.\/|\.\/)assets\/[A-Za-z0-9@%_+.,~/-]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#][^\s"'`()<>]*)?/giu,
  ) ?? [];
  return [...new Set(matches.map((reference) => (
    reference
      .replace(/[?#].*$/u, '')
      .replace(/^(?:\/|\.\/|\.\.\/)/u, '')
  )))].sort();
}

function detectImageFormat(bytes) {
  if (
    bytes.length >= 24
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && bytes.toString('ascii', 12, 16) === 'IHDR'
    && bytes.readUInt32BE(16) > 0
    && bytes.readUInt32BE(20) > 0
  ) return 'png';
  if (
    bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
    && bytes[bytes.length - 2] === 0xff
    && bytes[bytes.length - 1] === 0xd9
  ) return 'jpeg';
  const gifHeader = bytes.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'gif';
  const textHeader = bytes.subarray(0, Math.min(bytes.length, 1024)).toString('utf8')
    .replace(/^\uFEFF/u, '')
    .trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/iu.test(textHeader)) return 'svg';
  return 'unknown';
}

function jpegDimensions(bytes) {
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (startOfFrame.has(marker) && segmentLength >= 7) {
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

export function readRasterDimensions(bytes, format = detectImageFormat(bytes)) {
  if (format === 'png' && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (format === 'gif' && bytes.length >= 10) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (format === 'jpeg') return jpegDimensions(bytes);
  return null;
}

export function verifyRuntimeImageHeader(path, label = path) {
  const extension = normalizedExtension(path);
  if (WEBKIT_UNSAFE_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`${label} 使用桌面 WebKit 不稳定的图片格式 ${extension}。`);
  }
  const expectedFormat = extension === '.jpg' || extension === '.jpeg'
    ? 'jpeg'
    : extension.slice(1);
  const bytes = readFileSync(path);
  const actualFormat = detectImageFormat(bytes);
  if (actualFormat !== expectedFormat) {
    throw new Error(`${label} 文件头与扩展名不一致：期望 ${expectedFormat}，实际 ${actualFormat}。`);
  }
  const dimensions = readRasterDimensions(bytes, actualFormat);
  if (actualFormat !== 'svg' && (!dimensions || dimensions.width <= 0 || dimensions.height <= 0)) {
    throw new Error(`${label}缺少可验证的正整数图片尺寸。`);
  }
  return {
    path,
    format: actualFormat,
    bytes: bytes.length,
    hash: createHash('sha256').update(bytes).digest('hex'),
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    decodedBytes: dimensions ? dimensions.width * dimensions.height * 4 : null,
  };
}

export function verifyStartupTextureBudget(
  images,
  requiredAssets = STARTUP_TEXTURE_ASSETS,
  maximumBytes = MAX_STARTUP_TEXTURE_DECODE_BYTES,
) {
  const byPath = new Map(images.map((image) => [image.relativePath, image]));
  const startupImages = requiredAssets.map((relativePath) => {
    const image = byPath.get(relativePath);
    if (!image) throw new Error(`启动场景缺少本地纹理：${relativePath}`);
    if (!Number.isSafeInteger(image.decodedBytes) || image.decodedBytes <= 0) {
      throw new Error(`启动纹理解码尺寸无法验证：${relativePath}`);
    }
    return image;
  });
  const decodedBytes = startupImages.reduce((total, image) => total + image.decodedBytes, 0);
  if (decodedBytes > maximumBytes) {
    throw new Error(`启动纹理解码预算超限：${decodedBytes} bytes，允许 ${maximumBytes} bytes。`);
  }
  return {
    assets: startupImages.map((image) => image.relativePath),
    decodedBytes,
    maximumBytes,
  };
}

export function verifyDistRuntimeImages(distPath = resolve(PROJECT_ROOT, 'dist')) {
  const runtimeAssets = collectDistRuntimeAssets(distPath);
  const unsupportedFiles = runtimeAssets.filter((path) => (
    WEBKIT_UNSAFE_IMAGE_EXTENSIONS.has(normalizedExtension(path))
  ));
  if (unsupportedFiles.length) {
    throw new Error(`dist 仍包含 WebKit 不稳定图片：${unsupportedFiles.join(', ')}`);
  }

  const references = new Set();
  const unsupportedReferences = new Set();
  for (const relativePath of runtimeAssets) {
    if (!RUNTIME_TEXT_EXTENSIONS.has(normalizedExtension(relativePath))) continue;
    const source = readFileSync(join(distPath, relativePath), 'utf8');
    for (const reference of collectLocalRuntimeImageReferences(source)) references.add(reference);
    for (const reference of findUnsupportedRuntimeImageReferences(source)) {
      unsupportedReferences.add(`${relativePath}: ${reference}`);
    }
  }
  if (unsupportedReferences.size) {
    throw new Error(`dist 运行代码仍引用 WebKit 不稳定图片：${[...unsupportedReferences].sort().join(', ')}`);
  }

  const missingReferences = [...references].filter((reference) => (
    !runtimeAssets.includes(reference)
  ));
  if (missingReferences.length) {
    throw new Error(`dist 本地图片引用不存在：${missingReferences.join(', ')}`);
  }

  const images = runtimeAssets
    .filter((path) => RUNTIME_IMAGE_EXTENSIONS.has(normalizedExtension(path)))
    .map((relativePath) => ({
      relativePath,
      ...verifyRuntimeImageHeader(join(distPath, relativePath), `dist/${relativePath}`),
    }));
  return {
    images,
    references: [...references].sort(),
    formats: [...new Set(images.map((image) => image.format))].sort(),
  };
}

function embeddedImageSamples(bytes, sampleBytes = EMBEDDED_IMAGE_SAMPLE_BYTES) {
  const size = Math.min(sampleBytes, bytes.length);
  if (!size) return [];
  const offsets = [
    0,
    Math.floor((bytes.length - size) / 3),
    Math.floor(((bytes.length - size) * 2) / 3),
    bytes.length - size,
  ];
  return [...new Set(offsets)].map((offset) => bytes.subarray(offset, offset + size));
}

export function missingEmbeddedImagePayloads(binaryBytes, images, sampleBytes) {
  return images.filter((image) => {
    const imageBytes = readFileSync(image.path);
    const containsSamples = (bytes) => embeddedImageSamples(bytes, sampleBytes).every((sample) => (
      binaryBytes.indexOf(sample) !== -1
    ));
    if (containsSamples(imageBytes)) return false;
    const brotliBytes = brotliCompressSync(imageBytes, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
      },
    });
    return !containsSamples(brotliBytes);
  }).map((image) => image.relativePath);
}

export function collectDistRuntimeAssets(distPath = resolve(PROJECT_ROOT, 'dist')) {
  requirePath(distPath, '前端静态资源目录');
  return walkFiles(distPath)
    .map((path) => relative(distPath, path).split('\\').join('/'))
    .sort();
}

export function verifyRuntimeSourceImages(
  sourcePath = SOURCE_PATH,
  indexPath = SOURCE_INDEX_PATH,
  publicPath = PUBLIC_PATH,
) {
  requirePath(sourcePath, '前端运行源码目录');
  requirePath(indexPath, '前端源码入口');
  requirePath(publicPath, '本地静态资源目录');
  const sourceFiles = [
    indexPath,
    ...walkFiles(sourcePath).filter((path) => (
      RUNTIME_TEXT_EXTENSIONS.has(normalizedExtension(path))
    )),
  ];
  const references = new Set();
  const unsupportedReferences = new Set();
  for (const path of sourceFiles) {
    const source = readFileSync(path, 'utf8');
    const sourceLabel = relative(PROJECT_ROOT, path).split('\\').join('/');
    for (const reference of collectLocalRuntimeImageReferences(source)) references.add(reference);
    for (const reference of findUnsupportedRuntimeImageReferences(source)) {
      unsupportedReferences.add(`${sourceLabel}: ${reference}`);
    }
  }
  if (unsupportedReferences.size) {
    throw new Error(`前端运行源码仍引用 WebKit 不稳定图片：${[...unsupportedReferences].sort().join(', ')}`);
  }
  const missingReferences = [...references].filter((reference) => (
    !existsSync(join(publicPath, reference))
  ));
  if (missingReferences.length) {
    throw new Error(`前端运行源码引用的本地图片不存在：${missingReferences.join(', ')}`);
  }
  return {
    files: sourceFiles.map((path) => relative(PROJECT_ROOT, path).split('\\').join('/')).sort(),
    references: [...references].sort(),
  };
}

function offlineRuntimeAssets() {
  for (const asset of REQUIRED_LOCAL_FONTS) {
    requirePath(resolve(PROJECT_ROOT, 'dist', asset), `本地字体 ${asset}`);
  }
  const requiredAssets = collectDistRuntimeAssets();
  const rendererAssets = findRendererRuntimeAssets();
  const keyAssets = [
    ...REQUIRED_LOCAL_FONTS,
    ...rendererAssets.assets,
  ];
  const missingKeyAssets = keyAssets.filter((asset) => !requiredAssets.includes(asset));
  if (missingKeyAssets.length) {
    throw new Error(`dist 缺少关键离线资源：${missingKeyAssets.join(', ')}`);
  }
  return requiredAssets;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertCmykPrinterIcc(bytes, label) {
  if (bytes.length < 128) throw new Error(`${label}不是完整的 ICC 配置。`);
  const declaredSize = bytes.readUInt32BE(0);
  if (declaredSize !== bytes.length) {
    throw new Error(`${label}声明长度 ${declaredSize} 与实际 ${bytes.length} 不一致。`);
  }
  if (bytes.toString('ascii', 12, 16) !== 'prtr') {
    throw new Error(`${label}不是打印输出设备 ICC。`);
  }
  if (bytes.toString('ascii', 16, 20) !== 'CMYK') {
    throw new Error(`${label}不是 CMYK ICC。`);
  }
  if (bytes.toString('ascii', 36, 40) !== 'acsp') {
    throw new Error(`${label}缺少 acsp 签名。`);
  }
}

export function verifyIccProfileFile(
  path,
  label = 'FOGRA39L Coated ICC',
  expectedHash = FOGRA39L_ICC_SHA256,
) {
  requirePath(path, label);
  const bytes = readFileSync(path);
  assertCmykPrinterIcc(bytes, label);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== expectedHash) {
    throw new Error(`${label} SHA-256 不一致：期望 ${expectedHash}，实际 ${actualHash}。`);
  }
  return { path, hash: actualHash, bytes: bytes.length };
}

export function verifyBundledIccProfile(appPath, expectedHash = FOGRA39L_ICC_SHA256) {
  const presentPaths = BUNDLED_ICC_PATHS
    .map((relativePath) => join(appPath, relativePath))
    .filter((path) => existsSync(path));
  if (!presentPaths.length) {
    throw new Error(`应用程序缺少印刷 ICC：${BUNDLED_ICC_PATHS.join(' 或 ')}`);
  }
  const verified = presentPaths.map((path) => verifyIccProfileFile(path, '应用内 FOGRA39L Coated ICC', expectedHash));
  const canonical = verified.find((result) => result.path.endsWith(BUNDLED_ICC_PATHS[0]));
  return canonical ?? verified[0];
}

export function verifyBundledNotices(appPath, noticeFiles = BUNDLED_NOTICE_FILES) {
  return noticeFiles.map(({ label, sourcePath, relativePath }) => {
    requirePath(sourcePath, `${label}源文件`);
    const bundledPath = requirePath(join(appPath, relativePath), `应用内${label}`);
    const sourceBytes = readFileSync(sourcePath);
    const bundledBytes = readFileSync(bundledPath);
    if (!sourceBytes.length) throw new Error(`${label}源文件为空。`);
    if (!sourceBytes.equals(bundledBytes)) {
      throw new Error(`应用内${label}与仓库源文件不一致。`);
    }
    return {
      label,
      sourcePath,
      bundledPath,
      relativePath,
      bytes: bundledBytes.length,
      hash: createHash('sha256').update(bundledBytes).digest('hex'),
    };
  });
}

function plistValue(plistPath, key) {
  return command('plutil', ['-extract', key, 'raw', '-o', '-', plistPath]);
}

function verifyEmbeddedEntry(binaryPath, expectedEntry, requiredAssets, images, label) {
  const binaryBytes = readFileSync(binaryPath);
  const strings = command('strings', [binaryPath]);
  const entries = collectEntryAssets(strings);
  if (!entries.includes(expectedEntry)) {
    throw new Error(`${label}仍内嵌旧前端资源：期望 ${expectedEntry}，实际 ${entries.join(', ') || '未找到入口'}`);
  }
  const unexpectedEntries = unexpectedEmbeddedEntryAssets(strings, requiredAssets);
  if (unexpectedEntries.length) {
    throw new Error(`${label}仍内嵌不属于当前 dist 的旧入口块：${unexpectedEntries.join(', ')}`);
  }
  if (containsCredentialMaterial(strings)) {
    throw new Error(`${label}发现疑似 API 密钥或私钥材料；为避免泄露，不输出匹配内容。`);
  }
  const missingAssets = missingEmbeddedAssets(strings, requiredAssets);
  if (missingAssets.length) {
    throw new Error(`${label}缺少本地运行资源：${missingAssets.join(', ')}`);
  }
  const missingImagePayloads = missingEmbeddedImagePayloads(binaryBytes, images);
  if (missingImagePayloads.length) {
    throw new Error(`${label}缺少最新本地图片内容：${missingImagePayloads.join(', ')}`);
  }
}

function verifyApp(
  appPath,
  expectedEntry,
  requiredAssets,
  images,
  expectedIdentifier,
  expectedVersion,
  expectedArch,
) {
  const plistPath = requirePath(join(appPath, 'Contents/Info.plist'), '应用 Info.plist');
  const binaryDirectory = requirePath(join(appPath, 'Contents/MacOS'), '应用可执行目录');
  const binaries = readdirSync(binaryDirectory).filter((name) => (
    statSync(join(binaryDirectory, name)).isFile()
  ));
  if (binaries.length !== 1) {
    throw new Error(`应用可执行文件数量异常：${binaries.length}`);
  }
  const binaryPath = join(binaryDirectory, binaries[0]);
  const identifier = plistValue(plistPath, 'CFBundleIdentifier');
  const version = plistValue(plistPath, 'CFBundleShortVersionString');
  if (identifier !== expectedIdentifier) {
    throw new Error(`应用标识不一致：期望 ${expectedIdentifier}，实际 ${identifier}`);
  }
  if (version !== expectedVersion) {
    throw new Error(`应用版本不一致：期望 ${expectedVersion}，实际 ${version}`);
  }
  const architecture = command('lipo', ['-archs', binaryPath]);
  if (!architecture.split(/\s+/u).includes(expectedArch)) {
    throw new Error(`应用架构不包含 ${expectedArch}：${architecture}`);
  }
  command('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  verifyEmbeddedEntry(binaryPath, expectedEntry, requiredAssets, images, '应用程序');
  const iccResult = verifyBundledIccProfile(appPath);
  const noticeResults = verifyBundledNotices(appPath);
  return {
    appPath,
    binaryPath,
    binaryHash: sha256(binaryPath),
    binaryBytes: statSync(binaryPath).size,
    identifier,
    version,
    architecture,
    iccPath: iccResult.path,
    iccHash: iccResult.hash,
    iccBytes: iccResult.bytes,
    noticeResults,
  };
}

function findMountedApp(mountPath, productName) {
  const preferred = join(mountPath, `${productName}.app`);
  if (existsSync(preferred)) return preferred;
  const candidate = readdirSync(mountPath).find((name) => name.endsWith('.app'));
  if (!candidate) throw new Error('DMG 中未找到应用程序。');
  return join(mountPath, candidate);
}

function verifyDmg(
  dmgPath,
  appResult,
  expectedEntry,
  requiredAssets,
  images,
  config,
  expectedArch,
) {
  command('hdiutil', ['verify', dmgPath]);
  const mountPath = mkdtempSync(join(tmpdir(), 'wanxiang-deck-dmg-'));
  let attached = false;
  try {
    command('hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-mountpoint',
      mountPath,
      dmgPath,
    ]);
    attached = true;
    const mountedApp = findMountedApp(mountPath, config.productName);
    const mountedResult = verifyApp(
      mountedApp,
      expectedEntry,
      requiredAssets,
      images,
      config.identifier,
      config.version,
      expectedArch,
    );
    if (mountedResult.binaryHash !== appResult.binaryHash) {
      throw new Error('DMG 内的应用与 bundle/macos 下的最新应用不一致。');
    }
    if (mountedResult.iccHash !== appResult.iccHash) {
      throw new Error('DMG 内的应用与 bundle/macos 下的 ICC 配置不一致。');
    }
    const mountedNoticeHashes = mountedResult.noticeResults.map((notice) => notice.hash);
    const appNoticeHashes = appResult.noticeResults.map((notice) => notice.hash);
    if (mountedNoticeHashes.join(',') !== appNoticeHashes.join(',')) {
      throw new Error('DMG 内的应用与 bundle/macos 下的许可声明不一致。');
    }
    return {
      dmgPath,
      dmgBytes: statSync(dmgPath).size,
      dmgHash: sha256(dmgPath),
      mountedBinaryHash: mountedResult.binaryHash,
      mountedIccPath: mountedResult.iccPath,
      mountedIccHash: mountedResult.iccHash,
      mountedNoticeResults: mountedResult.noticeResults,
    };
  } finally {
    if (attached) command('hdiutil', ['detach', mountPath]);
    rmSync(mountPath, { recursive: true, force: true });
  }
}

export function verifyDesktopBundle() {
  const config = JSON.parse(readFileSync(requirePath(TAURI_CONFIG_PATH, 'Tauri 配置'), 'utf8'));
  const runtimeSourceResult = verifyRuntimeSourceImages();
  const sourceIccResult = verifyIccProfileFile(FOGRA39L_ICC_SOURCE_PATH, '源 FOGRA39L Coated ICC');
  const expectedArch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const dmgArch = expectedArch === 'arm64' ? 'aarch64' : 'x64';
  const appPath = requirePath(
    resolve(PROJECT_ROOT, `src-tauri/target/release/bundle/macos/${config.productName}.app`),
    'macOS 应用包',
  );
  const dmgPath = requirePath(
    resolve(
      PROJECT_ROOT,
      `src-tauri/target/release/bundle/dmg/${config.productName}_${config.version}_${dmgArch}.dmg`,
    ),
    'DMG 安装包',
  );
  const expectedEntry = extractEntryAsset(
    readFileSync(requirePath(DIST_INDEX_PATH, '前端入口'), 'utf8'),
  );
  const runtimeImageResult = verifyDistRuntimeImages();
  const startupTextureResult = verifyStartupTextureBudget(runtimeImageResult.images);
  const requiredAssets = offlineRuntimeAssets();
  const appResult = verifyApp(
    appPath,
    expectedEntry,
    requiredAssets,
    runtimeImageResult.images,
    config.identifier,
    config.version,
    expectedArch,
  );
  if (statSync(appResult.binaryPath).mtimeMs < statSync(DIST_INDEX_PATH).mtimeMs) {
    throw new Error('应用可执行文件早于 dist/index.html，疑似尚未重新打包。');
  }
  const dmgResult = verifyDmg(
    dmgPath,
    appResult,
    expectedEntry,
    requiredAssets,
    runtimeImageResult.images,
    config,
    expectedArch,
  );
  return {
    expectedEntry,
    requiredAssets,
    runtimeImageResult,
    startupTextureResult,
    runtimeSourceResult,
    sourceIccResult,
    ...appResult,
    ...dmgResult,
  };
}

function printResult(result) {
  console.log('DESKTOP_BUNDLE_OK=1');
  console.log(`ENTRY_ASSET=${result.expectedEntry}`);
  console.log(`OFFLINE_RUNTIME_ASSET_COUNT=${result.requiredAssets.length}`);
  console.log(`OFFLINE_RUNTIME_ASSETS=${result.requiredAssets.join(',')}`);
  console.log(`RUNTIME_IMAGE_COUNT=${result.runtimeImageResult.images.length}`);
  console.log(`RUNTIME_IMAGE_FORMATS=${result.runtimeImageResult.formats.join(',')}`);
  console.log(`RUNTIME_IMAGE_REFERENCE_COUNT=${result.runtimeImageResult.references.length}`);
  console.log(`STARTUP_TEXTURE_COUNT=${result.startupTextureResult.assets.length}`);
  console.log(`STARTUP_TEXTURE_DECODE_BYTES=${result.startupTextureResult.decodedBytes}`);
  console.log(`STARTUP_TEXTURE_DECODE_LIMIT_BYTES=${result.startupTextureResult.maximumBytes}`);
  console.log(`RUNTIME_SOURCE_FILE_COUNT=${result.runtimeSourceResult.files.length}`);
  console.log(`RUNTIME_SOURCE_IMAGE_REFERENCE_COUNT=${result.runtimeSourceResult.references.length}`);
  console.log(`ARCHITECTURE=${result.architecture}`);
  console.log(`BUNDLE_IDENTIFIER=${result.identifier}`);
  console.log(`BUNDLE_VERSION=${result.version}`);
  console.log(`APP_BINARY_BYTES=${result.binaryBytes}`);
  console.log(`DMG_BYTES=${result.dmgBytes}`);
  console.log(`APP_BINARY_SHA256=${result.binaryHash}`);
  console.log(`DMG_SHA256=${result.dmgHash}`);
  console.log(`ICC_SOURCE_SHA256=${result.sourceIccResult.hash}`);
  console.log(`ICC_APP_SHA256=${result.iccHash}`);
  console.log(`ICC_DMG_SHA256=${result.mountedIccHash}`);
  console.log(`ICC_BYTES=${result.iccBytes}`);
  console.log(`BUNDLED_NOTICES=${result.noticeResults.map((notice) => notice.relativePath).join(',')}`);
  for (const notice of result.noticeResults) {
    console.log(`NOTICE_SHA256_${basename(notice.relativePath).replace(/[^A-Za-z0-9]/gu, '_').toUpperCase()}=${notice.hash}`);
  }
  console.log('CODE_SIGNATURE=valid');
  console.log('DMG_VERIFY=valid');
  console.log('CREDENTIAL_SCAN=clean');
  console.log('OFFLINE_RUNTIME=verified');
  console.log('RUNTIME_IMAGES=verified');
  console.log('STARTUP_TEXTURE_BUDGET=verified');
  console.log('RUNTIME_SOURCE_IMAGES=verified');
  console.log('EMBEDDED_IMAGE_PAYLOADS=verified');
  console.log('PRINT_ICC=verified');
  console.log('LICENSE_NOTICES=verified');
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) printResult(verifyDesktopBundle());
