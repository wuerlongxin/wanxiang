import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

export const FOGRA39L_ICC_SHA256 = 'b35713ef7eff09349d4c3249e5f377736d06d8a2671c54712971a3546bf17c57';
export const PDFX4_LIMITATIONS_NOTICE =
  '此检查只验证本项目规定的 PDF/X-4 结构、CMYK 色彩对象与内嵌 ICC；不能替代 Adobe Acrobat Preflight、callas pdfToolbox、印厂软打样或实物打样认证。';

const MAX_PDF_BYTES = 1024 * 1024 * 1024;
const A4_WIDTH_POINTS = 595.276;
const A4_HEIGHT_POINTS = 841.89;
const A4_TOLERANCE_POINTS = 1.25;
const FULL_PAGE_IMAGE_WIDTH = 2480;
const FULL_PAGE_IMAGE_HEIGHT = 3508;
const FORBIDDEN_STRUCTURE_TOKENS = [
  '/Encrypt',
  '/AcroForm',
  '/Annots',
  '/Type /Annot',
  '/Subtype /Link',
  '/OpenAction',
  '/AdditionalActions',
  '/JavaScript',
  '/JS',
  '/AA',
  '/Launch',
  '/RichMedia',
  '/Movie',
  '/Sound',
  '/EmbeddedFiles',
  '/GoToR',
  '/SubmitForm',
  '/ImportData',
  '/URI',
];
const FORBIDDEN_RGB_NAMES = ['/DeviceRGB', '/DefaultRGB', '/CalRGB'];

