import { createCardBack, createLocalDeckCard, MODE_BY_ID } from '../data.ts';
import {
  planDeckComposition,
  summarizeDeckComposition,
} from '../deck-composition.ts';
import { createRuleKitForMode, summarizeRuleKit } from '../rules.ts';
import { DEFAULT_ART_STYLE_ID, resolveArtStyle, type ArtStyleId } from '../art-styles.ts';
import type {
  CardData,
  DeckData,
  GameModeId,
  RuleKit,
} from '../types';

/**
 * 本地套牌生成（无 AI）。
 *
 * 原来的实现把主题、规则上下文和卡面请求发给用户自配的 OpenAI 兼容端点，
 * 再把返回的图片逐张写回本机。删除 AI 功能后，生成改为完全本地：
 * 按规则配方算出完整盒装的每个槽位，再为每个槽位确定性地派生一张内容
 * 独立的卡牌（名字、称号、数值、技能与玩法绑定均不重复），卡面仍循环
 * 本机内置的 4 张样卡，不联网、不调用任何模型。
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = 'UNKNOWN_ERROR', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export interface GeneratedArtworkPayload {
  dataUrl: string;
  mimeType: string;
}

export interface DeckGenerationProgress {
  completed: number;
  total: number;
  batch: number;
  batchCount: number;
  phase: 'preparing' | 'generating' | 'optimizing' | 'failed' | 'complete';
  /** Global zero-based index of the card carried by this event. */
  cardIndex?: number;
  /** A storage-ready card snapshot emitted as soon as it is assembled. */
  streamedCard?: CardData;
  attempts?: number;
  elapsedMs?: number;
  settled?: number;
  retried?: number;
  retriedIndices?: number[];
  failed?: number;
  failedIndices?: number[];
  failedCards?: string[];
}

export async function generateDeck(
  theme: string,
  modeId: GameModeId,
  requestedArtStyleId: ArtStyleId = DEFAULT_ART_STYLE_ID,
  requestedRuleKit?: RuleKit,
  onProgress?: (progress: DeckGenerationProgress) => void,
): Promise<DeckData> {
  const normalizedTheme = theme.trim();
  if (normalizedTheme.length < 2) {
    throw new ApiError('主题至少需要 2 个字符。', 'INVALID_THEME');
  }
  const artStyleId = resolveArtStyle(requestedArtStyleId).id;
  const ruleKit = requestedRuleKit ?? createRuleKitForMode(modeId, `${MODE_BY_ID[modeId].name}玩法`);
  const plan = planDeckComposition(ruleKit);
  const generatedAt = Date.now();

  const report = (progress: DeckGenerationProgress): void => {
    onProgress?.(progress);
  };
  report({ completed: 0, total: plan.totalCards, batch: 0, batchCount: 1, phase: 'preparing' });

  const cards: CardData[] = [];
  for (let index = 0; index < plan.totalCards; index += 1) {
    const base = createLocalDeckCard(modeId, index, ruleKit);
    const card: CardData = {
      ...base,
      id: `local-${modeId}-${generatedAt}-${index + 1}`,
    };
    cards.push(card);
    report({
      completed: cards.length,
      total: plan.totalCards,
      batch: 1,
      batchCount: 1,
      phase: 'generating',
      cardIndex: index,
      streamedCard: card,
    });
    // 让画布有机会逐张刷新，而不是等整套拼完才一次性出现。
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const deckName = `${normalizedTheme} · 完整套牌`;
  const deck: DeckData = {
    id: `local-${modeId}-${generatedAt}`,
    theme: normalizedTheme,
    name: deckName,
    modeId,
    story: `以「${normalizedTheme}」为题的本地套牌：每张牌的名字、数值与技能均按规则槽位独立派生，卡面沿用本机内置样卡（每种玩法 4 张，按玩法分组循环），未调用任何 AI 服务，可继续编辑、展览与印刷。`,
    rules: summarizeRuleKit(ruleKit),
    cards,
    author: '万象学徒',
    artStyleId,
    cardBack: createCardBack(modeId, deckName, generatedAt >>> 0),
    ruleKit,
    creatorPlaque: {
      displayName: '万象学徒',
      studioName: '万象少年造物局',
      signatureText: '万象学徒',
      sealText: '万象学徒制',
      edition: '本地模板版',
      serialNumber: `WX-${MODE_BY_ID[modeId].index}-${String(generatedAt).slice(-6)}`,
    },
    composition: summarizeDeckComposition(plan, cards.length),
  };
  report({ completed: cards.length, total: plan.totalCards, batch: 1, batchCount: 1, phase: 'complete' });
  return deck;
}

/**
 * 本地“重绘”：在同玩法的 4 张内置样卡之间循环切换卡面，不联网、不生成新图。
 */
export async function regenerateCardArtwork(
  deck: DeckData,
  card: CardData,
  requestedArtStyleId: ArtStyleId = resolveArtStyle(deck.artStyleId).id,
): Promise<GeneratedArtworkPayload> {
  void requestedArtStyleId;
  if (card.modeId !== deck.modeId || !deck.cards.some((candidate) => candidate.id === card.id)) {
    throw new ApiError('当前卡牌不属于此套牌，无法重绘。', 'INVALID_CARD_BRIEF');
  }
  const match = /\/assets\/cards\/starter\/[a-z]+-([1-4])\.jpg/u.exec(card.artUrl);
  const current = match ? Number(match[1]) : 1;
  const next = (current % 4) + 1;
  return {
    dataUrl: `/assets/cards/starter/${card.modeId}-${next}.jpg`,
    mimeType: 'image/jpeg',
  };
}
