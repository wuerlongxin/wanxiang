import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_OUTPUT_DIR = resolve(PROJECT_ROOT, 'output/pdf');
const TAURI_PDF_LIMIT_BYTES = 32 * 1024 * 1024;

function readField(info, label) {
  return info.match(new RegExp(`^${label}:\\s*(.+)$`, 'mu'))?.[1]?.trim() ?? '';
}

export function findLatestRgbProof(outputDirectory = DEFAULT_OUTPUT_DIR) {
  const candidates = readdirSync(outputDirectory)
    .filter((name) => name.endsWith('--rgb-proof.pdf'))
    .map((name) => {
      const path = resolve(outputDirectory, name);
      return { path, modifiedAt: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!candidates.length) throw new Error(`未在 ${outputDirectory} 找到 RGB 校样 PDF。`);
  return candidates[0].path;
}

export function verifyRgbProof(pdfPath, cardCount = 56) {
  const absolutePath = resolve(pdfPath);
  const stats = statSync(absolutePath);
  if (!basename(absolutePath).endsWith('--rgb-proof.pdf')) {
    throw new Error('文件名必须以 --rgb-proof.pdf 结尾。');
  }
  if (stats.size <= 0 || stats.size > TAURI_PDF_LIMIT_BYTES) {
    throw new Error(`PDF 大小 ${stats.size} 字节，不符合桌面保存边界。`);
  }

  let info;
  try {
    info = execFileSync('pdfinfo', [absolutePath], { encoding: 'utf8' });
  } catch (error) {
    throw new Error(`无法运行 pdfinfo；请先安装 Poppler。${error instanceof Error ? ` ${error.message}` : ''}`);
  }
  const pages = Number(readField(info, 'Pages'));
  const cardPages = Math.ceil(cardCount / 6) * 2;
  if (!Number.isInteger(pages) || pages < cardPages + 2) {
    throw new Error(`页数 ${pages || '未知'} 不足：${cardCount} 张牌至少需要 ${cardPages} 个正反面页和 2 页说明书。`);
  }
  const title = readField(info, 'Title');
  const subject = readField(info, 'Subject');
  const keywords = readField(info, 'Keywords');
  const pageSize = readField(info, 'Page size');
  const encrypted = readField(info, 'Encrypted');
  if (!title.includes('RGB')) throw new Error('PDF 标题缺少 RGB 校样标识。');
  if (!/RGB proof/u.test(subject) || !/CMYK conversion required/u.test(subject)) {
    throw new Error('PDF 主题缺少 RGB 校样或印厂 CMYK 转换声明。');
  }
  for (const marker of ['rgb-proof', 'bleed-3mm', '300ppi', 'deckId=']) {
    if (!keywords.includes(marker)) throw new Error(`PDF 关键字缺少 ${marker}。`);
  }
  if (!pageSize.includes('(A4)')) throw new Error(`页面不是 A4：${pageSize || '未知'}。`);
  if (encrypted.toLowerCase() !== 'no') throw new Error('PDF 不应加密。');

  return {
    path: absolutePath,
    bytes: stats.size,
    pages,
    cardCount,
    cardPages,
    rulebookPages: pages - cardPages,
    pageSize,
  };
}

function printResult(result) {
  console.log(`RGB_PROOF_PATH=${result.path}`);
  console.log(`RGB_PROOF_BYTES=${result.bytes}`);
  console.log(`RGB_PROOF_PAGES=${result.pages}`);
  console.log(`RGB_PROOF_CARD_PAGES=${result.cardPages}`);
  console.log(`RGB_PROOF_RULEBOOK_PAGES=${result.rulebookPages}`);
  console.log(`RGB_PROOF_PAGE_SIZE=${result.pageSize}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const target = process.argv[2] ? resolve(process.argv[2]) : findLatestRgbProof();
  const cardCount = process.argv[3] ? Number(process.argv[3]) : 56;
  printResult(verifyRgbProof(target, cardCount));
}
