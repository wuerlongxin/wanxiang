import { strFromU8, strToU8, unzipSync, zip } from 'fflate';

import type { CardBackDesign, DeckData } from '../types';
import { normalizeDeckLibrary } from './storage';

const PROJECT_FORMAT = 'wanxiang-deck-project';
const PROJECT_FORMAT_VERSION = 2;
const PROJECT_MANIFEST = 'project.json';
const MAX_PROJECT_BYTES = 80 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type ZipFiles = Record<string, Uint8Array>;

interface ProjectManifest {
  format: typeof PROJECT_FORMAT;
  formatVersion: typeof PROJECT_FORMAT_VERSION;
  exportedAt: number;
  deck: DeckData;
}

interface PackagedAsset {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface ExportDeckProjectResult {
  saved: boolean;
  path: string | null;
  bytesWritten: number;
}

export interface ImportDeckProjectResult {
  imported: boolean;
  path: string | null;
  deck: DeckData | null;
}

export class DeckProjectError extends Error {
  readonly code: string;

  constructor(message: string, code = 'PROJECT_OPERATION_FAILED') {
    super(message);
    this.name = 'DeckProjectError';
    this.code = code;
  }
}

interface DesktopSaveProjectFileResult {
  saved: boolean;
  path: string | null;
  bytesWritten: number;
}

interface DesktopOpenProjectFileResult {
  opened: boolean;
  path: string | null;
  contentsBase64: string | null;
  bytesRead: number;
}

function isDesktopProjectRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

function projectErrorRecord(value: unknown): { code?: unknown; message?: unknown } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as { code?: unknown; message?: unknown };
  }
  return record;
}

function toDeckProjectError(error: unknown, fallback: string): DeckProjectError {
  if (error instanceof DeckProjectError) return error;
  if (typeof error === 'string') {
    try {
      return toDeckProjectError(JSON.parse(error) as unknown, fallback);
    } catch {
      return new DeckProjectError(error);
    }
  }
  if (error instanceof Error) {
    const record = projectErrorRecord(error);
    return new DeckProjectError(
      typeof record?.message === 'string' ? record.message : error.message,
      typeof record?.code === 'string' ? record.code : 'PROJECT_OPERATION_FAILED',
    );
  }
  const record = projectErrorRecord(error);
  return new DeckProjectError(
    typeof record?.message === 'string' ? record.message : fallback,
    typeof record?.code === 'string' ? record.code : 'PROJECT_OPERATION_FAILED',
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizeImportedDeck(value: unknown): DeckData {
  return normalizeDeckLibrary({
    schemaVersion: 1,
    activeDeckId: null,
    activeDeckCid: null,
    activeDeckRevision: null,
    decks: [value],
  }).decks[0];
}

function safeProjectName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]/gu, '').slice(0, 80).replace(/[. ]+$/gu, '');
  return `${cleaned || 'wanxiang-deck'}.artdeck`;
}

function safePathFragment(value: string, fallback: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
  return cleaned || fallback;
}

function imageExtension(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/avif') return 'avif';
  return 'bin';
}

