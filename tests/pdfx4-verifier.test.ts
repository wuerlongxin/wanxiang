import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import {
  PDFX4_LIMITATIONS_NOTICE,
  inspectPdfX4Buffer,
} from '../scripts/verify-pdfx4.mjs';

function fakeCmykIcc(): Buffer {
  const bytes = Buffer.alloc(128);
  bytes.writeUInt32BE(bytes.length, 0);
  bytes.write('test', 4, 'ascii');
  bytes.write('prtr', 12, 'ascii');
  bytes.write('CMYK', 16, 'ascii');
  bytes.write('Lab ', 20, 'ascii');
  bytes.write('acsp', 36, 'ascii');
  return bytes;
}

function pdfObject(number: number, dictionary: string, stream?: Buffer): Buffer {
  if (!stream) return Buffer.from(`${number} 0 obj\n${dictionary}\nendobj\n`, 'latin1');
  const completeDictionary = dictionary.replace('__LENGTH__', String(stream.length));
  return Buffer.concat([
    Buffer.from(`${number} 0 obj\n${completeDictionary}\nstream\n`, 'latin1'),
    stream,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]);
}

interface FixtureOptions {
  version?: string;
  imageColorSpace?: string;
  pageBox?: string;
  trimBox?: string | null;
  bleedBox?: string | null;
  pageExtra?: string;
  pagesCount?: number;
  pagesKids?: string;
  catalogOutputIntents?: string;
  catalogExtra?: string;
  outputIntentExtra?: string;
  profileN?: number;
  profileBytes?: Buffer;
  imageWidth?: number;
  imageHeight?: number;
  imageBitsPerComponent?: number;
  infoVersion?: string;
  infoExtra?: string;
  xmpVersion?: string;
  content?: Buffer;
  compressedContent?: boolean;
  trailerExtra?: string;
  extraObjects?: Buffer[];
}

function makePdf(options: FixtureOptions = {}): { bytes: Buffer; icc: Buffer; iccHash: string } {
  const icc = options.profileBytes ?? fakeCmykIcc();
  const rawContent = options.content ?? Buffer.from('q 595.276 0 0 841.89 0 0 cm /Im1 Do Q', 'latin1');
  const content = options.compressedContent ? deflateSync(rawContent) : rawContent;
  const contentFilter = options.compressedContent ? '/Filter /FlateDecode ' : '';
  const xmpVersion = options.xmpVersion ?? 'PDF/X-4';
  const pageBox = options.pageBox ?? '[0 0 595.276 841.89]';
  const trimBox = options.trimBox === null
    ? ''
    : `/TrimBox ${options.trimBox ?? pageBox} `;
  const bleedBox = options.bleedBox === null
    ? ''
    : `/BleedBox ${options.bleedBox ?? pageBox} `;
  const xmp = Buffer.from(
    `<?xpacket begin=""?>\n`
      + `<x:xmpmeta xmlns:x="adobe:ns:meta/">`
      + `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`
      + `<rdf:Description xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" `
      + `pdfxid:GTS_PDFXVersion="${xmpVersion}"/>`
      + `</rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`,
    'utf8',
  );
  const objects = [
    pdfObject(
      1,
      `<< /Type /Catalog /Pages 2 0 R /OutputIntents ${options.catalogOutputIntents ?? '[4 0 R]'} `
        + `/Metadata 8 0 R ${options.catalogExtra ?? ''} >>`,
    ),
    pdfObject(
      2,
      `<< /Type /Pages /Kids ${options.pagesKids ?? '[3 0 R]'} /Count ${options.pagesCount ?? 1} >>`,
    ),
    pdfObject(
      3,
      `<< /Type /Page /Parent 2 0 R /MediaBox ${pageBox} `
        + trimBox
        + bleedBox
        + `/Resources << /XObject << /Im1 7 0 R >> >> /Contents 6 0 R ${options.pageExtra ?? ''} >>`,
    ),
    pdfObject(
      4,
      `<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier (FOGRA39L Coated) `
        + `/DestOutputProfile 5 0 R ${options.outputIntentExtra ?? ''} >>`,
    ),
    pdfObject(
      5,
      `<< /N ${options.profileN ?? 4} /Alternate /DeviceCMYK /Length __LENGTH__ >>`,
      icc,
    ),
    pdfObject(6, `<< ${contentFilter}/Length __LENGTH__ >>`, content),
    pdfObject(
      7,
      `<< /Type /XObject /Subtype /Image /Width ${options.imageWidth ?? 2480} `
        + `/Height ${options.imageHeight ?? 3508} `
        + `/ColorSpace ${options.imageColorSpace ?? '/DeviceCMYK'} `
        + `/BitsPerComponent ${options.imageBitsPerComponent ?? 8} /Length __LENGTH__ >>`,
      Buffer.from([0, 0, 0, 255]),
    ),
    pdfObject(8, '<< /Type /Metadata /Subtype /XML /Length __LENGTH__ >>', xmp),
    pdfObject(
      9,
      `<< /GTS_PDFXVersion (${options.infoVersion ?? 'PDF/X-4'}) /Trapped /False ${options.infoExtra ?? ''} >>`,
    ),
    ...(options.extraObjects ?? []),
  ];
  const bytes = Buffer.concat([
    Buffer.from(`%PDF-${options.version ?? '1.6'}\n%PDFX\n`, 'latin1'),
    ...objects,
    Buffer.from(`trailer\n<< /Root 1 0 R /Info 9 0 R ${options.trailerExtra ?? ''} >>\n%%EOF\n`, 'latin1'),
  ]);
  return {
    bytes,
    icc,
    iccHash: createHash('sha256').update(icc).digest('hex'),
  };
}

