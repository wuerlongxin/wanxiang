import assert from 'node:assert/strict';
import test from 'node:test';

import {
  openProjectRepository,
  PROJECT_REPOSITORY_URL,
} from '../src/services/external-links.ts';

test('opens the canonical repository in a protected browser tab', async () => {
  const calls: unknown[][] = [];
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: undefined,
      open: (...args: unknown[]) => {
        calls.push(args);
        return null;
      },
    },
  });

  try {
    await openProjectRepository();
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }

  assert.deepEqual(calls, [[
    PROJECT_REPOSITORY_URL,
    '_blank',
    'noopener,noreferrer',
  ]]);
});
