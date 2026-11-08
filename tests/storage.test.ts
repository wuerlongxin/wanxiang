import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

import type * as StorageService from '../src/services/storage.ts';
import type { DeckData } from '../src/types.ts';

const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: { middlewareMode: true },
});
after(() => vite.close());

const {
  emptyDeckLibrary,
  loadDeckLibrary,
  normalizeDeckLibrary,
} = await vite.ssrLoadModule('/src/services/storage.ts') as typeof StorageService;

const CID_A = `blake3:${'a'.repeat(64)}`;
const CID_B = `blake3:${'b'.repeat(64)}`;

function signedDeck(cid: string, story: string): DeckData {
  return {
    id: 'shared-id',
    theme: '云海机械城',
    name: '云海守卫',
    modeId: 'strategy',
    story,
    rules: '部署卡牌并守住核心。',
    cards: [{
      id: `card-${cid.slice(-1)}`,
      name: '铜翼守卫',
      title: '云海先锋',
      modeId: 'strategy',
      artUrl: '/assets/cards/strategy.jpg',
      attack: 5,
      defense: 6,
      cost: 3,
      skill: '入场时获得一点护盾。',
      flavor: '齿轮转动，风暴止息。',
      rarity: '稀有',
      author: '南星',
    }],
    author: '南星',
    provenance: {
      cid,
      signerPeerId: '12D3KooWTestPeer',
      signature: 'signed-version',
    },
  };
}

type ReadScenario =
  | 'missing'
  | 'open-error'
  | 'blocked'
  | 'transaction-throw'
  | 'request-error'
  | 'transaction-error'
  | 'abort-after-read';

function fakeIndexedDb(scenario: ReadScenario): IDBFactory {
  return {
    open() {
      const openRequest: {
        result?: IDBDatabase;
        error?: Error;
        onsuccess?: () => void;
        onerror?: () => void;
        onblocked?: () => void;
      } = {};

      queueMicrotask(() => {
        if (scenario === 'open-error') {
          openRequest.error = new Error('open failed');
          openRequest.onerror?.();
          return;
        }
        if (scenario === 'blocked') {
          openRequest.onblocked?.();
          return;
        }

        const readRequest: {
          result?: unknown;
          error?: Error;
          onsuccess?: () => void;
          onerror?: () => void;
        } = {};
        const transaction: {
          error?: Error;
          oncomplete?: () => void;
          onerror?: () => void;
          onabort?: () => void;
          objectStore: () => { get: () => typeof readRequest };
        } = {
          objectStore: () => ({
            get: () => {
              queueMicrotask(() => {
                if (scenario === 'request-error') {
                  readRequest.error = new Error('request failed');
                  readRequest.onerror?.();
                  return;
                }

                readRequest.result = undefined;
                readRequest.onsuccess?.();
                if (scenario === 'transaction-error') {
                  transaction.error = new Error('transaction failed');
                  transaction.onerror?.();
                } else if (scenario === 'abort-after-read') {
                  transaction.error = new Error('transaction aborted');
                  transaction.onabort?.();
                } else {
                  transaction.oncomplete?.();
                }
              });
              return readRequest;
            },
          }),
        };
        const database = {
          transaction: () => {
            if (scenario === 'transaction-throw') throw new Error('transaction unavailable');
            return transaction;
          },
          close: () => undefined,
        } as unknown as IDBDatabase;
        openRequest.result = database;
        openRequest.onsuccess?.();
      });

      return openRequest as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

async function withBrowserStorage<T>(indexedDb: IDBFactory, action: () => Promise<T>): Promise<T> {
  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: indexedDb,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      removeItem: () => undefined,
    },
  });
  try {
    return await action();
  } finally {
    if (indexedDbDescriptor) {
      Object.defineProperty(globalThis, 'indexedDB', indexedDbDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    }
    if (localStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  }
}

test('clears an ambiguous legacy activeDeckId without discarding deck versions', () => {
  const decks = [signedDeck(CID_A, '云城初版'), signedDeck(CID_B, '云城再版')];
  const normalized = normalizeDeckLibrary({
    schemaVersion: 1,
    activeDeckId: 'shared-id',
    decks,
  });

  assert.equal(normalized.activeDeckId, null);
  assert.equal(normalized.activeDeckCid, null);
  assert.equal(normalized.activeDeckRevision, null);
  assert.deepEqual(normalized.decks, decks);
});

test('accepts legacy and public-key provenance while rejecting an invalid key type', () => {
  const legacy = signedDeck(CID_A, '旧版来源记录');
  const current = signedDeck(CID_B, '新版来源记录');
  current.provenance!.publicKey = 'CAESIEd25519PublicKey';

  const normalized = normalizeDeckLibrary({
    schemaVersion: 1,
    activeDeckId: null,
    decks: [legacy, current],
  });
  assert.equal(normalized.decks[0].provenance?.publicKey, undefined);
  assert.equal(normalized.decks[1].provenance?.publicKey, 'CAESIEd25519PublicKey');

  assert.throws(() => normalizeDeckLibrary({
    schemaVersion: 1,
    activeDeckId: null,
    decks: [{
      ...current,
      provenance: { ...current.provenance!, publicKey: 42 },
    }],
  }));
});

test('returns an empty library only when the IndexedDB record is missing', async () => {
  const loaded = await withBrowserStorage(fakeIndexedDb('missing'), () => loadDeckLibrary());
  assert.deepEqual(loaded, emptyDeckLibrary());
});

for (const scenario of [
  'open-error',
  'blocked',
  'transaction-throw',
  'request-error',
  'transaction-error',
  'abort-after-read',
] as const) {
  test(`propagates IndexedDB read failure: ${scenario}`, async () => {
    await assert.rejects(
      withBrowserStorage(fakeIndexedDb(scenario), () => loadDeckLibrary()),
    );
  });
}