function imageMimeType(bytes: Uint8Array, suggested?: string): string {
  if (suggested?.startsWith('image/')) return suggested.split(';', 1)[0].toLowerCase();
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (strFromU8(bytes.subarray(0, 4)) === 'RIFF' && strFromU8(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (strFromU8(bytes.subarray(0, 3)) === 'GIF') return 'image/gif';
  if (strFromU8(bytes.subarray(4, 8)) === 'ftyp') return 'image/avif';
  throw new DeckProjectError('发现无法识别格式的卡牌图片。请先重绘该卡后再保存工程。', 'PROJECT_IMAGE_INVALID');
}

function dataUrlBytes(source: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/su.exec(source);
  if (!match) throw new DeckProjectError('卡牌图片数据无效。', 'PROJECT_IMAGE_INVALID');
  const mimeType = match[1]?.toLowerCase() ?? 'application/octet-stream';
  if (!mimeType.startsWith('image/')) throw new DeckProjectError('工程仅支持图片卡面资源。', 'PROJECT_IMAGE_INVALID');
  const payload = match[3];
  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { bytes, mimeType };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mimeType };
}

async function readImage(source: string, label: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  let bytes: Uint8Array;
  let suggestedMime: string | undefined;
  if (source.startsWith('data:')) {
    ({ bytes, mimeType: suggestedMime } = dataUrlBytes(source));
  } else {
    let response: Response;
    try {
      response = await fetch(source);
    } catch {
      throw new DeckProjectError(`无法读取${label}。请确认图片仍在本机后再保存。`, 'PROJECT_IMAGE_UNAVAILABLE');
    }
    if (!response.ok) {
      throw new DeckProjectError(`无法读取${label}。请确认图片仍在本机后再保存。`, 'PROJECT_IMAGE_UNAVAILABLE');
    }
    bytes = new Uint8Array(await response.arrayBuffer());
    suggestedMime = response.headers.get('content-type') ?? undefined;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new DeckProjectError(`${label}文件无效或超过 8 MiB。`, 'PROJECT_IMAGE_TOO_LARGE');
  }
  return { bytes, mimeType: imageMimeType(bytes, suggestedMime) };
}

function cloneDeck(deck: DeckData): DeckData {
  return JSON.parse(JSON.stringify(deck)) as DeckData;
}

async function rasterizeCardBack(cardBack: CardBackDesign): Promise<PackagedAsset> {
  if (typeof document === 'undefined') {
    throw new DeckProjectError('当前环境无法绘制卡背图片。', 'PROJECT_CARD_BACK_UNAVAILABLE');
  }
  const canvas = document.createElement('canvas');
  canvas.width = 700;
  canvas.height = 900;
  const context = canvas.getContext('2d');
  if (!context) throw new DeckProjectError('当前环境无法绘制卡背图片。', 'PROJECT_CARD_BACK_UNAVAILABLE');
  const hue = Math.abs(cardBack.seed) % 48;
  context.fillStyle = `hsl(${8 + hue}, 52%, 15%)`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(226, 177, 80, 0.9)';
  context.lineWidth = 14;
  context.strokeRect(40, 40, 620, 820);
  context.lineWidth = 3;
  context.strokeRect(66, 66, 568, 768);
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const rays = 12 + (Math.abs(cardBack.seed) % 8);
  for (let index = 0; index < rays; index += 1) {
    const angle = (Math.PI * 2 * index) / rays;
    context.strokeStyle = `hsla(${35 + ((index * 17 + hue) % 36)}, 80%, 65%, 0.3)`;
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(centerX + Math.cos(angle) * 255, centerY + Math.sin(angle) * 255);
    context.stroke();
  }
  context.fillStyle = 'rgba(24, 12, 18, 0.76)';
  context.beginPath();
  context.arc(centerX, centerY, 168, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = 'rgba(243, 204, 110, 0.94)';
  context.lineWidth = 8;
  context.stroke();
  context.fillStyle = '#f4ce7d';
  context.textAlign = 'center';
  context.font = 'bold 66px serif';
  context.fillText('万象', centerX, centerY + 20);
  context.font = '28px serif';
  context.fillText(cardBack.label.slice(0, 16), centerX, centerY + 74);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new DeckProjectError('卡背图片生成失败。', 'PROJECT_CARD_BACK_UNAVAILABLE');
  return { path: 'assets/card-back.png', bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/png' };
}

async function packageDeck(deck: DeckData): Promise<ZipFiles> {
  const packagedDeck = cloneDeck(deck);
  const files: ZipFiles = {};
  for (const [index, card] of packagedDeck.cards.entries()) {
    const source = deck.cards[index].artUrl;
    const asset = await readImage(source, `第 ${index + 1} 张《${card.name}》卡面`);
    const path = `assets/cards/${String(index + 1).padStart(3, '0')}-${safePathFragment(card.id, 'card')}.${imageExtension(asset.mimeType)}`;
    files[path] = asset.bytes;
    card.artUrl = path;
  }
  if (deck.cardBack) {
    const asset = deck.cardBack.textureUrl
      ? await readImage(deck.cardBack.textureUrl, '卡背图片').then((value) => ({
          path: `assets/card-back.${imageExtension(value.mimeType)}`,
          ...value,
        }))
      : await rasterizeCardBack(deck.cardBack);
    files[asset.path] = asset.bytes;
    packagedDeck.cardBack = { ...deck.cardBack, textureUrl: asset.path };
  }
  const manifest: ProjectManifest = {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    exportedAt: Date.now(),
    deck: packagedDeck,
  };
  files[PROJECT_MANIFEST] = strToU8(JSON.stringify(manifest, null, 2));
  return files;
}

function zipFiles(files: ZipFiles): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (error, data) => {
      if (error) reject(new DeckProjectError('套牌工程封装失败。', 'PROJECT_EXPORT_FAILED'));
      else resolve(data);
    });
  });
}

