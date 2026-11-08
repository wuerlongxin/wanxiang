import type { DeckData } from '../types';

export function applyAuthorToEntireDeck(deck: DeckData, value: string): DeckData {
  const author = Array.from(value.trim()).slice(0, 24).join('') || '佚名';
  return {
    ...deck,
    author,
    cards: deck.cards.map((card) => ({
      ...card,
      author,
      inscriptionText: author,
    })),
    creatorPlaque: {
      ...deck.creatorPlaque,
      displayName: author,
      signatureText: author,
    },
  };
}