function inspectFixture(options: FixtureOptions = {}) {
  const fixture = makePdf(options);
  return inspectPdfX4Buffer(fixture.bytes, { expectedIccSha256: fixture.iccHash });
}

test('accepts a fail-closed PDF 1.6, PDF/X-4, A4 and CMYK fixture', () => {
  const result = inspectFixture();
  assert.equal(result.pdfVersion, '1.6');
  assert.equal(result.pdfxVersion, 'PDF/X-4');
  assert.equal(result.pages, 1);
  assert.equal(result.images, 1);
  assert.equal(result.fullPageImages, 1);
  assert.equal(result.pageRaster, '2480x3508');
  assert.equal(result.approximatePpi, 300);
  assert.deepEqual(result.pageBoxes, {
    mediaBox: [0, 0, 595.276, 841.89],
    trimBox: [0, 0, 595.276, 841.89],
    bleedBox: [0, 0, 595.276, 841.89],
  });
  assert.equal(result.outputConditionIdentifier, 'FOGRA39L Coated');
  assert.equal(result.deviceRgbObjects, 0);
  assert.equal(result.encrypted, false);
  assert.equal(result.interactiveObjects, false);
  assert.equal(result.notice, PDFX4_LIMITATIONS_NOTICE);
  assert.match(result.notice, /不能替代 Adobe Acrobat Preflight、callas pdfToolbox/u);
});

test('accepts an image that references a four-channel ICCBased color space', () => {
  const result = inspectFixture({ imageColorSpace: '[/ICCBased 5 0 R]' });
  assert.equal(result.images, 1);
});

test('rejects the wrong PDF version and non-A4 pages', () => {
  assert.throws(() => inspectFixture({ version: '1.7' }), /PDF 版本必须是 1\.6/u);
  assert.throws(
    () => inspectFixture({ pageBox: '[0 0 612 792]' }),
    /不是纵向 A4 MediaBox/u,
  );
});