async function saveProject(bytes: Uint8Array, fileName: string): Promise<ExportDeckProjectResult> {
  if (isDesktopProjectRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<DesktopSaveProjectFileResult>('save_deck_project_file', {
      contentsBase64: bytesToBase64(bytes),
      suggestedName: fileName,
    });
  }

  const blob = new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' });
  const picker = (window as Window & { showSaveFilePicker?: (options: object) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [{ description: '万象卡域工程', accept: { 'application/zip': ['.artdeck'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { saved: true, path: null, bytesWritten: bytes.byteLength };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return { saved: false, path: null, bytesWritten: 0 };
      throw error;
    }
  }
  const anchor = document.createElement('a');
  const url = URL.createObjectURL(blob);
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  return { saved: true, path: null, bytesWritten: bytes.byteLength };
}

function isPackagePath(value: string): boolean {
  return /^assets\/(?:cards\/[^/]+|card-back\.[^/]+)$/u.test(value);
}

function decodeAsset(path: string, files: ZipFiles, label: string): string {
  if (!isPackagePath(path) || !files[path]) {
    throw new DeckProjectError(`${label}缺失，无法还原套牌工程。`, 'PROJECT_ASSET_MISSING');
  }
  const bytes = files[path];
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new DeckProjectError(`${label}文件无效。`, 'PROJECT_IMAGE_INVALID');
  }
  const mimeType = imageMimeType(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function parseProject(bytes: Uint8Array): DeckData {
  let files: ZipFiles;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new DeckProjectError('所选文件不是有效的万象卡域工程。', 'PROJECT_INVALID');
  }
  const manifestBytes = files[PROJECT_MANIFEST];
  if (!manifestBytes) throw new DeckProjectError('工程缺少 project.json。', 'PROJECT_INVALID');
  let manifest: ProjectManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as ProjectManifest;
  } catch {
    throw new DeckProjectError('工程清单格式无效。', 'PROJECT_INVALID');
  }
  if (manifest.format !== PROJECT_FORMAT || manifest.formatVersion !== PROJECT_FORMAT_VERSION) {
    throw new DeckProjectError('此工程版本不受支持。请使用新版万象卡域导入。', 'PROJECT_VERSION_UNSUPPORTED');
  }
  if (!manifest.deck || !Array.isArray(manifest.deck.cards)) {
    throw new DeckProjectError('工程中没有可还原的套牌。', 'PROJECT_INVALID');
  }
  const deck = cloneDeck(manifest.deck);
  deck.cards = deck.cards.map((card, index) => ({
    ...card,
    artUrl: decodeAsset(card.artUrl, files, `第 ${index + 1} 张卡面`),
  }));
  if (deck.cardBack?.textureUrl) {
    deck.cardBack = { ...deck.cardBack, textureUrl: decodeAsset(deck.cardBack.textureUrl, files, '卡背图片') };
  }
  return normalizeImportedDeck(deck);
}

async function chooseProjectFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.artdeck,application/zip';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

async function chooseProjectBytes(): Promise<{ bytes: Uint8Array; path: string | null } | null> {
  if (isDesktopProjectRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<DesktopOpenProjectFileResult>('open_deck_project_file');
    if (!result.opened || !result.contentsBase64) return null;
    return { bytes: base64ToBytes(result.contentsBase64), path: result.path };
  }

  const file = await chooseProjectFile();
  if (!file) return null;
  if (file.size > MAX_PROJECT_BYTES) {
    throw new DeckProjectError('套牌工程超过 80 MiB，无法导入。', 'PROJECT_TOO_LARGE');
  }
  return { bytes: new Uint8Array(await file.arrayBuffer()), path: null };
}

export async function exportDeckProject(deck: DeckData): Promise<ExportDeckProjectResult> {
  try {
    const files = await packageDeck(deck);
    const bytes = await zipFiles(files);
    if (bytes.byteLength > MAX_PROJECT_BYTES) {
      throw new DeckProjectError('套牌工程超过 80 MiB，请缩小卡图后重试。', 'PROJECT_TOO_LARGE');
    }
    return await saveProject(bytes, safeProjectName(deck.name));
  } catch (error) {
    throw toDeckProjectError(error, '套牌工程保存失败。');
  }
}

export async function importDeckProject(): Promise<ImportDeckProjectResult> {
  try {
    const project = await chooseProjectBytes();
    if (!project) return { imported: false, path: null, deck: null };
    if (project.bytes.byteLength > MAX_PROJECT_BYTES) {
      throw new DeckProjectError('套牌工程超过 80 MiB，无法导入。', 'PROJECT_TOO_LARGE');
    }
    return { imported: true, path: project.path, deck: parseProject(project.bytes) };
  } catch (error) {
    throw toDeckProjectError(error, '套牌工程导入失败。');
  }
}
