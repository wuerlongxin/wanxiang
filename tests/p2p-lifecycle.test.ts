import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';

import { startP2p, stopP2p } from '../src/services/p2p.ts';
import type { P2pSnapshot, P2pStartResult } from '../src/types.ts';

const exchangeSource = readFileSync(new URL('../src/scenes/exchange.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');

const ONLINE_SNAPSHOT: P2pSnapshot = {
  running: true,
  identity: {
    peerId: 'peer-local',
    displayName: '测试作者',
    connectionCode: '/ip4/127.0.0.1/udp/1234/quic-v1/p2p/peer-local',
    listenAddresses: ['/ip4/127.0.0.1/udp/1234/quic-v1/p2p/peer-local'],
  },
  peers: [],
  offers: [],
};

const OFFLINE_SNAPSHOT: P2pSnapshot = {
  ...ONLINE_SNAPSHOT,
  running: false,
  identity: ONLINE_SNAPSHOT.identity
    ? { ...ONLINE_SNAPSHOT.identity, connectionCode: '', listenAddresses: [] }
    : null,
};

test('P2P service forwards ownership leases and explicit force-stop intent', async () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  });
  const calls: Array<{ command: string; payload: Record<string, unknown> | undefined }> = [];
  const started: P2pStartResult = {
    snapshot: ONLINE_SNAPSHOT,
    leaseId: '8b37e8a7-c4cb-4b2e-a938-81cfdcb9222b',
  };
  mockIPC((command, payload) => {
    calls.push({ command, payload });
    if (command === 'p2p_start') return started;
    if (command === 'p2p_stop') return OFFLINE_SNAPSHOT;
    throw new Error(`unexpected command: ${command}`);
  });

  try {
    assert.deepEqual(await startP2p('测试作者'), started);
    await stopP2p(started.leaseId);
    await stopP2p(null);
    assert.deepEqual(calls, [
      { command: 'p2p_start', payload: { displayName: '测试作者' } },
      { command: 'p2p_stop', payload: { leaseId: started.leaseId } },
      { command: 'p2p_stop', payload: { leaseId: null } },
    ]);
  } finally {
    clearMocks();
    if (previousWindow === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});

test('exchange construction is inert and activation only reads existing node state', () => {
  const constructorStart = exchangeSource.indexOf('constructor(options: ExchangeSceneOptions)');
  const activateStart = exchangeSource.indexOf('  activate(): void', constructorStart);
  const constructorBody = exchangeSource.slice(constructorStart, activateStart);
  const activateBody = exchangeSource.slice(activateStart, exchangeSource.indexOf('\n  layout(', activateStart));

  assert.notEqual(constructorStart, -1);
  assert.notEqual(activateStart, -1);
  assert.doesNotMatch(constructorBody, /startP2p|getP2pSnapshot|stopP2p/u);
  assert.match(activateBody, /this\.loadNodeState\(\)/u);
  assert.doesNotMatch(activateBody, /startP2p/u);
});

test('exchange scene force-stops only on user action and lease-stops on destruction', () => {
  assert.match(exchangeSource, /const snapshot = await stopP2p\(null\)/u);
  assert.match(exchangeSource, /this\.nodeLeaseId = result\.leaseId \?\? undefined/u);
  assert.match(
    exchangeSource,
    /if \(this\.disposed\) \{\s*if \(result\.leaseId\) void stopP2p\(result\.leaseId\)/u,
  );
  assert.match(exchangeSource, /const leaseId = this\.nodeLeaseId/u);
  assert.match(exchangeSource, /if \(leaseId\) void stopP2p\(leaseId\)/u);
  assert.match(exchangeSource, /!this\.snapshot\.running\s*\|\| !this\.selectedDeckExchangeable/u);
});

test('app guards transitions before constructing exchange and activates after mounting', () => {
  const methodStart = appSource.indexOf('private openExchange(): void');
  const methodEnd = appSource.indexOf('\n  private openLibrary()', methodStart);
  const method = appSource.slice(methodStart, methodEnd);
  const guard = method.indexOf('if (this.switching) return;');
  const construct = method.indexOf('new ExchangeScene');
  const mount = method.indexOf('this.swapScene(scene, true);');
  const activate = method.indexOf('scene.activate();');

  assert.ok(guard >= 0 && guard < construct);
  assert.ok(construct < mount && mount < activate);
});
