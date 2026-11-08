import type {
  DeckData,
  DeckRevision,
  DeckRevisionReason,
  DeckRevisionReference,
} from '../types';

export const DECK_REVISION_REASONS: readonly DeckRevisionReason[] = [
  'initial',
  'deck-generation',
  'card-regeneration',
  'manual-snapshot',
  'imported',
];

const REVISION_REASON_LABELS: Record<DeckRevisionReason, string> = {
  initial: '初始版本',
  'deck-generation': '整套炼制',
  'card-regeneration': '单卡重绘',
  'manual-snapshot': '手动留版',
  imported: '导入版本',
};

const MAX_SAFE_REVISION = 1_000_000;
const MAX_SAFE_TIMESTAMP = Number.MAX_SAFE_INTEGER;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isSafeIdentifier(value: unknown): value is string {
  const characters = typeof value === 'string' ? Array.from(value) : [];
  return (
    typeof value === 'string' &&
    characters.length > 0 &&
    characters.length <= 128 &&
    !characters.some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    })
  );
}

export function isDeckRevisionReason(value: unknown): value is DeckRevisionReason {
  return DECK_REVISION_REASONS.includes(value as DeckRevisionReason);
}

export function isDeckRevision(value: unknown): value is DeckRevision {
  if (!isRecord(value) || !hasOnlyKeys(value, ['familyId', 'revision', 'createdAt', 'reason'])) {
    return false;
  }
  return (
    isSafeIdentifier(value.familyId) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 1 &&
    Number(value.revision) <= MAX_SAFE_REVISION &&
    Number.isInteger(value.createdAt) &&
    Number(value.createdAt) >= 0 &&
    Number(value.createdAt) <= MAX_SAFE_TIMESTAMP &&
    isDeckRevisionReason(value.reason)
  );
}

export function isDeckRevisionReference(value: unknown): value is DeckRevisionReference {
  if (!isRecord(value) || !hasOnlyKeys(value, ['familyId', 'revision'])) return false;
  return (
    isSafeIdentifier(value.familyId) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 1 &&
    Number(value.revision) <= MAX_SAFE_REVISION
  );
}

export function deckVersionCid(deck: DeckData): string | null {
  const cid = deck.provenance?.cid;
  return typeof cid === 'string' && cid.length > 0 ? cid : null;
}

export function deckRevisionReference(deck: DeckData): DeckRevisionReference | null {
  if (deck.provenance || !isDeckRevision(deck.revision)) return null;
  return { familyId: deck.revision.familyId, revision: deck.revision.revision };
}

export function deckFamilyId(deck: DeckData): string {
  return isDeckRevision(deck.revision) ? deck.revision.familyId : deck.id;
}

export function deckVersionKey(deck: DeckData): string {
  const cid = deckVersionCid(deck);
  if (cid) return JSON.stringify([deck.id, cid]);
  const revision = deckRevisionReference(deck);
  return revision
    ? JSON.stringify(['revision', revision.familyId, revision.revision])
    : JSON.stringify([deck.id, null]);
}

export function mergeDeckVersions(decks: Iterable<DeckData>): DeckData[] {
  const versions = new Map<string, DeckData>();
  for (const deck of decks) versions.set(deckVersionKey(deck), deck);
  return [...versions.values()];
}

export function findDeckVersion(
  decks: Iterable<DeckData>,
  id: string,
  cid: string | null = null,
  revision: DeckRevisionReference | null = null,
): DeckData | undefined {
  const matches: DeckData[] = [];
  for (const deck of decks) {
    if (deck.id !== id) continue;
    if (cid !== null) {
      if (deckVersionCid(deck) === cid) return deck;
      continue;
    }
    if (revision !== null) {
      const candidate = deckRevisionReference(deck);
      if (
        candidate?.familyId === revision.familyId &&
        candidate.revision === revision.revision
      ) {
        return deck;
      }
      continue;
    }
    if (deckVersionCid(deck) === null && deckRevisionReference(deck) === null) return deck;
    matches.push(deck);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

export function shortDeckCid(deck: DeckData): string | null {
  const cid = deckVersionCid(deck)?.replace(/^blake3:/, '');
  return cid ? cid.slice(0, 8) : null;
}

export interface DeckRevisionDescription {
  versionLabel: string;
  reasonLabel: string;
  createdAtLabel: string | null;
}

export function formatDeckRevisionTime(createdAt: number): string {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function describeRevision(deck: DeckData): DeckRevisionDescription {
  if (!isDeckRevision(deck.revision)) {
    return {
      versionLabel: deck.provenance ? '签名版本' : '第 1 版',
      reasonLabel: deck.provenance ? '交换所得' : '初始版本',
      createdAtLabel: null,
    };
  }
  return {
    versionLabel: `第 ${deck.revision.revision} 版`,
    reasonLabel: REVISION_REASON_LABELS[deck.revision.reason],
    createdAtLabel: formatDeckRevisionTime(deck.revision.createdAt) || null,
  };
}

export function createNextDeckRevision(
  previous: DeckData,
  next: DeckData,
  reason: DeckRevisionReason,
  createdAt: number,
  existingDecks: Iterable<DeckData> = [],
): DeckData {
  if (!isDeckRevisionReason(reason)) throw new TypeError('Unsupported deck revision reason.');
  if (!Number.isInteger(createdAt) || createdAt < 0 || createdAt > MAX_SAFE_TIMESTAMP) {
    throw new TypeError('Deck revision timestamp must be a safe non-negative integer.');
  }

  const familyId = isDeckRevision(previous.revision)
    ? previous.revision.familyId
    : previous.id;
  if (!isSafeIdentifier(familyId)) throw new TypeError('Deck revision family ID is invalid.');

  let maximumRevision = isDeckRevision(previous.revision) ? previous.revision.revision : 1;
  for (const deck of existingDecks) {
    if (isDeckRevision(deck.revision) && deck.revision.familyId === familyId) {
      maximumRevision = Math.max(maximumRevision, deck.revision.revision);
    }
  }
  if (maximumRevision >= MAX_SAFE_REVISION) {
    throw new RangeError('Deck revision limit reached.');
  }

  // A derived local snapshot cannot reuse the signature of its source payload.
  const { provenance: _provenance, revision: _revision, ...content } = next;
  return {
    ...content,
    revision: {
      familyId,
      revision: maximumRevision + 1,
      createdAt,
      reason,
    },
  };
}
