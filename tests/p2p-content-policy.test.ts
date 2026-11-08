import assert from 'node:assert/strict';
import test from 'node:test';

import { createFanStudyDeckContentPolicy } from '../src/services/content-policy.ts';
import { P2pError, respondToOffer, sendDeckOffer } from '../src/services/p2p.ts';
import type { CardData, DeckData } from '../src/types.ts';

type Restore = () => void;

function replaceGlobal(name: string, value: unknown): Restore {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  };
}

function card(id: string, name: string): CardData {
  return {
    id,
    name,
    title: '交换测试卡',
    modeId: 'strategy',
    artUrl: '/assets/cards/strategy.jpg',
    attack: 4,
    defense: 4,
    cost: 2,
    skill: '用于验证交换边界。',
    flavor: '生成完成后即可交换作品。',
    rarity: '普通',
    author: '测试作者',
  };
}

function originalDeck(cards: CardData[]): DeckData {
  return {
    id: 'original-exchange-deck',
    theme: '原创交换测试',
    name: '星桥交换套牌',
    modeId: 'strategy',
    story: '原创机关师通过星桥交换研究成果。',
    rules: '轮流行动。',
    cards,
    author: '测试作者',
  };
}

function fanStudyDeck(): DeckData {
  return {
    id: 'fan-study-local-only',
    theme: '个人同人研习',
    name: '本机研习套牌',
    modeId: 'strategy',
    story: '仅保存在本机。',
    rules: '轮流行动。',
    cards: [{
      id: 'fan-study-card',
      name: '研习卡',
      title: '本机样卡',
      modeId: 'strategy',
      artUrl: '/assets/cards/strategy.jpg',
      attack: 4,
      defense: 4,
      cost: 2,
      skill: '仅用于测试本机交换边界。',
      flavor: '不进入网络。',
      rarity: '普通',
      author: '测试作者',
    }],
    author: '测试作者',
    contentPolicy: createFanStudyDeckContentPolicy({
      materialsRightsConfirmed: true,
      personalNonCommercialConfirmed: true,
      unofficialAndUnaffiliatedConfirmed: true,
      guardianJointlyConfirmed: true,
    }, 1_800_000_000_000),
  };
}

test('rejects a fan-study deck before any desktop P2P call', async () => {
  await assert.rejects(
    sendDeckOffer('unused-peer', fanStudyDeck()),
    (error) => error instanceof P2pError && error.code === 'P2P_FAN_STUDY_LOCAL_ONLY',
  );
});

test('allows local and generated cards directly through the desktop boundary', async () => {
  const calls: Array<{ command: string; args: unknown }> = [];
  const restoreWindow = replaceGlobal('window', {
    __TAURI_INTERNALS__: {
      invoke: async (command: string, args: unknown) => {
        calls.push({ command, args });
        return command === 'p2p_send_offer' ? 'offer-approved' : undefined;
      },
    },
  });
  const deck = originalDeck([
    card('hand-painted-local', '手绘司南'),
    card('ai-generated-card', '星铸灵牌'),
  ]);

  try {
    assert.equal(await sendDeckOffer('peer-approved', deck), 'offer-approved');
    await respondToOffer('incoming-offer', true, deck);
    assert.deepEqual(calls.map((call) => call.command), [
      'p2p_send_offer',
      'p2p_respond_offer',
    ]);
  } finally {
    restoreWindow();
  }
});
