export function partitionGenerationBatches(totalCards: number): number[] {
  const total = Math.max(3, Math.round(totalCards));
  const batchCount = Math.ceil(total / 8);
  const base = Math.floor(total / batchCount);
  const remainder = total % batchCount;
  return Array.from({ length: batchCount }, (_, index) => base + (index < remainder ? 1 : 0));
}
