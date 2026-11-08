import assert from 'node:assert/strict';
import test from 'node:test';

import { partitionGenerationBatches } from '../src/generation-batches.ts';

test('complete deck sizes are split into valid AI batches without losing cards', () => {
  const cases = new Map<number, number[]>([
    [31, [8, 8, 8, 7]],
    [48, [8, 8, 8, 8, 8, 8]],
    [56, [8, 8, 8, 8, 8, 8, 8]],
    [12, [6, 6]],
    [13, [7, 6]],
    [64, [8, 8, 8, 8, 8, 8, 8, 8]],
  ]);

  for (const [total, expected] of cases) {
    const batches = partitionGenerationBatches(total);
    assert.deepEqual(batches, expected);
    assert.equal(batches.reduce((sum, count) => sum + count, 0), total);
    assert.ok(batches.every((count) => count >= 3 && count <= 8));
  }
});
