import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyPdfX4 } from './verify-pdfx4.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function fields(output: string): Map<string, string> {
  return new Map(
    output
      .split(/\r?\n/u)
      .map((line) => line.split('=', 2))
      .filter((entry): entry is [string, string] => entry.length === 2),
  );
}

const pageOutput = execFileSync(
  process.execPath,
  [resolve(PROJECT_ROOT, 'scripts/generate-complete-pdfx4-pages.ts')],
  { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
const pageFields = fields(pageOutput);
const pagesDirectory = pageFields.get('PAGES_DIR');
const outputPath = pageFields.get('OUTPUT_PATH');
const title = pageFields.get('TITLE');
const author = pageFields.get('AUTHOR');
const expectedPages = Number(pageFields.get('PAGE_COUNT'));
if (!pagesDirectory || !outputPath || !title || !author || !Number.isInteger(expectedPages)) {
  throw new Error('PDF/X-4 页面生成器没有返回完整的 QA 元数据。');
}

try {
  execFileSync(
    'cargo',
    [
      'run',
      '--quiet',
      '--manifest-path',
      resolve(PROJECT_ROOT, 'src-tauri/Cargo.toml'),
      '--example',
      'pdfx4_qa',
      '--',
      pagesDirectory,
      outputPath,
      title,
      author,
    ],
    { cwd: PROJECT_ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const result = verifyPdfX4(outputPath);
  if (result.pages !== expectedPages || result.images !== expectedPages) {
    throw new Error(
      `完整 PDF/X-4 页数不一致：计划 ${expectedPages}，PDF ${result.pages}，图像 ${result.images}。`,
    );
  }
  console.log(`PDFX4_PROOF_PATH=${result.path}`);
  console.log(`PDFX4_PROOF_BYTES=${result.bytes}`);
  console.log(`PDFX4_PROOF_PAGES=${result.pages}`);
  console.log(`PDFX4_PROOF_IMAGES=${result.images}`);
  console.log(`PDFX4_PROOF_PPI=${result.approximatePpi}`);
  console.log(`PDFX4_PROOF_ICC_SHA256=${result.iccSha256}`);
} finally {
  rmSync(pagesDirectory, { recursive: true, force: true });
}
