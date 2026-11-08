import type { DeckData } from '../types';

export function findNextExchangeableDeckIndex(
  decks: readonly DeckData[],
  currentIndex: number,
  canExchange: (deck: DeckData) => boolean,
): number | null {
  if (decks.length < 2) return null;
  for (let offset = 1; offset < decks.length; offset += 1) {
    const index = (currentIndex + offset) % decks.length;
    if (canExchange(decks[index])) return index;
  }
  return null;
}
