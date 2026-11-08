import type { DeckData, P2pSnapshot, P2pStartResult } from '../types';
import { canExchangeDeck } from './content-policy.ts';

export class P2pError extends Error {
  readonly code: string;

  constructor(message: string, code = 'P2P_ERROR') {
    super(message);
    this.name = 'P2pError';
    this.code = code;
  }
}

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

const browserSnapshot: P2pSnapshot = {
  running: false,
  identity: null,
  peers: [],
  offers: [],
  lastError: '去中心交换节点仅在 Tauri 桌面版中运行。',
};

function normalizeError(error: unknown): P2pError {
  if (typeof error === 'string') return new P2pError(error);
  if (error && typeof error === 'object') {
    const value = error as { code?: string; message?: string };
    return new P2pError(value.message ?? 'P2P 节点操作失败。', value.code);
  }
  return new P2pError('P2P 节点操作失败。');
}

export async function startP2p(displayName: string): Promise<P2pStartResult> {
  if (!isDesktopRuntime()) return { snapshot: browserSnapshot, leaseId: null };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<P2pStartResult>('p2p_start', { displayName });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function stopP2p(leaseId?: string | null): Promise<P2pSnapshot> {
  if (!isDesktopRuntime()) return browserSnapshot;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<P2pSnapshot>('p2p_stop', { leaseId: leaseId ?? null });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getP2pSnapshot(): Promise<P2pSnapshot> {
  if (!isDesktopRuntime()) return browserSnapshot;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<P2pSnapshot>('p2p_snapshot');
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function connectPeer(connectionCode: string): Promise<void> {
  if (!isDesktopRuntime()) throw new P2pError(browserSnapshot.lastError ?? '桌面节点未运行。');
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('p2p_connect', { connectionCode });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function sendDeckOffer(peerId: string, deck: DeckData): Promise<string> {
  if (!canExchangeDeck(deck)) {
    throw new P2pError(
      '个人同人研习套牌仅限本机使用，不能通过 P2P 交换。',
      'P2P_FAN_STUDY_LOCAL_ONLY',
    );
  }
  if (!isDesktopRuntime()) throw new P2pError(browserSnapshot.lastError ?? '桌面节点未运行。');
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('p2p_send_offer', { peerId, deck });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function respondToOffer(
  offerId: string,
  accept: boolean,
  counterDeck?: DeckData,
): Promise<void> {
  if (accept && counterDeck && !canExchangeDeck(counterDeck)) {
    throw new P2pError(
      '个人同人研习套牌仅限本机使用，不能作为交换回赠。',
      'P2P_FAN_STUDY_LOCAL_ONLY',
    );
  }
  if (!isDesktopRuntime()) throw new P2pError(browserSnapshot.lastError ?? '桌面节点未运行。');
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('p2p_respond_offer', {
      offerId,
      accept,
      counterDeck: accept ? counterDeck ?? null : null,
    });
  } catch (error) {
    throw normalizeError(error);
  }
}
