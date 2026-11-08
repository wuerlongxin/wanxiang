import type { CardData } from '../types';

/** Keeps generation slot order while preserving edits already made to streamed cards. */
export function orderedCurrentStreamedCards(
  streamedCards: ReadonlyMap<number, CardData>,
  currentCards: readonly CardData[],
): CardData[] {
  return [...streamedCards.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, streamed]) => (
      currentCards.find((card) => card.id === streamed.id) ?? streamed
    ));
}

/** Reconciles the completed payload without rolling back edits made during generation. */
export function reconcileGeneratedCards(
  generatedCards: readonly CardData[],
  streamedCards: ReadonlyMap<number, CardData>,
  currentCards: readonly CardData[],
): CardData[] {
  return generatedCards.map((generated, index) => {
    const streamed = streamedCards.get(index);
    const id = streamed?.id ?? generated.id;
    return currentCards.find((card) => card.id === id) ?? streamed ?? generated;
  });
}
