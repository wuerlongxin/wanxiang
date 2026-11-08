import { resolve } from 'node:path';

import {
  gameplayBindingsForSlot,
  planDeckComposition,
  summarizeDeckComposition,
} from '../src/deck-composition.ts';
import { createCardBack, createStarterCard } from '../src/data.ts';
import { createRuleKitForMode, summarizeRuleKit } from '../src/rules.ts';
import { createOriginalDeckContentPolicy } from '../src/services/content-policy.ts';
import type { CardData, DeckData } from '../src/types.ts';

export const COMPLETE_PRINT_PROOF_CARD_COUNT = 56;

const CATEGORY_NAMES = ['朱雀火候', '青龙水衡', '白虎金策', '玄武土序'] as const;
const CATEGORY_GLYPHS = ['朱', '青', '白', '玄'] as const;
const ROLE_NAMES = [
  '司南童',
  '衡尺师',
  '星算盘',
  '云炉使',
  '榫卯匠',
  '灵纹官',
  '刻漏师',
  '巡阵客',
  '藏锋使',
  '听潮童',
  '照影官',
  '布星师',
  '观象使',
  '定衡君',
] as const;

function rarityFor(value: number): CardData['rarity'] {
  if (value >= 5) return '传说';
  if (value === 4) return '史诗';
  if (value === 3) return '稀有';
  return '普通';
}

export function createCompletePrintProofDeck(
  artworkRoot: string,
  deckName = '万象万象 · 完整策略套牌',
): DeckData {
  const ruleKit = createRuleKitForMode('strategy', '四象衡数 · 完整玩法说明书');
  ruleKit.customNotes = [
    '校样牌组严格按四个数量类别各十四张组成，所有牌都带有可机读的数量玩法绑定。',
    '正式游玩时，二至三人可选三个完整类别共四十二张；四至六人使用完整五十六张。',
    '此文件为 RGB 印刷校样，正式生产前仍需由印厂按纸张与 ICC 配置完成 CMYK 转换和实物打样。',
  ];
  const plan = planDeckComposition(ruleKit);
  if (plan.totalCards !== COMPLETE_PRINT_PROOF_CARD_COUNT) {
    throw new Error(`策略玩法规划应为 ${COMPLETE_PRINT_PROOF_CARD_COUNT} 张，实际为 ${plan.totalCards} 张。`);
  }

  const cards = plan.slots.map((slot, index): CardData => {
    const category = Number(slot.attributes.category);
    const quantityValue = Number(slot.attributes.quantityValue);
    const categoryIndex = Math.max(0, Math.min(CATEGORY_NAMES.length - 1, category - 1));
    const categoryName = CATEGORY_NAMES[categoryIndex];
    const variant = Number(slot.attributes.variant);
    const roleName = ROLE_NAMES[index % ROLE_NAMES.length];
    const base = createStarterCard('strategy', index);
    return {
      ...base,
      id: `print-proof-strategy-${String(index + 1).padStart(2, '0')}`,
      name: `${CATEGORY_GLYPHS[categoryIndex]}曜${roleName}`,
      title: `${categoryName} · 数值 ${quantityValue}`,
      artUrl: resolve(artworkRoot, `strategy-${(index % 4) + 1}.jpg`),
      attack: 3 + ((index * 3 + quantityValue) % 7),
      defense: 3 + ((index * 5 + category) % 7),
      cost: Math.max(1, Math.min(7, quantityValue + ((variant - 1) % 3))),
      rarity: rarityFor(quantityValue),
      skill: `出牌后为「${categoryName}」累计 ${quantityValue} 点；桌面同类总数恰好达到 5 时，抢先触发并收取全部公开牌。`,
      flavor: `第 ${String(index + 1).padStart(2, '0')} 枚衡数机关沿${categoryName}的星轨归位。`,
      author: '万象校样局',
      inscriptionStyle: index % 3 === 0 ? 'signature' : 'seal',
      inscriptionPlacement: index % 5 === 0 ? 'back' : 'front',
      inscriptionText: '万象校样',
      gameplay: gameplayBindingsForSlot(plan, slot),
    };
  });

  return {
    id: 'print-proof-strategy-complete-v1',
    theme: '四象机关城与衡数星轨',
    name: deckName,
    modeId: 'strategy',
    story:
      '四座机关台以朱雀、青龙、白虎、玄武为序记录天地间的数量变化。少年匠师必须让每次落牌都恰到好处，才能在第五道星辉汇聚时唤醒天衡。',
    rules: summarizeRuleKit(ruleKit),
    cards,
    author: '万象校样局',
    artStyleId: 'dunhuang-mineral',
    cardBack: createCardBack('strategy', deckName, 20260730),
    ruleKit,
    creatorPlaque: {
      displayName: '万象校样局',
      studioName: 'Wanxiang Deck Print Lab',
      signatureText: '万象 · 衡数',
      sealText: '万象校样',
      edition: '完整套牌 RGB 校样第一版',
      serialNumber: 'AD-QA-STRATEGY-056',
      dedication: '用于验证完整套牌的正反面对位、裁切线、规则说明书与创作者铭牌。',
    },
    composition: summarizeDeckComposition(plan, cards.length),
    revision: {
      familyId: 'print-proof-strategy-family',
      revision: 1,
      createdAt: Date.UTC(2026, 6, 30, 0, 0, 0),
      reason: 'manual-snapshot',
    },
    contentPolicy: createOriginalDeckContentPolicy(),
  };
}