test('requires explicit and internally consistent A4 page boxes', () => {
  assert.throws(
    () => inspectFixture({ bleedBox: null }),
    /缺少显式 BleedBox/u,
  );
  assert.throws(
    () => inspectFixture({ trimBox: '[8.504 8.504 586.772 833.386]' }),
    /MediaBox、TrimBox 与 BleedBox 必须一致为 A4 拼版页/u,
  );
  assert.throws(
    () => inspectFixture({ bleedBox: '[8.504 8.504 586.772 833.386]' }),
    /BleedBox 层级无效/u,
  );
});

test('requires an invoked 2480x3508, 8bpc image painted with the full A4 matrix', () => {
  assert.throws(
    () => inspectFixture({ imageWidth: 1240, imageHeight: 1754 }),
    /没有 2480x3508、8bpc 的全页印刷图像/u,
  );
  assert.throws(
    () => inspectFixture({ imageBitsPerComponent: 16 }),
    /没有 2480x3508、8bpc 的全页印刷图像/u,
  );
  assert.throws(
    () => inspectFixture({ content: Buffer.from('q 300 0 0 400 0 0 cm /Im1 Do Q', 'latin1') }),
    /没有铺满纵向 A4 页面/u,
  );
});

test('requires the Pages count and Kids references to match the actual page objects', () => {
  assert.throws(
    () => inspectFixture({ pagesCount: 2 }),
    /Pages \/Count 为 2，实际 Page 对象为 1/u,
  );
  assert.throws(
    () => inspectFixture({ pagesKids: '[10 0 R]' }),
    /Pages \/Kids 与实际 Page 对象不一致/u,
  );
});

test('requires matching PDF/X-4 declarations in Info and XMP', () => {
  assert.throws(() => inspectFixture({ infoVersion: 'PDF/X-3' }), /Info 缺少 GTS_PDFXVersion/u);
  assert.throws(() => inspectFixture({ xmpVersion: 'PDF/X-3' }), /XMP 缺少 PDF\/X-4/u);
});

test('requires one GTS_PDFX OutputIntent with the expected four-channel ICC', () => {
  assert.throws(() => inspectFixture({ catalogOutputIntents: '[]' }), /必须且只能引用一个 OutputIntent/u);
  assert.throws(() => inspectFixture({ profileN: 3 }), /DestOutputProfile 的 N 必须为 4/u);
  const fixture = makePdf();
  assert.throws(
    () => inspectPdfX4Buffer(fixture.bytes, { expectedIccSha256: '0'.repeat(64) }),
    /内嵌 ICC SHA-256 不一致/u,
  );
});

test('rejects DeviceRGB names, RGB images and compressed rg/RG page operators', () => {
  assert.throws(() => inspectFixture({ imageColorSpace: '/DeviceRGB' }), /禁止的 RGB 色彩空间/u);
  assert.throws(
    () => inspectFixture({
      compressedContent: true,
      content: Buffer.from('0.1 0.2 0.3 rg 0 0 10 10 re f', 'latin1'),
    }),
    /DeviceRGB 的 rg\/RG 绘制操作/u,
  );
});

test('rejects encryption, annotations and executable document actions', () => {
  assert.throws(() => inspectFixture({ trailerExtra: '/Encrypt 10 0 R' }), /禁止的加密或交互结构 \/Encrypt/u);
  assert.throws(() => inspectFixture({ pageExtra: '/Annots [10 0 R]' }), /禁止的加密或交互结构 \/Annots/u);
  assert.throws(() => inspectFixture({ catalogExtra: '/OpenAction 10 0 R' }), /禁止的加密或交互结构 \/OpenAction/u);
});

test('rejects object streams because hidden objects cannot be proven CMYK-only', () => {
  const objectStream = pdfObject(10, '<< /Type /ObjStm /N 1 /First 4 /Length __LENGTH__ >>', Buffer.from('11 0 <<>>'));
  assert.throws(() => inspectFixture({ extraObjects: [objectStream] }), /包含对象流/u);
});
