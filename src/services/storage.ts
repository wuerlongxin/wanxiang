import type { DeckData, DeckLibraryData } from '../types';
import {
  deckVersionKey,
  findDeckVersion,
  isDeckRevision,
  isDeckRevisionReference,
} from './deck-identity';
import { isDeckContentPolicy } from './content-policy';

const DATABASE_NAME = 'wanxiang-deck';
const DATABASE_VERSION = 1;
const STORE_NAME = 'library';
const LIBRARY_KEY = 'deck-library-v1';
const FALLBACK_KEY = 'wanxiang-deck.library.v1';

export const MAX_LIBRARY_DECKS = 128;
export const MAX_DECK_BYTES = 24 * 1024 * 1024;
export const MAX_LIBRARY_BYTES = 64 * 1024 * 1024;

export class DeckStorageError extends Error {
  readonly code: string;

  constructor(message: string, code = 'DECK_STORAGE_FAILED') {
    super(message);
    this.name = 'DeckStorageError';
    this.code = code;
  }
}

export function emptyDeckLibrary(): DeckLibraryData {
  return {
    schemaVersion: 1,
    activeDeckId: null,
    activeDeckCid: null,
    activeDeckRevision: null,
    decks: [],
  };
}

function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

function normalizeError(error: unknown, fallback: string): DeckStorageError {
  if (error instanceof DeckStorageError) return error;
  if (typeof error === 'string') return new DeckStorageError(error);
  if (error && typeof error === 'object') {
    const value = error as { code?: string; message?: string };
    return new DeckStorageError(value.message ?? fallback, value.code);
  }
  return new DeckStorageError(fallback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isModeId(value: unknown): boolean {
  return ['reflex', 'memory', 'strategy', 'expression', 'mischief'].includes(String(value));
}

function isCardData(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.title === 'string' &&
    isModeId(value.modeId) &&
    typeof value.artUrl === 'string' &&
    Number.isInteger(value.attack) &&
    Number.isInteger(value.defense) &&
    Number.isInteger(value.cost) &&
    typeof value.skill === 'string' &&
    typeof value.flavor === 'string' &&
    ['普通', '稀有', '史诗', '传说'].includes(String(value.rarity)) &&
    typeof value.author === 'string'
  );
}

function isDeckData(value: unknown): value is DeckData {
  if (!isRecord(value)) return false;
  const deck = value as unknown as Partial<DeckData>;
  const provenance = deck.provenance;
  const validProvenance =
    provenance === undefined ||
    (isRecord(provenance) &&
      typeof provenance.cid === 'string' &&
      typeof provenance.signerPeerId === 'string' &&
      (provenance.publicKey === undefined || typeof provenance.publicKey === 'string') &&
      typeof provenance.signature === 'string');
  const validRevision = deck.revision === undefined || isDeckRevision(deck.revision);
  const validContentPolicy =
    deck.contentPolicy === undefined || isDeckContentPolicy(deck.contentPolicy);
  return (
    typeof deck.id === 'string' &&
    deck.id.length > 0 &&
    typeof deck.name === 'string' &&
    typeof deck.theme === 'string' &&
    isModeId(deck.modeId) &&
    typeof deck.story === 'string' &&
    typeof deck.rules === 'string' &&
    typeof deck.author === 'string' &&
    Array.isArray(deck.cards) &&
    deck.cards.length > 0 &&
    deck.cards.length <= 64 &&
    deck.cards.every(isCardData) &&
    validRevision &&
    validContentPolicy &&
    validProvenance
  );
}

export function normalizeDeckLibrary(value: unknown): DeckLibraryData {
  if (!value || typeof value !== 'object') {
    throw new DeckStorageError('作品库数据格式无效。', 'DECK_LIBRARY_INVALID');
  }
  const library = value as Partial<DeckLibraryData>;
  if (library.schemaVersion !== 1 || !Array.isArray(library.decks)) {
    throw new DeckStorageError('作品库版本不受支持。', 'DECK_LIBRARY_VERSION_UNSUPPORTED');
  }
  if (!library.decks.every(isDeckData)) {
    throw new DeckStorageError('作品库包含无法识别的套牌。', 'DECK_LIBRARY_INVALID');
  }
  const versionKeys = new Set(library.decks.map(deckVersionKey));
  if (versionKeys.size !== library.decks.length) {
    throw new DeckStorageError('作品库包含重复的套牌版本。', 'DECK_LIBRARY_INVALID');
  }
  const activeDeckId = library.activeDeckId ?? null;
  const activeDeckCid = library.activeDeckCid ?? null;
  const activeDeckRevision = library.activeDeckRevision ?? null;
  const ambiguousLegacyActiveDeck =
    activeDeckId !== null &&
    activeDeckCid === null &&
    activeDeckRevision === null &&
    library.decks.filter((deck) => deck.id === activeDeckId).length > 1;
  const normalizedActiveDeckId = ambiguousLegacyActiveDeck ? null : activeDeckId;
  const normalizedActiveDeckCid = ambiguousLegacyActiveDeck ? null : activeDeckCid;
  const normalizedActiveDeckRevision = ambiguousLegacyActiveDeck ? null : activeDeckRevision;
  if (
    (normalizedActiveDeckRevision !== null &&
      !isDeckRevisionReference(normalizedActiveDeckRevision)) ||
    (normalizedActiveDeckId === null &&
      (normalizedActiveDeckCid !== null || normalizedActiveDeckRevision !== null)) ||
    (normalizedActiveDeckCid !== null && normalizedActiveDeckRevision !== null) ||
    (normalizedActiveDeckId !== null &&
      !findDeckVersion(
        library.decks,
        normalizedActiveDeckId,
        normalizedActiveDeckCid,
        normalizedActiveDeckRevision,
      ))
  ) {
    throw new DeckStorageError('作品库的当前套牌不存在。', 'DECK_LIBRARY_INVALID');
  }
  return {
    schemaVersion: 1,
    activeDeckId: normalizedActiveDeckId,
    activeDeckCid: normalizedActiveDeckCid,
    activeDeckRevision: normalizedActiveDeckRevision,
    decks: library.decks,
  };
}

function serializeForStorage(library: DeckLibraryData): string {
  const normalized = normalizeDeckLibrary(library);
  if (normalized.decks.length > MAX_LIBRARY_DECKS) {
    throw new DeckStorageError(`作品库最多保存 ${MAX_LIBRARY_DECKS} 套卡牌。`, 'DECK_LIBRARY_LIMIT');
  }
  for (const deck of normalized.decks) {
    const deckBytes = new Blob([JSON.stringify(deck)]).size;
    if (deckBytes > MAX_DECK_BYTES) {
      throw new DeckStorageError(`《${deck.name}》超过单套 24 MiB 限制。`, 'DECK_TOO_LARGE');
    }
  }
  const serialized = JSON.stringify(normalized);
  if (new Blob([serialized]).size > MAX_LIBRARY_BYTES) {
    throw new DeckStorageError('作品库超过 64 MiB 容量限制。', 'DECK_LIBRARY_TOO_LARGE');
  }
  return serialized;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new DeckStorageError('当前浏览器不支持 IndexedDB。', 'INDEXED_DB_UNAVAILABLE'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let rejected = false;
    const rejectOpen = (error: unknown) => {
      rejected = true;
      reject(error);
    };
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      if (rejected) {
        request.result.close();
        return;
      }
      resolve(request.result);
    };
    request.onerror = () => rejectOpen(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => rejectOpen(new Error('IndexedDB upgrade blocked'));
  });
}