function fail(message) {
  throw new Error(`PDF/X-4 验证失败：${message}`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('PDF 数据必须是 Buffer 或 Uint8Array。');
}

function parseObjects(pdfBytes) {
  const source = pdfBytes.toString('latin1');
  const headerPattern = /(?:^|[\r\n])(\d+)\s+(\d+)\s+obj\b/gu;
  const objects = new Map();
  let match;
  while ((match = headerPattern.exec(source)) !== null) {
    const number = Number(match[1]);
    const generation = Number(match[2]);
    const bodyStart = headerPattern.lastIndex;
    const firstEndObject = source.indexOf('endobj', bodyStart);
    if (firstEndObject < 0) fail(`对象 ${number} ${generation} 缺少 endobj。`);
    const streamPattern = /\bstream(?:\r\n|\n|\r)/gu;
    streamPattern.lastIndex = bodyStart;
    const streamMatch = streamPattern.exec(source);
    let bodyEnd = firstEndObject;
    let dictionary = source.slice(bodyStart, bodyEnd);
    let stream = null;
    if (streamMatch && streamMatch.index < firstEndObject) {
      dictionary = source.slice(bodyStart, streamMatch.index);
      const streamStart = streamPattern.lastIndex;
      const directLength = Number(dictionary.match(/\/Length\s+(\d+)\b/u)?.[1] ?? NaN);
      if (!Number.isSafeInteger(directLength) || directLength < 0) {
        fail(`对象 ${number} ${generation} 的流必须提供可验证的直接 Length。`);
      }
      const streamEnd = streamStart + directLength;
      if (streamEnd > pdfBytes.length) fail(`对象 ${number} ${generation} 的流超出文件边界。`);
      stream = pdfBytes.subarray(streamStart, streamEnd);
      const endStream = source.indexOf('endstream', streamEnd);
      if (endStream < streamEnd || endStream - streamEnd > 2) {
        fail(`对象 ${number} ${generation} 的流长度与 endstream 不一致。`);
      }
      bodyEnd = source.indexOf('endobj', endStream + 'endstream'.length);
      if (bodyEnd < 0) fail(`对象 ${number} ${generation} 的流后缺少 endobj。`);
    }
    const key = `${number} ${generation}`;
    if (objects.has(key)) fail(`对象 ${key} 重复。`);
    objects.set(key, { number, generation, dictionary, stream });
    headerPattern.lastIndex = bodyEnd + 'endobj'.length;
  }
  if (!objects.size) fail('没有找到可检查的间接对象。');
  return { source, objects };
}

function objectByReference(objects, number, generation = 0, label = '对象') {
  const object = objects.get(`${number} ${generation}`);
  if (!object) fail(`${label}引用了不存在的对象 ${number} ${generation} R。`);
  return object;
}

function referenceAfter(text, key) {
  const match = text.match(new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R\\b`, 'u'));
  return match ? { number: Number(match[1]), generation: Number(match[2]) } : null;
}

function referencesAfter(text, key) {
  const section = text.match(new RegExp(`/${key}\\s*(?:\\[([^\\]]*)\\]|(\\d+\\s+\\d+\\s+R))`, 'u'));
  if (!section) return [];
  const references = [];
  for (const match of (section[1] ?? section[2] ?? '').matchAll(/(\d+)\s+(\d+)\s+R\b/gu)) {
    references.push({ number: Number(match[1]), generation: Number(match[2]) });
  }
  return references;
}

function filtersFor(object) {
  const filter = object.dictionary.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/u)?.[1] ?? '';
  return [...filter.matchAll(/\/([A-Za-z0-9]+)/gu)].map((match) => match[1]);
}

function decodedStream(object, label, allowOpaqueImage = false) {
  if (!object.stream) fail(`${label}缺少数据流。`);
  const filters = filtersFor(object);
  let bytes = object.stream;
  for (const filter of filters) {
    if (filter === 'FlateDecode' || filter === 'Fl') {
      try {
        bytes = inflateSync(bytes);
      } catch {
        fail(`${label}的 Flate 数据无法解压。`);
      }
      continue;
    }
    if (allowOpaqueImage && (filter === 'DCTDecode' || filter === 'JPXDecode')) return null;
    fail(`${label}使用了无法安全检查的 ${filter} 过滤器。`);
  }
  return bytes;
}

function hasType(dictionary, type) {
  return new RegExp(`/Type\\s*/${type}\\b`, 'u').test(dictionary);
}

function parseBox(dictionary, name) {
  const match = dictionary.match(new RegExp(`/${name}\\s*\\[([^\\]]+)\\]`, 'u'));
  if (!match) return null;
  const values = match[1].trim().split(/\s+/u).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    fail(`${name} 页面框不是四个有效数值。`);
  }
  return values;
}

function dimensions(box) {
  return { width: Math.abs(box[2] - box[0]), height: Math.abs(box[3] - box[1]) };
}

function isA4(box) {
  const { width, height } = dimensions(box);
  return Math.abs(width - A4_WIDTH_POINTS) <= A4_TOLERANCE_POINTS
    && Math.abs(height - A4_HEIGHT_POINTS) <= A4_TOLERANCE_POINTS;
}

function containsBox(outer, inner) {
  const outerLeft = Math.min(outer[0], outer[2]);
  const outerBottom = Math.min(outer[1], outer[3]);
  const outerRight = Math.max(outer[0], outer[2]);
  const outerTop = Math.max(outer[1], outer[3]);
  const innerLeft = Math.min(inner[0], inner[2]);
  const innerBottom = Math.min(inner[1], inner[3]);
  const innerRight = Math.max(inner[0], inner[2]);
  const innerTop = Math.max(inner[1], inner[3]);
  const tolerance = 0.01;
  return outerLeft <= innerLeft + tolerance
    && outerBottom <= innerBottom + tolerance
    && outerRight + tolerance >= innerRight
    && outerTop + tolerance >= innerTop;
}

function sameBox(left, right) {
  const tolerance = 0.01;
  return left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}

function literalValue(dictionary, key) {
  const value = dictionary.match(new RegExp(`/${key}\\s*\\(([^)]*)\\)`, 'u'))?.[1] ?? '';
  return value.replace(/\\([()\\])/gu, '$1').trim();
}

function assertIccHeader(iccBytes) {
  if (iccBytes.length < 128) fail('内嵌 ICC 数据不足 128 字节。');
  const declaredSize = iccBytes.readUInt32BE(0);
  if (declaredSize !== iccBytes.length) fail(`ICC 声明长度 ${declaredSize} 与实际 ${iccBytes.length} 不一致。`);
  if (iccBytes.toString('ascii', 12, 16) !== 'prtr') fail('ICC 不是打印输出设备配置。');
  if (iccBytes.toString('ascii', 16, 20) !== 'CMYK') fail('ICC 色彩空间不是 CMYK。');
  if (iccBytes.toString('ascii', 36, 40) !== 'acsp') fail('ICC 缺少 acsp 签名。');
}

function iccReferenceFromColorSpace(definition) {
  const match = definition.match(/\/ICCBased\s+(\d+)\s+(\d+)\s+R\b/u);
  return match ? { number: Number(match[1]), generation: Number(match[2]) } : null;
}

function sameReference(left, right) {
  return left.number === right.number && left.generation === right.generation;
}

function imageColorSpaceDefinition(image, objects) {
  const directName = image.dictionary.match(/\/ColorSpace\s+(\/[A-Za-z0-9]+)\b/u)?.[1];
  if (directName) return directName;
  const directArray = image.dictionary.match(/\/ColorSpace\s*(\[[^\]]+\])/u)?.[1];
  if (directArray) return directArray;
  const reference = referenceAfter(image.dictionary, 'ColorSpace');
  if (reference) return objectByReference(objects, reference.number, reference.generation, '图像色彩空间').dictionary;
  fail(`图像对象 ${image.number} ${image.generation} 没有可验证的 ColorSpace。`);
}

function assertCmykColorSpace(
  definition,
  objects,
  label,
  destinationProfileReference,
  destinationProfileHash,
) {
  if (/\/DeviceCMYK\b/u.test(definition)) return { kind: 'DeviceCMYK', profileReference: null };
  const reference = iccReferenceFromColorSpace(definition);
  if (!reference) fail(`${label}不是 DeviceCMYK 或 ICCBased CMYK。`);
  const profile = objectByReference(objects, reference.number, reference.generation, `${label} ICC`);
  if (!/\/N\s+4\b/u.test(profile.dictionary)) fail(`${label}引用的 ICC 不是四通道。`);
  if (!sameReference(reference, destinationProfileReference)) {
    const profileBytes = decodedStream(profile, `${label} ICC`);
    assertIccHeader(profileBytes);
    if (sha256(profileBytes) !== destinationProfileHash) {
      fail(`${label}的 ICCBased 配置与 DestOutputProfile 不同。`);
    }
  }
  return { kind: 'ICCBased', profileReference: reference };
}

function assertNoRgbOperators(content, label) {
  const text = content.toString('latin1');
  if (FORBIDDEN_RGB_NAMES.some((token) => text.includes(token))) fail(`${label}引用了 RGB 色彩空间。`);
  if (/(?:^|\s)(?:[+-]?(?:\d+\.?\d*|\.\d+)\s+){3}(?:rg|RG)(?=\s|$)/u.test(text)) {
    fail(`${label}包含 DeviceRGB 的 rg/RG 绘制操作。`);
  }
}

function integerAfter(dictionary, key, label) {
  const value = Number(dictionary.match(new RegExp(`/${key}\\s+(\\d+)\\b`, 'u'))?.[1] ?? NaN);
  if (!Number.isSafeInteger(value)) fail(`${label}缺少有效的 ${key}。`);
  return value;
}

function pageXObjectReferences(page, label) {
  const section = page.dictionary.match(/\/XObject\s*<<([\s\S]*?)>>/u)?.[1] ?? '';
  const references = [];
  for (const match of section.matchAll(/\/([^\s/<>()\[\]]+)\s+(\d+)\s+(\d+)\s+R\b/gu)) {
    references.push({ name: match[1], number: Number(match[2]), generation: Number(match[3]) });
  }
  if (!references.length) fail(`${label}没有直接声明可检查的 XObject。`);
  return references;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function assertFullPageImageInvocation(content, imageName, pageNumber) {
  const number = '([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))';
  const pattern = new RegExp(
    `${number}\\s+${number}\\s+${number}\\s+${number}\\s+${number}\\s+${number}`
      + `\\s+cm\\s*/${escapeRegex(imageName)}\\s+Do\\b`,
    'gu',
  );
  const matches = [...content.matchAll(pattern)];
  if (!matches.length) {
    fail(`第 ${pageNumber} 页没有用可验证的 A4 矩阵绘制全页图像 /${imageName}。`);
  }
  const valid = matches.some((match) => {
    const [a, b, c, d, e, f] = match.slice(1, 7).map(Number);
    const tolerance = 0.05;
    return Math.abs(a - A4_WIDTH_POINTS) <= tolerance
      && Math.abs(b) <= tolerance
      && Math.abs(c) <= tolerance
      && Math.abs(d - A4_HEIGHT_POINTS) <= tolerance
      && Math.abs(e) <= tolerance
      && Math.abs(f) <= tolerance;
  });
  if (!valid) fail(`第 ${pageNumber} 页的 /${imageName} 没有铺满纵向 A4 页面。`);
}

export function inspectPdfX4Buffer(value, options = {}) {
  const pdfBytes = asBuffer(value);
  if (!pdfBytes.length || pdfBytes.length > (options.maxBytes ?? MAX_PDF_BYTES)) {
    fail(`文件大小必须在 1 字节至 ${options.maxBytes ?? MAX_PDF_BYTES} 字节之间。`);
  }
  const header = pdfBytes.subarray(0, 16).toString('ascii').match(/^%PDF-(\d+\.\d+)/u)?.[1];
  if (header !== '1.6') fail(`PDF 版本必须是 1.6，实际为 ${header ?? '未知'}。`);

  const { source, objects } = parseObjects(pdfBytes);
  const dictionaries = [...objects.values()].map((object) => object.dictionary).join('\n');
  if (/\/Type\s*\/ObjStm\b/u.test(dictionaries)) {
    fail('文件包含对象流，当前发布检查无法证明其中没有 RGB 或交互对象。');
  }
  for (const token of FORBIDDEN_STRUCTURE_TOKENS) {
    if (dictionaries.includes(token) || source.slice(Math.max(0, source.lastIndexOf('endobj'))).includes(token)) {
      fail(`发现禁止的加密或交互结构 ${token}。`);
    }
  }
  for (const token of FORBIDDEN_RGB_NAMES) {
    if (dictionaries.includes(token)) fail(`发现禁止的 RGB 色彩空间 ${token}。`);
  }

  const catalog = [...objects.values()].find((object) => hasType(object.dictionary, 'Catalog'));
  if (!catalog) fail('缺少 Catalog。');
  const pagesReference = referenceAfter(catalog.dictionary, 'Pages');
  if (!pagesReference) fail('Catalog 缺少 Pages 引用。');
  const pagesRoot = objectByReference(objects, pagesReference.number, pagesReference.generation, 'Pages');
  if (!hasType(pagesRoot.dictionary, 'Pages')) fail('Catalog 的 Pages 引用不是页面树。');
  const outputIntentReferences = referencesAfter(catalog.dictionary, 'OutputIntents');
  if (outputIntentReferences.length !== 1) fail('Catalog 必须且只能引用一个 OutputIntent。');
  const outputIntentReference = outputIntentReferences[0];
  const outputIntent = objectByReference(
    objects,
    outputIntentReference.number,
    outputIntentReference.generation,
    'OutputIntent',
  );
  if (!hasType(outputIntent.dictionary, 'OutputIntent') || !/\/S\s*\/GTS_PDFX\b/u.test(outputIntent.dictionary)) {
    fail('OutputIntent 的 Type/S 不是 OutputIntent/GTS_PDFX。');
  }
  const outputConditionIdentifier = literalValue(outputIntent.dictionary, 'OutputConditionIdentifier');
  if (!outputConditionIdentifier) fail('OutputIntent 缺少 OutputConditionIdentifier。');
  const profileReference = referenceAfter(outputIntent.dictionary, 'DestOutputProfile');
  if (!profileReference) fail('OutputIntent 缺少 DestOutputProfile。');
  const profile = objectByReference(
    objects,
    profileReference.number,
    profileReference.generation,
    'DestOutputProfile',
  );
  if (!/\/N\s+4\b/u.test(profile.dictionary)) fail('DestOutputProfile 的 N 必须为 4。');
  const iccBytes = decodedStream(profile, 'DestOutputProfile');
  assertIccHeader(iccBytes);
  const iccSha256 = sha256(iccBytes);
  const expectedIccSha256 = options.expectedIccSha256 ?? FOGRA39L_ICC_SHA256;
  if (expectedIccSha256 && iccSha256 !== expectedIccSha256) {
    fail(`内嵌 ICC SHA-256 不一致：期望 ${expectedIccSha256}，实际 ${iccSha256}。`);
  }

  const infoReference = [...source.matchAll(/\/Info\s+(\d+)\s+(\d+)\s+R\b/gu)][0];
  if (!infoReference) fail('Trailer/XRef 缺少 Info 引用。');
  const info = objectByReference(objects, Number(infoReference[1]), Number(infoReference[2]), 'Info');
  if (!/\/GTS_PDFXVersion\s*\(PDF\/X-4\)/u.test(info.dictionary)) {
    fail('Info 缺少 GTS_PDFXVersion (PDF/X-4)。');
  }
  if (!/\/Trapped\s*\/(?:True|False|Unknown)\b/u.test(info.dictionary)) {
    fail('Info 缺少有效的 Trapped 标记。');
  }

  const metadataReference = referenceAfter(catalog.dictionary, 'Metadata');
  if (!metadataReference) fail('Catalog 缺少 XMP Metadata。');
  const metadata = objectByReference(
    objects,
    metadataReference.number,
    metadataReference.generation,
    'XMP Metadata',
  );
  if (!hasType(metadata.dictionary, 'Metadata') || !/\/Subtype\s*\/XML\b/u.test(metadata.dictionary)) {
    fail('Metadata 不是 XML 元数据流。');
  }
  const xmp = decodedStream(metadata, 'XMP Metadata').toString('utf8');
  const hasPdfXNamespace = xmp.includes('http://www.npes.org/pdfx/ns/id/')
    || xmp.includes('http://www.aiim.org/pdfx/ns/id/');
  if (!/<(?:\w+:)?xmpmeta\b/u.test(xmp) || !hasPdfXNamespace) {
    fail('XMP 缺少 xmpmeta 或 PDF/X ID 命名空间。');
  }
  const xmpPdfX4 = /pdfxid:GTS_PDFXVersion\s*=\s*["']PDF\/X-4["']/u.test(xmp)
    || /<pdfxid:GTS_PDFXVersion>\s*PDF\/X-4\s*<\/pdfxid:GTS_PDFXVersion>/u.test(xmp);
  if (!xmpPdfX4) fail('XMP 缺少 PDF/X-4 版本标识。');

  const pages = [...objects.values()].filter((object) => hasType(object.dictionary, 'Page'));
  if (!pages.length) fail('PDF 没有页面。');
  const declaredPageCount = integerAfter(pagesRoot.dictionary, 'Count', 'Pages');
  if (declaredPageCount !== pages.length) {
    fail(`Pages /Count 为 ${declaredPageCount}，实际 Page 对象为 ${pages.length}。`);
  }
  const kidReferences = referencesAfter(pagesRoot.dictionary, 'Kids');
  const actualPageKeys = new Set(pages.map((page) => `${page.number} ${page.generation}`));
  const kidKeys = new Set(kidReferences.map((reference) => `${reference.number} ${reference.generation}`));
  if (kidReferences.length !== pages.length || kidKeys.size !== actualPageKeys.size
    || [...actualPageKeys].some((key) => !kidKeys.has(key))) {
    fail('Pages /Kids 与实际 Page 对象不一致。');
  }

  const images = [...objects.values()].filter((object) => /\/Subtype\s*\/Image\b/u.test(object.dictionary));
  if (!images.length) fail('PDF 没有可验证的印刷图像。');
  const imageKeys = new Set(images.map((image) => `${image.number} ${image.generation}`));
  for (const image of images) {
    const definition = imageColorSpaceDefinition(image, objects);
    assertCmykColorSpace(
      definition,
      objects,
      `图像对象 ${image.number} ${image.generation}`,
      profileReference,
      iccSha256,
    );
    decodedStream(image, `图像对象 ${image.number} ${image.generation}`, true);
  }

  let fullPageImageCount = 0;
  let pageBoxes = null;
  pages.forEach((page, index) => {
    const mediaBox = parseBox(page.dictionary, 'MediaBox');
    if (!mediaBox || !isA4(mediaBox)) fail(`第 ${index + 1} 页不是纵向 A4 MediaBox。`);
    const trimBox = parseBox(page.dictionary, 'TrimBox');
    const artBox = parseBox(page.dictionary, 'ArtBox');
    if (Boolean(trimBox) === Boolean(artBox)) {
      fail(`第 ${index + 1} 页必须且只能提供 TrimBox 或 ArtBox。`);
    }
    const finalBox = trimBox ?? artBox;
    if (!containsBox(mediaBox, finalBox)) fail(`第 ${index + 1} 页的成品框超出 MediaBox。`);
    const bleedBox = parseBox(page.dictionary, 'BleedBox');
    if (!bleedBox) fail(`第 ${index + 1} 页缺少显式 BleedBox。`);
    if (!containsBox(mediaBox, bleedBox) || !containsBox(bleedBox, finalBox)) {
      fail(`第 ${index + 1} 页的 BleedBox 层级无效。`);
    }
    if (!sameBox(mediaBox, finalBox) || !sameBox(mediaBox, bleedBox)) {
      fail(`第 ${index + 1} 页的 MediaBox、TrimBox 与 BleedBox 必须一致为 A4 拼版页。`);
    }
    pageBoxes ??= { mediaBox, trimBox: finalBox, bleedBox };
    const contents = referencesAfter(page.dictionary, 'Contents');
    if (!contents.length) fail(`第 ${index + 1} 页缺少可检查的 Contents 引用。`);
    const decodedContents = contents.map((reference) => {
      const content = objectByReference(objects, reference.number, reference.generation, `第 ${index + 1} 页 Contents`);
      const decoded = decodedStream(content, `第 ${index + 1} 页 Contents`);
      assertNoRgbOperators(decoded, `第 ${index + 1} 页 Contents`);
      return decoded.toString('latin1');
    }).join('\n');

    const pageImages = pageXObjectReferences(page, `第 ${index + 1} 页`)
      .filter((reference) => imageKeys.has(`${reference.number} ${reference.generation}`));
    const qualifyingImages = pageImages.filter((reference) => {
      const image = objectByReference(objects, reference.number, reference.generation, `第 ${index + 1} 页图像`);
      return integerAfter(image.dictionary, 'Width', `第 ${index + 1} 页图像`) === FULL_PAGE_IMAGE_WIDTH
        && integerAfter(image.dictionary, 'Height', `第 ${index + 1} 页图像`) === FULL_PAGE_IMAGE_HEIGHT
        && integerAfter(image.dictionary, 'BitsPerComponent', `第 ${index + 1} 页图像`) === 8;
    });
    if (!qualifyingImages.length) {
      fail(`第 ${index + 1} 页没有 ${FULL_PAGE_IMAGE_WIDTH}x${FULL_PAGE_IMAGE_HEIGHT}、8bpc 的全页印刷图像。`);
    }
    for (const image of qualifyingImages) {
      assertFullPageImageInvocation(decodedContents, image.name, index + 1);
    }
    fullPageImageCount += qualifyingImages.length;
  });
  for (const match of dictionaries.matchAll(/\/ICCBased\s+(\d+)\s+(\d+)\s+R\b/gu)) {
    const colorProfile = objectByReference(objects, Number(match[1]), Number(match[2]), 'ICCBased');
    if (!/\/N\s+4\b/u.test(colorProfile.dictionary)) fail('发现非四通道 ICCBased 色彩空间。');
  }

  return {
    bytes: pdfBytes.length,
    pdfVersion: header,
    pdfxVersion: 'PDF/X-4',
    pages: pages.length,
    images: images.length,
    fullPageImages: fullPageImageCount,
    pageRaster: `${FULL_PAGE_IMAGE_WIDTH}x${FULL_PAGE_IMAGE_HEIGHT}`,
    approximatePpi: 300,
    pageBoxes,
    outputConditionIdentifier,
    iccSha256,
    iccBytes: iccBytes.length,
    encrypted: false,
    interactiveObjects: false,
    deviceRgbObjects: 0,
    notice: PDFX4_LIMITATIONS_NOTICE,
  };
}

export function verifyPdfX4(pdfPath, options = {}) {
  const absolutePath = resolve(pdfPath);
  if (!existsSync(absolutePath)) throw new Error(`PDF 不存在：${absolutePath}`);
  const stats = statSync(absolutePath);
  if (!stats.isFile()) throw new Error(`目标不是 PDF 文件：${absolutePath}`);
  const result = inspectPdfX4Buffer(readFileSync(absolutePath), options);
  return { path: absolutePath, fileName: basename(absolutePath), ...result };
}

function printResult(result) {
  console.log('PDFX4_STRUCTURAL_CHECK=pass');
  console.log(`PDFX4_PATH=${result.path}`);
  console.log(`PDFX4_BYTES=${result.bytes}`);
  console.log(`PDFX4_VERSION=${result.pdfVersion}`);
  console.log(`PDFX4_PAGES=${result.pages}`);
  console.log(`PDFX4_IMAGES=${result.images}`);
  console.log(`PDFX4_FULL_PAGE_IMAGES=${result.fullPageImages}`);
  console.log(`PDFX4_PAGE_RASTER=${result.pageRaster}`);
  console.log(`PDFX4_APPROXIMATE_PPI=${result.approximatePpi}`);
  console.log(`PDFX4_MEDIA_BOX=${result.pageBoxes.mediaBox.join(' ')}`);
  console.log(`PDFX4_TRIM_BOX=${result.pageBoxes.trimBox.join(' ')}`);
  console.log(`PDFX4_BLEED_BOX=${result.pageBoxes.bleedBox.join(' ')}`);
  console.log(`PDFX4_OUTPUT_CONDITION=${result.outputConditionIdentifier}`);
  console.log(`PDFX4_ICC_SHA256=${result.iccSha256}`);
  console.log('PDFX4_DEVICE_RGB_OBJECTS=0');
  console.log('PDFX4_ENCRYPTION=none');
  console.log('PDFX4_INTERACTIVE_OBJECTS=none');
  console.log(`PDFX4_LIMITATION=${result.notice}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const target = process.argv[2];
  if (!target) {
    console.error('用法：npm run qa:pdfx4:verify -- <PDF/X-4 文件>');
    process.exitCode = 2;
  } else {
    try {
      printResult(verifyPdfX4(target));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'PDF/X-4 验证失败。');
      console.error(PDFX4_LIMITATIONS_NOTICE);
      process.exitCode = 1;
    }
  }
}
