import { isDeckRevision } from './deck-identity.ts';
import type { DeckData } from '../types';

type PrintIdentityDeck = Pick<DeckData, 'id' | 'revision' | 'provenance'>;

export interface PrintDeckIdentity {
  deckId: string;
  familyId: string | null;
  revision: number | null;
  cid: string | null;
  metadataLabel: string;
  footerLabel: string;
  watermarkLabel: string;
}

function compact(value: string, maximum: number): string {
  const characters = Array.from(value.trim());
  return characters.length <= maximum
    ? characters.join('')
    : `${characters.slice(0, maximum).join('')}~`;
}

function compactCid(cid: string): string {
  return compact(cid.replace(/^blake3:/u, ''), 16);
}

export function getPrintDeckIdentity(deck: PrintIdentityDeck): PrintDeckIdentity {
  const revision = isDeckRevision(deck.revision) ? deck.revision : null;
  const cid = deck.provenance?.cid?.trim() || null;
  const metadataParts = [`deckId=${deck.id}`];
  const footerParts = [`ID:${compact(deck.id, 16)}`];
  const watermarkParts = [`AD:${compact(deck.id, 20)}`];

  if (revision) {
    metadataParts.push(`familyId=${revision.familyId}`, `revision=${revision.revision}`);
    footerParts.push(`F:${compact(revision.familyId, 16)}`, `R:${revision.revision}`);
    watermarkParts.push(`F:${compact(revision.familyId, 20)}`, `R:${revision.revision}`);
  }
  if (cid) {
    metadataParts.push(`cid=${cid}`);
    footerParts.push(`CID:${compactCid(cid)}`);
    watermarkParts.push(`CID:${compactCid(cid)}`);
  }

  return {
    deckId: deck.id,
    familyId: revision?.familyId ?? null,
    revision: revision?.revision ?? null,
    cid,
    metadataLabel: metadataParts.join('; '),
    footerLabel: footerParts.join(' / '),
    watermarkLabel: watermarkParts.join('|'),
  };
}