async function readIndexedDb(): Promise<unknown | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(LIBRARY_KEY);
      let stored: unknown | undefined;
      request.onsuccess = () => {
        stored = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
      transaction.oncomplete = () => resolve(stored);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB read aborted'));
    });
  } finally {
    database.close();
  }
}

async function writeIndexedDb(library: DeckLibraryData): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(library, LIBRARY_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write aborted'));
    });
  } finally {
    database.close();
  }
}

function readFallback(): DeckLibraryData | undefined {
  const serialized = localStorage.getItem(FALLBACK_KEY);
  if (!serialized) return undefined;
  return normalizeDeckLibrary(JSON.parse(serialized) as unknown);
}

function writeFallback(serialized: string): void {
  localStorage.setItem(FALLBACK_KEY, serialized);
}

async function loadBrowserLibrary(): Promise<DeckLibraryData> {
  const fallback = readFallback();
  if (fallback) {
    try {
      await writeIndexedDb(fallback);
      localStorage.removeItem(FALLBACK_KEY);
    } catch {
      // The validated fallback remains authoritative until migration succeeds.
    }
    return fallback;
  }

  const stored = await readIndexedDb();
  if (stored !== undefined) return normalizeDeckLibrary(stored);
  return emptyDeckLibrary();
}

export async function loadDeckLibrary(): Promise<DeckLibraryData> {
  if (!isDesktopRuntime()) return loadBrowserLibrary();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return normalizeDeckLibrary(await invoke<DeckLibraryData>('load_deck_library'));
  } catch (error) {
    throw normalizeError(error, '无法读取本机作品库。');
  }
}

export async function saveDeckLibrary(library: DeckLibraryData): Promise<DeckLibraryData> {
  const normalized = normalizeDeckLibrary(library);
  const serialized = serializeForStorage(normalized);
  if (isDesktopRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return normalizeDeckLibrary(
        await invoke<DeckLibraryData>('save_deck_library', { library: normalized }),
      );
    } catch (error) {
      throw normalizeError(error, '无法保存本机作品库。');
    }
  }

  try {
    await writeIndexedDb(normalized);
  } catch {
    try {
      writeFallback(serialized);
    } catch (error) {
      throw normalizeError(error, '浏览器预览无法保存作品库，可能已超出本地容量。');
    }
    return normalized;
  }
  try {
    localStorage.removeItem(FALLBACK_KEY);
  } catch {
    try {
      writeFallback(serialized);
    } catch {
      // IndexedDB has already committed the current snapshot.
    }
  }
  return normalized;
}
