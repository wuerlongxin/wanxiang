import type { GameplayRuleModule, RuleParameter } from './types';

export const CUSTOM_DECK_PARTS_PARAMETER_ID = 'customDeckParts';
export const CUSTOM_CARDS_IN_PLAY_PARAMETER_ID = 'customCardsInPlay';
export const MIN_CUSTOM_DECK_CARDS = 12;
export const MAX_CUSTOM_DECK_CARDS = 64;
export const MIN_CUSTOM_SESSION_CARDS = 8;

export interface CustomDeckPart {
  id: string;
  label: string;
  count: number;
}

export interface CustomDeckCompositionSpec {
  parts: CustomDeckPart[];
  totalCards: number;
  cardsInPlay: number;
}

export type CustomDeckPartsParseResult =
  | { ok: true; parts: CustomDeckPart[]; totalCards: number }
  | { ok: false; error: string };

export const DEFAULT_CUSTOM_DECK_PARTS_TEXT = '核心牌：8\n行动牌：12\n事件牌：4';

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

export function parseCustomDeckParts(text: string): CustomDeckPartsParseResult {
  const lines = text
    .split(/[\r\n;；]+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return { ok: false, error: '请至少填写一种牌型，例如“行动牌：24”。' };
  }

  const seen = new Set<string>();
  const parts: CustomDeckPart[] = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^(.+?)[：:=×x*]\s*(\d+)\s*张?$/u);
    if (!match) {
      return { ok: false, error: `第 ${index + 1} 行格式不正确，请使用“牌型：张数”。` };
    }
    const label = match[1].trim();
    const labelLength = Array.from(label).length;
    if (!label || labelLength > 16) {
      return { ok: false, error: `第 ${index + 1} 行的牌型名称需为 1–16 个字符。` };
    }
    const canonicalLabel = label.normalize('NFKC').toLocaleLowerCase('zh-CN');
    if (seen.has(canonicalLabel)) {
      return { ok: false, error: `牌型“${label}”重复，请合并为一项。` };
    }
    seen.add(canonicalLabel);
    const count = Number(match[2]);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_CUSTOM_DECK_CARDS) {
      return { ok: false, error: `“${label}”的张数需为 1–${MAX_CUSTOM_DECK_CARDS}。` };
    }
    parts.push({ id: `custom-part-${String(index + 1).padStart(2, '0')}`, label, count });
  }

  const totalCards = parts.reduce((sum, part) => sum + part.count, 0);
  if (totalCards < MIN_CUSTOM_DECK_CARDS || totalCards > MAX_CUSTOM_DECK_CARDS) {
    return {
      ok: false,
      error: `完整盒装需为 ${MIN_CUSTOM_DECK_CARDS}–${MAX_CUSTOM_DECK_CARDS} 张，当前合计 ${totalCards} 张。`,
    };
  }
  return { ok: true, parts, totalCards };
}

export function formatCustomDeckParts(parts: readonly Pick<CustomDeckPart, 'label' | 'count'>[]): string {
  return parts.map((part) => `${part.label}：${part.count}`).join('\n');
}

function defaultParts(): CustomDeckPart[] {
  const parsed = parseCustomDeckParts(DEFAULT_CUSTOM_DECK_PARTS_TEXT);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.parts;
}

export function createCustomCompositionParameters(
  partsText = DEFAULT_CUSTOM_DECK_PARTS_TEXT,
  requestedCardsInPlay?: number,
): RuleParameter[] {
  const parsed = parseCustomDeckParts(partsText);
  if (!parsed.ok) throw new RangeError(parsed.error);
  const parts = parsed.parts;
  const totalCards = parts.reduce((sum, part) => sum + part.count, 0);
  const minimumCardsInPlay = Math.min(MIN_CUSTOM_SESSION_CARDS, totalCards);
  if (requestedCardsInPlay !== undefined && (
    !Number.isSafeInteger(requestedCardsInPlay)
    || requestedCardsInPlay < minimumCardsInPlay
    || requestedCardsInPlay > totalCards
  )) {
    throw new RangeError(`标准单局投入需为 ${minimumCardsInPlay}–${totalCards} 张。`);
  }
  const cardsInPlay = requestedCardsInPlay ?? totalCards;
  return [
    {
      id: CUSTOM_DECK_PARTS_PARAMETER_ID,
      label: '牌组构成',
      control: 'text',
      value: formatCustomDeckParts(parts),
    },
    {
      id: CUSTOM_CARDS_IN_PLAY_PARAMETER_ID,
      label: '标准单局投入',
      control: 'stepper',
      value: cardsInPlay,
      min: minimumCardsInPlay,
      max: totalCards,
      step: 1,
      unit: '张',
    },
  ];
}

export function resolveCustomDeckComposition(module: GameplayRuleModule): CustomDeckCompositionSpec {
  const partsValue = module.parameters.find(
    (parameter) => parameter.id === CUSTOM_DECK_PARTS_PARAMETER_ID,
  )?.value;
  const parsed = parseCustomDeckParts(
    typeof partsValue === 'string' ? partsValue : DEFAULT_CUSTOM_DECK_PARTS_TEXT,
  );
  const parts = parsed.ok ? parsed.parts : defaultParts();
  const totalCards = parts.reduce((sum, part) => sum + part.count, 0);
  const cardsInPlayValue = module.parameters.find(
    (parameter) => parameter.id === CUSTOM_CARDS_IN_PLAY_PARAMETER_ID,
  )?.value;
  return {
    parts,
    totalCards,
    cardsInPlay: clampInteger(
      cardsInPlayValue,
      totalCards,
      Math.min(MIN_CUSTOM_SESSION_CARDS, totalCards),
      totalCards,
    ),
  };
}
