import type {
  CardGameplayBinding,
  DeckComposition,
  DeckData,
  DeckPlaySetup,
  GameModeId,
  GameplayMechanicId,
  GameplayRuleModule,
  RuleKit,
  RuleParameterValue,
} from './types';
import {
  compareRuleModuleIds,
  normalizeRuleKitModuleIds,
} from './rule-kit-constraints.ts';
import {
  resolveCustomDeckComposition,
  type CustomDeckCompositionSpec,
} from './custom-composition.ts';

export type DeckCompositionKind = GameModeId | 'custom';
export type DeckCompositionSource = 'mode-default' | 'rule-kit';
export type DeckConstraintKind = 'exact' | 'range' | 'distribution' | 'relationship' | 'uniqueness';

export type DeckCompositionValue =
  | string
  | number
  | boolean
  | null
  | DeckCompositionValue[]
  | { [key: string]: DeckCompositionValue };

export interface DeckCompositionPart {
  id: string;
  label: string;
  count: number;
  purpose: string;
}

export interface DeckCompositionConstraint {
  id: string;
  kind: DeckConstraintKind;
  label: string;
  value: DeckCompositionValue;
  description: string;
}

export interface DeckCompositionSlot {
  id: string;
  index: number;
  partId: string;
  role: string;
  uniqueKey: string;
  attributes: Record<string, DeckCompositionValue>;
  plannedBindings?: CardGameplayBinding[];
}

export interface DeckCompositionPlan {
  schemaVersion: 1;
  kind: DeckCompositionKind;
  source: DeckCompositionSource;
  totalCards: number;
  parts: DeckCompositionPart[];
  constraints: DeckCompositionConstraint[];
  slots: DeckCompositionSlot[];
  rationale: string[];
  playSetup: DeckPlaySetup;
}

export interface DeckCompositionState {
  composition: DeckComposition;
  validation: DeckCompositionValidation;
  currentTotal: number;
  recommendedTotal: number;
  remaining: number;
  excess: number;
  summary: string;
}

export interface DeckPrintReadiness extends DeckCompositionState {
  ready: boolean;
  message: string;
}

export type DeckCompositionValidationIssueCode =
  | 'card-count'
  | 'missing-gameplay-bindings'
  | 'unexpected-gameplay-bindings'
  | 'surface-density-overflow'
  | 'rapid-symbol-overflow';

export interface DeckCompositionValidationIssue {
  code: DeckCompositionValidationIssueCode;
  message: string;
  count: number;
}

export interface DeckCompositionValidation {
  valid: boolean;
  expectedCardCount: number;
  actualCardCount: number;
  expectedBindingCount: number;
  actualBindingCount: number;
  issues: DeckCompositionValidationIssue[];
}

interface FunctionFamily {
  id: string;
  label: string;
  count: number;
  purpose: string;
}

interface ModuleRequirement {
  module: GameplayRuleModule;
  mechanic: GameplayMechanicId | 'custom';
  minimum: number;
  customComposition?: CustomDeckCompositionSpec;
}

interface ProjectedRole {
  binding: CardGameplayBinding;
  spec: { [key: string]: DeckCompositionValue };
}

interface CombinedStageSetup {
  minimum: number;
  maximum: number;
  standard: number;
  instruction: string;
}

const MODE_MECHANICS: Record<GameModeId, GameplayMechanicId> = {
  reflex: 'rapid-match',
  memory: 'memory-pair',
  strategy: 'quantity-trigger',
  expression: 'icon-coop',
  mischief: 'risk-draw',
};

const MECHANIC_MODES: Record<GameplayMechanicId, GameModeId> = {
  'rapid-match': 'reflex',
  'memory-pair': 'memory',
  'quantity-trigger': 'strategy',
  'icon-coop': 'expression',
  'risk-draw': 'mischief',
};

const DEFAULT_STRATEGY_VALUE_DISTRIBUTION = [
  { value: 1, count: 5 },
  { value: 2, count: 3 },
  { value: 3, count: 3 },
  { value: 4, count: 2 },
  { value: 5, count: 1 },
] as const;

const EXPRESSION_CATEGORIES = [
  { id: 'living', label: '角色与生灵', count: 12 },
  { id: 'object', label: '器物与造物', count: 12 },
  { id: 'place', label: '地点与环境', count: 8 },
  { id: 'action', label: '动作与事件', count: 8 },
  { id: 'concept', label: '情绪与概念', count: 8 },
] as const;

const MEMORY_FACTION_IDS = ['faction-朱', 'faction-青'] as const;

const MISCHIEF_FUNCTIONS: readonly FunctionFamily[] = [
  { id: 'skip', label: '跳过', count: 6, purpose: '结束或跳过当前抽牌阶段。' },
  { id: 'reverse', label: '反转', count: 5, purpose: '改变回合进行方向。' },
  { id: 'attack', label: '追击', count: 6, purpose: '将额外回合压力交给下一位玩家。' },
  { id: 'forecast', label: '未来视界', count: 6, purpose: '查看牌库顶部的风险信息。' },
  { id: 'reorder', label: '篡序', count: 5, purpose: '重新排列已查看的牌库顶牌。' },
  { id: 'steal', label: '偷取', count: 6, purpose: '随机获得对手的一张手牌。' },
  { id: 'exchange', label: '交换', count: 5, purpose: '与指定玩家交换手牌资源。' },
  { id: 'demand', label: '索要', count: 6, purpose: '指定类型向对手索要一张牌。' },
];

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function normalizePlayerRange(
  value: RuleKit['playerRange'] | undefined,
  fallback: RuleKit['playerRange'],
): RuleKit['playerRange'] {
  const min = clampInteger(value?.min, fallback.min, 1, 8);
  const max = clampInteger(value?.max, fallback.max, min, 8);
  return { min, max };
}

function defaultPlayersFor(range: RuleKit['playerRange'], preferred = 4): number {
  return clampInteger(preferred, preferred, range.min, range.max);
}

function exactPlaySetup(
  totalCards: number,
  playerRange: RuleKit['playerRange'],
  formula: string,
  auxiliaryComponents: string[],
  preferredPlayers = 4,
): DeckPlaySetup {
  const defaultPlayers = defaultPlayersFor(playerRange, preferredPlayers);
  return {
    playerRange,
    defaultPlayers,
    cardsInPlay: { min: totalCards, max: totalCards, default: totalCards },
    formula,
    summary: `${defaultPlayers}人标准局投入 ${totalCards} 张（整套使用）`,
    auxiliaryComponents,
  };
}

function strategyValueDistribution(
  targetTotal: number,
  cardsPerCategory = 14,
): Array<{ value: number; count: number }> {
  const target = clampInteger(targetTotal, 5, 2, 12);
  const safeCardCount = Math.max(target, Math.round(cardsPerCategory));
  if (target === 5 && safeCardCount === 14) {
    return DEFAULT_STRATEGY_VALUE_DISTRIBUTION.map((entry) => ({ ...entry }));
  }

  const counts = Array.from({ length: target }, () => 1);
  const remaining = safeCardCount - target;
  const weights = Array.from({ length: target }, (_, index) => target - index);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = weights.map((weight) => remaining * weight / weightTotal);
  const allocated = exact.map((value) => Math.floor(value));
  let remainder = remaining - allocated.reduce((sum, count) => sum + count, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - allocated[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < remainder; index += 1) allocated[order[index].index] += 1;
  remainder = 0;
  return counts.map((count, index) => ({ value: index + 1, count: count + allocated[index] }));
}

function proportionalCounts(total: number, weights: readonly number[]): number[] {
  if (!weights.length) return [];
  const safeTotal = Math.max(0, Math.round(total));
  const weightTotal = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0) || weights.length;
  const exact = weights.map((weight) => safeTotal * Math.max(0, weight) / weightTotal);
  const counts = exact.map((value) => Math.floor(value));
  let remaining = safeTotal - counts.reduce((sum, count) => sum + count, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - counts[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) counts[order[index].index] += 1;
  remaining = 0;
  return counts;
}

function expandCountedValues<T>(entries: readonly { value: T; count: number }[]): T[] {
  return entries.flatMap((entry) => Array.from({ length: entry.count }, () => entry.value));
}

function twoDigit(value: number): string {
  return String(value).padStart(2, '0');
}

function constraint(
  id: string,
  kind: DeckConstraintKind,
  label: string,
  value: DeckCompositionValue,
  description: string,
): DeckCompositionConstraint {
  return { id, kind, label, value, description };
}

function parameterValue(module: GameplayRuleModule, id: string): RuleParameterValue | undefined {
  return module.parameters.find((parameter) => parameter.id === id)?.value;
}

function moduleMechanic(module: GameplayRuleModule): GameplayMechanicId | 'custom' {
  const candidate = module.templateId;
  return candidate && candidate in MECHANIC_MODES ? candidate : 'custom';
}

function minimumPlayersForModules(modules: readonly GameplayRuleModule[]): number {
  if (modules.some((module) => moduleMechanic(module) === 'icon-coop')) return 3;
  if (modules.some((module) => moduleMechanic(module) !== 'custom')) return 2;
  return 1;
}

function buildProjectivePlane(order: number): string[][] {
  const pointId = (x: number, y: number) => `symbol-${twoDigit(y * order + x + 1)}`;
  const infinityId = (slope: number) => `symbol-${twoDigit(order * order + slope + 1)}`;
  const verticalInfinityId = `symbol-${twoDigit(order * order + order + 1)}`;
  const lines: string[][] = [];

  for (let slope = 0; slope < order; slope += 1) {
    for (let intercept = 0; intercept < order; intercept += 1) {
      const symbols = Array.from({ length: order }, (_, x) => {
        const y = (slope * x + intercept) % order;
        return pointId(x, y);
      });
      lines.push([...symbols, infinityId(slope)]);
    }
  }

  for (let x = 0; x < order; x += 1) {
    const symbols = Array.from({ length: order }, (_, y) => pointId(x, y));
    lines.push([...symbols, verticalInfinityId]);
  }

  lines.push([
    ...Array.from({ length: order }, (_, slope) => infinityId(slope)),
    verticalInfinityId,
  ]);
  return lines;
}

function createReflexPlan(
  source: DeckCompositionSource = 'mode-default',
  playerRange = normalizePlayerRange(undefined, { min: 2, max: 6 }),
  moduleId = 'rapid-match',
  matchRule = 'same-symbol',
): DeckCompositionPlan {
  const lines = buildProjectivePlane(5);
  const slots = lines.map((symbolIds, index): DeckCompositionSlot => ({
    id: `reflex-${twoDigit(index + 1)}`,
    index,
    partId: 'match-card',
    role: '唯一同纹牌',
    uniqueKey: `reflex-line-${twoDigit(index + 1)}`,
    attributes: {
      moduleId,
      matchRule,
      symbolIds,
      symbolCount: symbolIds.length,
      contentDirective: '在统一世界观中使用独立角色、动作与构图，不复用其他槽位的主画面。',
    },
  }));

  return {
    schemaVersion: 1,
    kind: 'reflex',
    source,
    totalCards: 31,
    parts: [{ id: 'match-card', label: '唯一同纹牌', count: 31, purpose: '供所有玩家同步观察与抢答。' }],
    constraints: [
      constraint('symbol-pool', 'exact', '符号池', 31, '整套牌使用 31 个可辨识符号。'),
      constraint('symbols-per-card', 'exact', '每牌符号', 6, '每张牌恰好布置 6 个符号。'),
      constraint('pairwise-intersection', 'relationship', '两牌唯一交集', 1, '任意两张牌恰好共享 1 个符号。'),
      constraint('symbol-frequency', 'exact', '符号出现次数', 6, '每个符号在整套牌中恰好出现 6 次。'),
      constraint('unique-content', 'uniqueness', '主画面不重复', true, '数学符号结构统一，但每张牌的角色、名称与构图必须不同。'),
    ],
    slots,
    rationale: [
      '采用 5 阶有限射影平面，31 张牌与 31 个符号形成严格对称结构。',
      '这个规模能保证任意两牌都有且仅有一个共同符号，可直接用于抢答。',
    ],
    playSetup: exactPlaySetup(
      31,
      playerRange,
      '每人亮出 1 张观察牌，中央翻开 1 张公共牌，其余组成补给牌库；每次成功后补回观察牌，整套 31 张都会进入本局。',
      ['回合标记 1 枚（可选）'],
    ),
  };
}

function createMemoryPlan(
  pairCount: number,
  source: DeckCompositionSource,
  playerRange = normalizePlayerRange(undefined, { min: 2, max: 6 }),
  moduleId = 'memory-pair',
  factionMode = false,
): DeckCompositionPlan {
  const safePairCount = clampInteger(pairCount, 24, 6, 32);
  const slots: DeckCompositionSlot[] = [];

  for (let pairIndex = 0; pairIndex < safePairCount; pairIndex += 1) {
    const pairId = `pair-${twoDigit(pairIndex + 1)}`;
    const factionId = factionMode ? MEMORY_FACTION_IDS[pairIndex % MEMORY_FACTION_IDS.length] : undefined;
    const slotA = `memory-${twoDigit(pairIndex + 1)}-a`;
    const slotB = `memory-${twoDigit(pairIndex + 1)}-b`;
    slots.push({
      id: slotA,
      index: slots.length,
      partId: 'pair-side-a',
      role: '配对线索 A',
      uniqueKey: `${pairId}-a`,
      attributes: {
        moduleId,
        pairId,
        pairSide: 'A',
        ...(factionId ? { factionId } : {}),
        complementSlotId: slotB,
        contentDirective: '表现同一识别核心的起因、正面或上半段，与 B 牌互补但不复制画面。',
      },
    });
    slots.push({
      id: slotB,
      index: slots.length,
      partId: 'pair-side-b',
      role: '配对线索 B',
      uniqueKey: `${pairId}-b`,
      attributes: {
        moduleId,
        pairId,
        pairSide: 'B',
        ...(factionId ? { factionId } : {}),
        complementSlotId: slotA,
        contentDirective: '表现同一识别核心的结果、反面或下半段，与 A 牌互补但不复制画面。',
      },
    });
  }

  const totalCards = safePairCount * 2;
  const defaultPlayers = defaultPlayersFor(playerRange, 4);
  const minimumPairs = Math.min(safePairCount, 12);
  const defaultCardsInPlay = Math.min(totalCards, defaultPlayers <= 2 ? 24 : defaultPlayers <= 4 ? 36 : 48);
  return {
    schemaVersion: 1,
    kind: 'memory',
    source,
    totalCards,
    parts: [
      { id: 'pair-side-a', label: '配对线索 A', count: safePairCount, purpose: '提供每组配对的第一个视觉线索。' },
      { id: 'pair-side-b', label: '配对线索 B', count: safePairCount, purpose: '以互补画面完成识别关系。' },
    ],
    constraints: [
      constraint('pair-count', 'exact', '配对数', safePairCount, '每组恰好由 A/B 两张牌组成。'),
      constraint('cards-per-pair', 'exact', '每组张数', 2, '不存在单张或第三张重复配对牌。'),
      constraint('complementary-art', 'relationship', '互补而非复制', true, 'A/B 共享识别核心，但角色状态、动作或构图必须不同。'),
      ...(factionMode
        ? [constraint('faction-balance', 'distribution', '双层阵营', {
            '朱': Math.ceil(safePairCount / 2) * 2,
            '青': Math.floor(safePairCount / 2) * 2,
          }, '同一对 A/B 阵营必须相同，不同配对在朱、青两阵营间均衡交错。')]
        : []),
      constraint('deck-range', 'range', '实体套牌范围', { min: 12, max: 64 }, '配对数会在完整成对的前提下控制在本地系统容量内。'),
    ],
    slots,
    rationale: [
      `本规划使用 ${safePairCount} 对、共 ${totalCards} 张牌，能平铺为稳定网格并提供足够的位置记忆深度。`,
      '互补 A/B 槽位既保留配对可辨识性，又确保每张牌都是独立内容。',
      ...(factionMode ? ['已采用双层配对变体：图案与阵营必须同时吻合。'] : []),
    ],
    playSetup: {
      playerRange,
      defaultPlayers,
      cardsInPlay: { min: minimumPairs * 2, max: totalCards, default: defaultCardsInPlay },
      formula: `必须按 pairId 成对取牌；2 人推荐 24 张、3–4 人推荐 36 张、5–6 人推荐 48 张，盒装不足时使用全部 ${totalCards} 张。`,
      summary: `${defaultPlayers}人标准局投入 ${defaultCardsInPlay} 张（盒装 ${safePairCount} 对 / ${totalCards} 张）`,
      auxiliaryComponents: ['计分标记每位玩家 1 枚', '回合标记 1 枚（可选）'],
    },
  };
}

function normalizeQuantityTriggerRelation(value: unknown): 'exact' | 'at-least' | 'two-types' {
  return value === 'at-least' || value === 'two-types' ? value : 'exact';
}

function createStrategyPlan(
  source: DeckCompositionSource = 'mode-default',
  targetTotal = 5,
  playerRange = normalizePlayerRange(undefined, { min: 2, max: 6 }),
  moduleId = 'quantity-trigger',
  triggerRelation = 'exact',
): DeckCompositionPlan {
  const safeTargetTotal = clampInteger(targetTotal, 5, 2, 12);
  const safeTriggerRelation = normalizeQuantityTriggerRelation(triggerRelation);
  const valueDistribution = strategyValueDistribution(safeTargetTotal);
  const defaultPlayers = defaultPlayersFor(playerRange, 4);
  const minimumCardsInPlay = playerRange.min <= 3 ? 42 : 56;
  const defaultCardsInPlay = defaultPlayers <= 3 ? 42 : 56;
  const parts: DeckCompositionPart[] = [];
  const slots: DeckCompositionSlot[] = [];
  for (let category = 1; category <= 4; category += 1) {
    const partId = `category-${category}`;
    parts.push({
      id: partId,
      label: `数量类别 ${category}`,
      count: 14,
      purpose: '形成可在桌面独立累加与触发的统一类别。',
    });
    for (const distribution of valueDistribution) {
      for (let variant = 1; variant <= distribution.count; variant += 1) {
        const id = `strategy-c${category}-v${distribution.value}-${twoDigit(variant)}`;
        slots.push({
          id,
          index: slots.length,
          partId,
          role: `类别 ${category} · 数值 ${distribution.value}`,
          uniqueKey: id,
          attributes: {
            moduleId,
            category,
            quantityValue: distribution.value,
            targetTotal: safeTargetTotal,
            triggerRelation: safeTriggerRelation,
            variant,
            contentDirective: '同类保持标记一致，但角色、动作、场景与名称不得重复。',
          },
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    kind: 'strategy',
    source,
    totalCards: 56,
    parts,
    constraints: [
      constraint('category-count', 'exact', '类别数', 4, '四类标记等量出现，每类 14 张。'),
      constraint(
        'value-distribution',
        'distribution',
        '单类数值分布',
        Object.fromEntries(valueDistribution.map((entry) => [entry.value, entry.count])),
        `每类 14 张牌按目标值 ${safeTargetTotal} 重新分配数值，低数值更常见且每个合法数值至少出现 1 次。`,
      ),
      constraint('target-total', 'exact', '触发目标值', safeTargetTotal, `牌面数值与触发判定统一围绕 ${safeTargetTotal} 生成。`),
      constraint('trigger-relation', 'exact', '触发关系', safeTriggerRelation, '所有数量牌使用同一触发关系，牌面、说明书与结算保持一致。'),
      constraint('unique-content', 'uniqueness', '槽位内容唯一', true, '即使数值相同，每张牌也必须是独立的角色与画面。'),
    ],
    slots,
    rationale: [
      '56 张可支持 2–6 人连续出牌，四类等量避免某一类天然稀缺。',
      `数值 1 更常见、接近 ${safeTargetTotal} 的数值更稀有，使触发既可计算又不会过度频繁。`,
    ],
    playSetup: {
      playerRange,
      defaultPlayers,
      cardsInPlay: { min: minimumCardsInPlay, max: 56, default: defaultCardsInPlay },
      formula: '2–3 人短局可选 3 个完整类别共 42 张；4–6 人标准局使用 4 类共 56 张。不得拆散单个类别的数值分布。',
      summary: `${defaultPlayers}人标准局投入 ${defaultCardsInPlay} 张（盒装 56 张，目标值 ${safeTargetTotal}）`,
      auxiliaryComponents: ['中央触发标记 1 枚', '计分标记 12 枚'],
    },
  };
}

function createExpressionPlan(
  source: DeckCompositionSource = 'mode-default',
  targetCount = 48,
  playerRange = normalizePlayerRange(undefined, { min: 3, max: 8 }),
  moduleId = 'icon-coop',
): DeckCompositionPlan {
  const safeTargetCount = clampInteger(targetCount, 48, 24, 64);
  const categoryCounts = EXPRESSION_CATEGORIES.map((category) =>
    Math.floor(safeTargetCount * category.count / 48),
  );
  let categoryRemainder = safeTargetCount - categoryCounts.reduce((sum, count) => sum + count, 0);
  for (let index = 0; categoryRemainder > 0; index = (index + 1) % categoryCounts.length) {
    categoryCounts[index] += 1;
    categoryRemainder -= 1;
  }
  const parts: DeckCompositionPart[] = [];
  const slots: DeckCompositionSlot[] = [];
  for (const [categoryIndex, category] of EXPRESSION_CATEGORIES.entries()) {
    const count = categoryCounts[categoryIndex];
    parts.push({
      id: category.id,
      label: category.label,
      count,
      purpose: '为无语表达提供题材边界明确的目标牌。',
    });
    for (let index = 1; index <= count; index += 1) {
      const id = `expression-${category.id}-${twoDigit(index)}`;
      slots.push({
        id,
        index: slots.length,
        partId: category.id,
        role: category.label,
        uniqueKey: `target-${category.id}-${twoDigit(index)}`,
        attributes: {
          moduleId,
          targetCategory: category.id,
          targetIndex: index,
          contentDirective: '目标必须能被多种视觉线索表达，且不与套牌内任何其他目标同义。',
        },
      });
    }
  }

  const defaultPlayers = defaultPlayersFor(playerRange, 6);
  const cardsForPlayers = (players: number) => Math.min(
    safeTargetCount,
    players <= 4 ? 24 : players <= 6 ? 36 : 48,
  );
  const defaultCardsInPlay = cardsForPlayers(defaultPlayers);
  const setupFormula = safeTargetCount <= 24
    ? `3–8 人均使用全部 ${safeTargetCount} 张目标牌。`
    : safeTargetCount <= 36
      ? `3–4 人取 24 张，5–8 人使用全部 ${safeTargetCount} 张；均按五类目标的原比例抽取。`
      : safeTargetCount <= 48
        ? `3–4 人取 24 张、5–6 人取 36 张、7–8 人使用全部 ${safeTargetCount} 张；均按五类目标的原比例抽取。`
        : `3–4 人取 24 张、5–6 人取 36 张、7–8 人取 48 张；其余 ${safeTargetCount - 48} 张作为轮换目标，换局时按五类原比例替换。`;
  return {
    schemaVersion: 1,
    kind: 'expression',
    source,
    totalCards: safeTargetCount,
    parts,
    constraints: [
      constraint('target-count', 'exact', '独立目标数', safeTargetCount, '每张卡牌都是一个唯一猜测目标。'),
      constraint('category-distribution', 'distribution', '目标类别分布', Object.fromEntries(parts.map((part) => [part.id, part.count])), '具体目标略多，抽象目标较少，适合青少年逐步提升表达难度。'),
      constraint('semantic-uniqueness', 'uniqueness', '语义唯一', true, '禁止同义词、同一角色的换名版或只改色复制。'),
    ],
    slots,
    rationale: [
      `${safeTargetCount} 个唯一目标可支持多轮团队游戏，不会过早重复题目。`,
      '五类题材同时覆盖具体物与抽象概念，便于自动生成由浅入深的说明书。',
    ],
    playSetup: {
      playerRange,
      defaultPlayers,
      cardsInPlay: {
        min: cardsForPlayers(playerRange.min),
        max: cardsForPlayers(playerRange.max),
        default: defaultCardsInPlay,
      },
      formula: setupFormula,
      summary: `${defaultPlayers}人标准局投入 ${defaultCardsInPlay} 张目标牌（盒装 ${safeTargetCount} 张）`,
      auxiliaryComponents: ['可打印图标板 1 张', '提示标记 8 枚', '回合标记 1 枚', '计时器 1 个'],
    },
  };
}

function distributedFunctionCounts(total: number): FunctionFamily[] {
  const baseTotal = MISCHIEF_FUNCTIONS.reduce((sum, family) => sum + family.count, 0);
  const raw = MISCHIEF_FUNCTIONS.map((family) => ({
    family,
    exact: total * family.count / baseTotal,
  }));
  const counts = raw.map((entry) => Math.floor(entry.exact));
  let remaining = total - counts.reduce((sum, count) => sum + count, 0);
  const order = raw
    .map((entry, index) => ({ index, remainder: entry.exact - counts[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < remaining; index += 1) counts[order[index].index] += 1;
  remaining = 0;
  return MISCHIEF_FUNCTIONS.map((family, index) => ({ ...family, count: counts[index] }));
}

function createMischiefPlan(
  source: DeckCompositionSource = 'mode-default',
  hazardCount = 5,
  rescueCount = 6,
  totalCards = 56,
  playerRange = normalizePlayerRange(undefined, { min: 2, max: 6 }),
  moduleId = 'risk-draw',
): DeckCompositionPlan {
  const safeHazards = Math.max(
    clampInteger(hazardCount, 5, 1, 8),
    Math.min(8, playerRange.max - 1),
  );
  const safeRescues = Math.max(
    clampInteger(rescueCount, 6, 1, 10),
    Math.min(10, playerRange.max),
  );
  const safeTotal = clampInteger(
    Math.max(totalCards, 45 + safeHazards + safeRescues),
    56,
    Math.max(12, safeHazards + safeRescues + 8),
    64,
  );
  const functionCount = safeTotal - safeHazards - safeRescues;
  const functions = functionCount === 45 ? MISCHIEF_FUNCTIONS.map((family) => ({ ...family })) : distributedFunctionCounts(functionCount);
  const parts: DeckCompositionPart[] = [
    { id: 'hazard', label: '危机牌', count: safeHazards, purpose: '作为抽牌阶段的淘汰风险。' },
    { id: 'rescue', label: '护航牌', count: safeRescues, purpose: '解除危机并允许重新放置风险。' },
    ...functions.map((family) => ({
      id: `function-${family.id}`,
      label: `${family.label}功能牌`,
      count: family.count,
      purpose: family.purpose,
    })),
  ];
  const slots: DeckCompositionSlot[] = [];
  const pushSlots = (partId: string, role: string, count: number, effectFamily: string) => {
    for (let variant = 1; variant <= count; variant += 1) {
      const id = `mischief-${effectFamily}-${twoDigit(variant)}`;
      slots.push({
        id,
        index: slots.length,
        partId,
        role,
        uniqueKey: id,
        attributes: {
          moduleId,
          effectFamily,
          variant,
          ...(effectFamily === 'hazard' || effectFamily === 'rescue'
            ? { activationRank: variant }
            : {}),
          contentDirective: '保留功能家族的核心判定，但为每张牌设计独立角色、命名与情境。',
        },
      });
    }
  };
  pushSlots('hazard', '危机', safeHazards, 'hazard');
  pushSlots('rescue', '护航', safeRescues, 'rescue');
  for (const family of functions) {
    pushSlots(`function-${family.id}`, family.label, family.count, family.id);
  }

  return {
    schemaVersion: 1,
    kind: 'mischief',
    source,
    totalCards: safeTotal,
    parts,
    constraints: [
      constraint('hazard-count', 'exact', '盒装危机牌', safeHazards, `盒装数量覆盖最多 ${playerRange.max} 人；本局只投入玩家数减 1 张。`),
      constraint('rescue-count', 'exact', '盒装护航牌', safeRescues, `盒装数量覆盖最多 ${playerRange.max} 人；本局每位玩家使用 1 张。`),
      constraint('session-risk-count', 'relationship', '本局危机与护航', 'N-1 / N', 'N 人局投入 N−1 张危机与 N 张护航，多余牌留在盒中。'),
      constraint('function-distribution', 'distribution', '功能牌分布', Object.fromEntries(functions.map((family) => [family.id, family.count])), '八类功能覆盖回合控制、预见、牌库篡改与资源互动。'),
      constraint('unique-content', 'uniqueness', '同功能不同牌', true, '功能家族可相同，但每张的角色、画面与叙事必须唯一。'),
    ],
    slots,
    rationale: [
      `${safeHazards} 张危机、${safeRescues} 张护航与 ${functionCount} 张功能牌共同构成 ${safeTotal} 张完整牌库。`,
      '盒装库存不等于本局投入；危机和护航必须按实际玩家人数配入。',
    ],
    playSetup: {
      playerRange,
      defaultPlayers: defaultPlayersFor(playerRange, 4),
      cardsInPlay: {
        min: functionCount + playerRange.min * 2 - 1,
        max: functionCount + playerRange.max * 2 - 1,
        default: functionCount + defaultPlayersFor(playerRange, 4) * 2 - 1,
      },
      formula: `N 人局使用全部 ${functionCount} 张功能牌，并从盒中取 N−1 张危机、N 张护航；其余危机与护航移出本局。`,
      summary: `${defaultPlayersFor(playerRange, 4)}人标准局投入 ${functionCount + defaultPlayersFor(playerRange, 4) * 2 - 1} 张（盒装 ${safeTotal} 张）`,
      auxiliaryComponents: ['回合方向标记 1 枚', '淘汰标记 8 枚'],
    },
  };
}

function requirementFor(
  module: GameplayRuleModule,
  playerRange = normalizePlayerRange(undefined, { min: 2, max: 6 }),
): ModuleRequirement {
  const mechanic = moduleMechanic(module);
  switch (mechanic) {
    case 'rapid-match':
      return { module, mechanic, minimum: 31 };
    case 'memory-pair': {
      const pairs = clampInteger(parameterValue(module, 'pairCount'), 24, 6, 32);
      return { module, mechanic, minimum: pairs * 2 };
    }
    case 'quantity-trigger':
      return { module, mechanic, minimum: 56 };
    case 'icon-coop':
      return {
        module,
        mechanic,
        minimum: clampInteger(parameterValue(module, 'targetCount'), 48, 24, 64),
      };
    case 'risk-draw': {
      const rawHazards = clampInteger(parameterValue(module, 'hazardCount'), 5, 1, 8);
      const rawRescues = clampInteger(parameterValue(module, 'rescueCount'), 6, 1, 10);
      const hazards = Math.max(rawHazards, playerRange.max - 1);
      const rescues = Math.max(rawRescues, playerRange.max);
      return { module, mechanic, minimum: clampInteger(45 + hazards + rescues, 56, 12, 64) };
    }
    default: {
      const customComposition = resolveCustomDeckComposition(module);
      return {
        module,
        mechanic: 'custom',
        minimum: customComposition.totalCards,
        customComposition,
      };
    }
  }
}

function variantEnabled(module: GameplayRuleModule, variantId: string): boolean {
  return module.content.variants.some((variant) => (
    variant.id === variantId && variant.enabled === true
  ));
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

function stableSlotPermutation(total: number, key: string): number[] {
  if (total <= 1) return [0];
  const offset = stableHash(`${key}:offset`) % total;
  let stride = 1 + (stableHash(`${key}:stride`) % (total - 1));
  while (greatestCommonDivisor(stride, total) !== 1) stride = (stride % (total - 1)) + 1;
  return Array.from({ length: total }, (_, index) => (offset + index * stride) % total);
}

function allocateProjectionSlots(total: number, requirements: ModuleRequirement[]): number[][] {
  const loads = Array.from({ length: total }, () => 0);
  const allocations = requirements.map((): number[] => []);
  const ordered = requirements
    .map((requirement, index) => ({ requirement, index }))
    .sort((left, right) => right.requirement.minimum - left.requirement.minimum || left.index - right.index);

  for (const { requirement, index } of ordered) {
    const permutation = stableSlotPermutation(
      total,
      `v1:${index}:${requirement.module.id}:${requirement.mechanic}`,
    );
    const rank = Array.from({ length: total }, () => 0);
    permutation.forEach((slotIndex, permutationIndex) => { rank[slotIndex] = permutationIndex; });
    const selected = Array.from({ length: total }, (_, slotIndex) => slotIndex)
      .sort((left, right) => loads[left] - loads[right] || rank[left] - rank[right] || left - right)
      .slice(0, requirement.minimum)
      .sort((left, right) => rank[left] - rank[right]);
    selected.forEach((slotIndex) => { loads[slotIndex] += 1; });
    allocations[index] = selected;
  }
  return allocations;
}

function combinedSlotId(index: number): string {
  return `custom-${twoDigit(index + 1)}`;
}

function buildProjectedRoles(
  requirement: ModuleRequirement,
  slotIndices: number[],
  playerRange: RuleKit['playerRange'],
  moduleNumber: number,
): ProjectedRole[] {
  const moduleId = requirement.module.id;
  switch (requirement.mechanic) {
    case 'rapid-match': {
      const matchRule = 'same-symbol';
      const lines = buildProjectivePlane(5);
      return slotIndices.map((_, index) => {
        const compactSymbolIds = lines[index].map((symbolId) => symbolId.replace('symbol-', 's'));
        const symbolIds = compactSymbolIds.map((symbolId) => `${moduleId}:${symbolId}`);
        return {
          binding: { kind: 'rapid', moduleId, matchRule, symbolIds },
          spec: { kind: 'rapid', module: moduleNumber, symbols: compactSymbolIds },
        };
      });
    }
    case 'memory-pair':
      return slotIndices.map((_, index) => {
        const pairIndex = Math.floor(index / 2);
        const pairRole = index % 2 === 0 ? 'a' as const : 'b' as const;
        const complementIndex = pairRole === 'a' ? index + 1 : index - 1;
        const compactPairId = `p${twoDigit(pairIndex + 1)}`;
        const pairId = `${moduleId}:${compactPairId}`;
        const factionId = variantEnabled(requirement.module, 'memory-faction')
          ? MEMORY_FACTION_IDS[pairIndex % MEMORY_FACTION_IDS.length]
          : undefined;
        return {
          binding: {
            kind: 'memory',
            moduleId,
            pairId,
            pairRole,
            ...(factionId ? { factionId } : {}),
          },
          spec: {
            kind: 'memory',
            module: moduleNumber,
            pair: compactPairId,
            side: pairRole,
            with: combinedSlotId(slotIndices[complementIndex]),
            ...(factionId ? { faction: factionId.replace('faction-', '') } : {}),
          },
        };
      });
    case 'quantity-trigger': {
      const targetTotal = clampInteger(parameterValue(requirement.module, 'targetTotal'), 5, 2, 12);
      const triggerRelation = normalizeQuantityTriggerRelation(
        parameterValue(requirement.module, 'triggerRelation'),
      );
      const values = expandCountedValues(strategyValueDistribution(targetTotal));
      return slotIndices.map((_, index) => {
        const categoryIndex = index % 4;
        const value = values[Math.floor(index / 4)];
        const compactCategoryId = `c${categoryIndex + 1}`;
        const categoryId = `${moduleId}:${compactCategoryId}`;
        return {
          binding: {
            kind: 'quantity',
            moduleId,
            categoryId,
            value,
            targetTotal,
            triggerRelation,
          },
          spec: {
            kind: 'quantity',
            module: moduleNumber,
            category: compactCategoryId,
            value,
            target: targetTotal,
          },
        };
      });
    }
    case 'icon-coop': {
      const categoryCounts = proportionalCounts(
        requirement.minimum,
        EXPRESSION_CATEGORIES.map((category) => category.count),
      );
      const remaining = [...categoryCounts];
      const categorySequence: typeof EXPRESSION_CATEGORIES[number][] = [];
      while (categorySequence.length < requirement.minimum) {
        for (const [categoryIndex, category] of EXPRESSION_CATEGORIES.entries()) {
          if (remaining[categoryIndex] <= 0) continue;
          categorySequence.push(category);
          remaining[categoryIndex] -= 1;
        }
      }
      return slotIndices.map((_, index) => {
        const compactTargetId = `t${twoDigit(index + 1)}`;
        const targetId = `${moduleId}:${compactTargetId}`;
        const category = categorySequence[index];
        const targetCategory = expressionCategory(category.id);
        return {
          binding: { kind: 'expression', moduleId, targetId, targetCategory },
          spec: {
            kind: 'expression',
            module: moduleNumber,
            target: compactTargetId,
            category: targetCategory,
          },
        };
      });
    }
    case 'risk-draw': {
      const hazardCount = Math.max(
        clampInteger(parameterValue(requirement.module, 'hazardCount'), 5, 1, 8),
        playerRange.max - 1,
      );
      const rescueCount = Math.max(
        clampInteger(parameterValue(requirement.module, 'rescueCount'), 6, 1, 10),
        playerRange.max,
      );
      const functionCount = requirement.minimum - hazardCount - rescueCount;
      const functions = distributedFunctionCounts(functionCount);
      const roles: Array<{ cardKind: 'hazard' | 'rescue' | 'action'; actionKind?: string; activationRank?: number }> = [
        ...Array.from({ length: hazardCount }, (_, index) => ({ cardKind: 'hazard' as const, activationRank: index + 1 })),
        ...Array.from({ length: rescueCount }, (_, index) => ({ cardKind: 'rescue' as const, activationRank: index + 1 })),
        ...functions.flatMap((family) => Array.from(
          { length: family.count },
          () => ({ cardKind: 'action' as const, actionKind: family.id }),
        )),
      ];
      return slotIndices.map((_, index) => {
        const role = roles[index];
        const binding: CardGameplayBinding = { kind: 'risk', moduleId, ...role };
        return {
          binding,
          spec: {
            kind: 'risk',
            module: moduleNumber,
            type: role.cardKind,
            ...(role.actionKind ? { action: role.actionKind } : {}),
            ...(role.activationRank ? { rank: role.activationRank } : {}),
          },
        };
      });
    }
    default: {
      const customRoles = requirement.customComposition?.parts.flatMap((part) =>
        Array.from({ length: part.count }, (_, index) => ({
          partId: part.id,
          label: part.label,
          number: index + 1,
        })),
      ) ?? [];
      return slotIndices.map((_, index) => {
        const customRole = customRoles[index];
        const slotRole = customRole
          ? `${customRole.label} ${twoDigit(customRole.number)}`
          : `${requirement.module.name} · 自定义角色 ${twoDigit(index + 1)}`;
        return {
          binding: { kind: 'custom', moduleId, slotRole },
          spec: {
            kind: 'custom',
            module: moduleNumber,
            role: slotRole,
            ...(customRole ? { part: customRole.partId } : {}),
          },
        };
      });
    }
  }
}

function combinedStageSetup(
  requirement: ModuleRequirement,
  playerRange: RuleKit['playerRange'],
): CombinedStageSetup {
  const standardPlayers = defaultPlayersFor(playerRange, 4);
  switch (requirement.mechanic) {
    case 'rapid-match':
      return {
        minimum: requirement.minimum,
        maximum: requirement.minimum,
        standard: requirement.minimum,
        instruction: `${requirement.module.name} ${requirement.minimum} 张`,
      };
    case 'memory-pair': {
      const standard = Math.min(
        requirement.minimum,
        standardPlayers <= 2 ? 24 : standardPlayers <= 4 ? 36 : 48,
      );
      return {
        minimum: Math.min(requirement.minimum, 24),
        maximum: requirement.minimum,
        standard,
        instruction: `${requirement.module.name} ${standard} 张，必须按配对号成对取牌`,
      };
    }
    case 'quantity-trigger': {
      const shortGame = playerRange.min <= 3 ? 42 : requirement.minimum;
      const standard = standardPlayers <= 3 ? Math.min(requirement.minimum, 42) : requirement.minimum;
      return {
        minimum: Math.min(requirement.minimum, shortGame),
        maximum: requirement.minimum,
        standard,
        instruction: `${requirement.module.name} ${standard} 张，短局只取完整数量类别`,
      };
    }
    case 'icon-coop': {
      const standard = Math.min(
        requirement.minimum,
        standardPlayers <= 4 ? 24 : standardPlayers <= 6 ? 36 : 48,
      );
      return {
        minimum: Math.min(requirement.minimum, 24),
        maximum: requirement.minimum,
        standard,
        instruction: `${requirement.module.name} ${standard} 张目标牌`,
      };
    }
    case 'risk-draw': {
      const hazards = Math.max(
        clampInteger(parameterValue(requirement.module, 'hazardCount'), 5, 1, 8),
        playerRange.max - 1,
      );
      const rescues = Math.max(
        clampInteger(parameterValue(requirement.module, 'rescueCount'), 6, 1, 10),
        playerRange.max,
      );
      const functionCards = requirement.minimum - hazards - rescues;
      const cardsForPlayers = (players: number) => functionCards + players * 2 - 1;
      return {
        minimum: cardsForPlayers(playerRange.min),
        maximum: cardsForPlayers(playerRange.max),
        standard: cardsForPlayers(standardPlayers),
        instruction: `${requirement.module.name} ${cardsForPlayers(standardPlayers)} 张；N 人只取 N−1 张危机与 N 张护航`,
      };
    }
    default: {
      const cardsInPlay = requirement.customComposition?.cardsInPlay ?? requirement.minimum;
      return {
        minimum: cardsInPlay,
        maximum: requirement.minimum,
        standard: cardsInPlay,
        instruction: cardsInPlay === requirement.minimum
          ? `${requirement.module.name}使用完整 ${requirement.minimum} 张`
          : `${requirement.module.name}标准局投入 ${cardsInPlay} 张（盒装 ${requirement.minimum} 张）`,
      };
    }
  }
}

function createCombinedPlan(ruleKit: RuleKit, requirements: ModuleRequirement[]): DeckCompositionPlan {
  const playerRange = normalizePlayerRange(ruleKit.playerRange, { min: 2, max: 6 });
  const bindingBudget = requirements.reduce((sum, requirement) => sum + requirement.minimum, 0);
  const rapidBindingBudget = requirements
    .filter((requirement) => requirement.mechanic === 'rapid-match')
    .reduce((sum, requirement) => sum + requirement.minimum, 0);
  const largestRequirement = Math.max(12, ...requirements.map((requirement) => requirement.minimum));
  const totalCards = Math.min(64, Math.max(
    largestRequirement,
    Math.ceil(bindingBudget / 4),
    rapidBindingBudget,
  ));
  const allocations = allocateProjectionSlots(totalCards, requirements);
  const projectedBySlot = Array.from({ length: totalCards }, (): ProjectedRole[] => []);
  const customOnly = requirements.length === 1 && requirements[0].mechanic === 'custom'
    ? requirements[0].customComposition
    : undefined;

  requirements.forEach((requirement, requirementIndex) => {
    const slotIndices = allocations[requirementIndex];
    const roles = buildProjectedRoles(requirement, slotIndices, playerRange, requirementIndex + 1);
    slotIndices.forEach((slotIndex, roleIndex) => projectedBySlot[slotIndex].push(roles[roleIndex]));
  });

  const primaryCounts = new Map<string, number>();
  const moduleNames = new Map(requirements.map((requirement) => [requirement.module.id, requirement.module.name]));
  const slots = projectedBySlot.map((projected, index): DeckCompositionSlot => {
    const primary = [...projected].sort((left, right) => {
      const leftId = left.binding.moduleId ?? '';
      const rightId = right.binding.moduleId ?? '';
      return (primaryCounts.get(leftId) ?? 0) - (primaryCounts.get(rightId) ?? 0)
        || stableHash(`${index}:${leftId}`) - stableHash(`${index}:${rightId}`)
        || compareRuleModuleIds(leftId, rightId);
    })[0];
    const primaryModuleId = primary?.binding.moduleId ?? requirements[0].module.id;
    primaryCounts.set(primaryModuleId, (primaryCounts.get(primaryModuleId) ?? 0) + 1);
    const plannedBindings = projected.map(({ binding }) => binding);
    const moduleSpecs = projected.map(({ spec }) => spec);
    const primaryModule = requirements.findIndex((requirement) => requirement.module.id === primaryModuleId) + 1;
    const attributes: Record<string, DeckCompositionValue> = {
      primaryModule,
      ruleLayers: plannedBindings.length,
      moduleSpecs,
    };
    const customPartId = customOnly && typeof primary?.spec.part === 'string'
      ? primary.spec.part
      : undefined;
    return {
      id: combinedSlotId(index),
      index,
      partId: customPartId ?? 'hybrid-card',
      role: customOnly && primary?.binding.kind === 'custom'
        ? primary.binding.slotRole
        : `${moduleNames.get(primaryModuleId) ?? '原创玩法'} · ${plannedBindings.length} 层融合牌`,
      uniqueKey: `custom-slot-${twoDigit(index + 1)}`,
      attributes,
      plannedBindings,
    };
  });

  const layerCounts = slots.map((slot) => slot.plannedBindings?.length ?? 0);
  const rapidLayerCounts = slots.map((slot) => (
    slot.plannedBindings?.filter((binding) => binding.kind === 'rapid').length ?? 0
  ));
  const minLayers = Math.min(...layerCounts);
  const maxLayers = Math.max(...layerCounts);
  const maxRapidLayers = Math.max(...rapidLayerCounts);
  const constraints: DeckCompositionConstraint[] = [
    constraint('deck-range', 'range', '组合牌组范围', { min: 12, max: 64 }, '完整实体套牌保持 12–64 张。'),
    constraint('unique-content', 'uniqueness', '全牌组内容唯一', true, '每张牌的名称、角色、画面与叙事均不同。'),
    constraint(
      'module-binding-counts',
      'distribution',
      '玩法投影数量',
      Object.fromEntries(requirements.map((requirement) => [requirement.module.id, requirement.minimum])),
      '各积木保留完整牌型，并通过共享卡槽组合。',
    ),
    constraint('binding-load-balance', 'range', '单牌规则层数', { min: minLayers, max: maxLayers }, `每牌承载 ${minLayers}–${maxLayers} 层，规则标记不得遮挡主画面。`),
  ];
  for (const requirement of requirements) {
    const prefix = `module-${requirement.module.id}`;
    switch (requirement.mechanic) {
      case 'rapid-match':
        constraints.push(constraint(`${prefix}-rapid`, 'relationship', `${requirement.module.name}唯一同纹`, 1, '31 张；任意两张仅共享 1 个符号。'));
        break;
      case 'memory-pair':
        constraints.push(constraint(`${prefix}-memory`, 'relationship', `${requirement.module.name}完整配对`, 2, `${requirement.minimum / 2} 对；每对 A/B 各 1 张。`));
        break;
      case 'quantity-trigger':
        constraints.push(constraint(`${prefix}-quantity`, 'distribution', `${requirement.module.name}数量分布`, requirement.minimum, '4 类各 14 张，保留完整数值分布。'));
        break;
      case 'icon-coop':
        constraints.push(constraint(`${prefix}-expression`, 'uniqueness', `${requirement.module.name}目标唯一`, requirement.minimum, `${requirement.minimum} 个唯一目标，按五类题材分布。`));
        break;
      case 'risk-draw':
        constraints.push(constraint(`${prefix}-risk`, 'distribution', `${requirement.module.name}风险角色`, requirement.minimum, '危机、护航与八类功能按人数激活。'));
        break;
      default:
        constraints.push(constraint(
          `${prefix}-custom`,
          'distribution',
          `${requirement.module.name}牌型构成`,
          Object.fromEntries(
            requirement.customComposition?.parts.map((part) => [part.label, part.count]) ?? [
              ['自定义牌', requirement.minimum],
            ],
          ),
          '每种牌型按创作者设定的张数生成，所有槽位保持唯一且可追踪。',
        ));
    }
  }
  if (maxLayers > 4) {
    constraints.push(constraint('surface-density-overflow', 'range', '牌面规则密度警告', maxLayers, '部分卡牌超过 4 层规则投影，生成时必须压缩积木数量或采用双面/辅助板布局。'));
  }
  if (maxRapidLayers > 1) {
    constraints.push(constraint('rapid-symbol-overflow', 'range', '快速纹样密度警告', maxRapidLayers, '同一张牌承载多组快速观察纹样，无法在不遮挡主画面的前提下清晰印刷。'));
  }

  const stageSetups = requirements.map((requirement) => combinedStageSetup(requirement, playerRange));
  const minimumCardsInPlay = Math.min(...stageSetups.map((setup) => setup.minimum));
  const maximumCardsInPlay = Math.max(...stageSetups.map((setup) => setup.maximum));
  const standardStageMinimum = Math.min(...stageSetups.map((setup) => setup.standard));
  const standardStageMaximum = Math.max(...stageSetups.map((setup) => setup.standard));
  const setupFormula = [
    '每个阶段只取带对应玩法积木标记的牌，未带该标记的牌暂置盒外；切换阶段时重新筛牌与布置区域。',
    ...stageSetups.map((setup) => `${setup.instruction}。`),
  ].join('');
  const standardRange = standardStageMinimum === standardStageMaximum
    ? `${standardStageMinimum}`
    : `${standardStageMinimum}–${standardStageMaximum}`;

  return {
    schemaVersion: 1,
    kind: 'custom',
    source: 'rule-kit',
    totalCards,
    parts: customOnly
      ? customOnly.parts.map((part) => ({
          ...part,
          purpose: '由创作者定义的原创牌型。',
        }))
      : [{
          id: 'hybrid-card',
          label: '融合实体牌',
          count: totalCards,
          purpose: `承载 ${bindingBudget} 条带模块命名空间的玩法投影。`,
        }],
    constraints,
    slots,
    rationale: [
      `${requirements.length} 个启用积木合计需要 ${bindingBudget} 条玩法投影，以每张最多 4 层为目标计算 ${totalCards} 张实体牌。`,
      `稳定置换与最低负载优先分配使每张牌承载 ${minLayers}–${maxLayers} 层，同时保留各积木原生牌型数量。`,
    ],
    playSetup: {
      playerRange,
      defaultPlayers: defaultPlayersFor(playerRange, 4),
      cardsInPlay: {
        min: minimumCardsInPlay,
        max: maximumCardsInPlay,
        default: standardStageMaximum,
      },
      formula: setupFormula,
      summary: `${defaultPlayersFor(playerRange, 4)}人组合局按阶段投入 ${standardRange} 张（盒装 ${totalCards} 张）`,
      auxiliaryComponents: ruleKit.components,
    },
  };
}

function planFromRuleKit(ruleKit: RuleKit): DeckCompositionPlan {
  const enabledModules = ruleKit.modules.filter((module) => module.enabled);
  if (!enabledModules.length && ruleKit.modules[0]) {
    enabledModules.push({ ...ruleKit.modules[0], enabled: true });
  }
  const normalizedRange = normalizePlayerRange(ruleKit.playerRange, { min: 2, max: 6 });
  const requiredPlayers = minimumPlayersForModules(enabledModules);
  const playerRange = {
    min: Math.max(requiredPlayers, normalizedRange.min),
    max: Math.max(requiredPlayers, normalizedRange.max),
  };
  if (enabledModules.length === 0) {
    const placeholder: GameplayRuleModule = {
      id: 'custom-fallback',
      source: 'custom',
      name: '自定义基础牌',
      summary: '',
      glyph: '创',
      accentHex: '#c84f3d',
      tags: [],
      enabled: true,
      parameters: [],
      content: { objective: [], setup: [], flow: [], victory: [], variants: [] },
    };
    return createCombinedPlan(ruleKit, [requirementFor(placeholder, playerRange)]);
  }

  const requirements = enabledModules.map((module) => requirementFor(module, playerRange));
  if (requirements.length !== 1 || requirements[0].mechanic === 'custom') {
    return createCombinedPlan(ruleKit, requirements);
  }

  const requirement = requirements[0];
  switch (requirement.mechanic) {
    case 'rapid-match':
      return createReflexPlan(
        'rule-kit',
        playerRange,
        requirement.module.id,
        'same-symbol',
      );
    case 'memory-pair':
      return createMemoryPlan(
        requirement.minimum / 2,
        'rule-kit',
        playerRange,
        requirement.module.id,
        variantEnabled(requirement.module, 'memory-faction'),
      );
    case 'quantity-trigger': {
      const targetTotal = clampInteger(parameterValue(requirement.module, 'targetTotal'), 5, 2, 12);
      const triggerRelation = normalizeQuantityTriggerRelation(
        parameterValue(requirement.module, 'triggerRelation'),
      );
      return createStrategyPlan(
        'rule-kit',
        targetTotal,
        playerRange,
        requirement.module.id,
        triggerRelation,
      );
    }
    case 'icon-coop':
      return createExpressionPlan('rule-kit', requirement.minimum, playerRange, requirement.module.id);
    case 'risk-draw': {
      const rawHazards = clampInteger(parameterValue(requirement.module, 'hazardCount'), 5, 1, 8);
      const rawRescues = clampInteger(parameterValue(requirement.module, 'rescueCount'), 6, 1, 10);
      return createMischiefPlan(
        'rule-kit',
        rawHazards,
        rawRescues,
        45 + rawHazards + rawRescues,
        playerRange,
        requirement.module.id,
      );
    }
    default:
      return createCombinedPlan(ruleKit, requirements);
  }
}

/**
 * Produces a deterministic, JSON-safe set of generation slots for a built-in mode or a custom rule kit.
 * Passing a mode id uses the production default; passing a rule kit respects its enabled modules and parameters.
 */
export function planDeckComposition(input: GameModeId | RuleKit): DeckCompositionPlan {
  if (typeof input !== 'string') {
    return planFromRuleKit({
      ...input,
      modules: normalizeRuleKitModuleIds(input.modules),
    });
  }
  switch (input) {
    case 'reflex':
      return createReflexPlan();
    case 'memory':
      return createMemoryPlan(24, 'mode-default');
    case 'strategy':
      return createStrategyPlan();
    case 'expression':
      return createExpressionPlan();
    case 'mischief':
      return createMischiefPlan();
  }
}

export function mechanicForMode(modeId: GameModeId): GameplayMechanicId {
  return MODE_MECHANICS[modeId];
}

export function summarizeDeckComposition(
  plan: DeckCompositionPlan,
  currentCardCount: number,
): DeckComposition {
  const count = Math.max(0, Math.round(currentCardCount));
  return {
    schemaVersion: 1,
    recommendedTotal: plan.totalCards,
    parts: plan.parts.map((part) => ({
      id: part.id,
      label: part.label,
      count: part.count,
      note: part.purpose,
    })),
    constraints: plan.constraints.map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description,
    })),
    rationale: plan.rationale.join('\n'),
    playSetup: {
      ...plan.playSetup,
      playerRange: { ...plan.playSetup.playerRange },
      cardsInPlay: { ...plan.playSetup.cardsInPlay },
      auxiliaryComponents: [...plan.playSetup.auxiliaryComponents],
    },
    status:
      count === plan.totalCards
        ? 'complete'
        : count <= 4
          ? 'sample'
          : 'incomplete',
  };
}

function gameplayBindingSignature(binding: CardGameplayBinding): string {
  const moduleId = binding.moduleId ?? '';
  switch (binding.kind) {
    case 'rapid':
      return JSON.stringify([
        binding.kind,
        moduleId,
        binding.matchRule ?? 'same-symbol',
        [...binding.symbolIds].sort(),
      ]);
    case 'memory':
      return JSON.stringify([
        binding.kind,
        moduleId,
        binding.pairId,
        binding.pairRole,
        binding.factionId ?? '',
      ]);
    case 'quantity':
      return JSON.stringify([
        binding.kind,
        moduleId,
        binding.categoryId,
        binding.value,
        binding.targetTotal ?? null,
        binding.triggerRelation ?? 'exact',
      ]);
    case 'expression':
      return JSON.stringify([
        binding.kind,
        moduleId,
        binding.targetId,
        binding.targetCategory,
      ]);
    case 'risk':
      return JSON.stringify([
        binding.kind,
        moduleId,
        binding.cardKind,
        binding.actionKind ?? '',
        binding.activationRank ?? null,
      ]);
    case 'custom':
      return JSON.stringify([binding.kind, binding.moduleId, binding.slotRole]);
  }
}

function signatureCounts(bindings: readonly CardGameplayBinding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const binding of bindings) {
    const signature = gameplayBindingSignature(binding);
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  return counts;
}

function validateDeckCompositionAgainstPlan(
  deck: Pick<DeckData, 'modeId' | 'ruleKit' | 'cards'>,
  plan: DeckCompositionPlan,
): DeckCompositionValidation {
  const actualCardCount = deck.cards.length;
  const expectedBindings = plan.slots.flatMap((slot) => gameplayBindingsForSlot(plan, slot));
  const actualBindings = deck.cards.flatMap((card) => card.gameplay ?? []);
  const issues: DeckCompositionValidationIssue[] = [];

  if (actualCardCount !== plan.totalCards) {
    issues.push({
      code: 'card-count',
      message: `完整盒装需要 ${plan.totalCards} 张，当前为 ${actualCardCount} 张。`,
      count: Math.abs(plan.totalCards - actualCardCount),
    });
  } else {
    const expectedCounts = signatureCounts(expectedBindings);
    const actualCounts = signatureCounts(actualBindings);
    let missing = 0;
    let unexpected = 0;
    for (const [signature, expected] of expectedCounts) {
      missing += Math.max(0, expected - (actualCounts.get(signature) ?? 0));
    }
    for (const [signature, actual] of actualCounts) {
      unexpected += Math.max(0, actual - (expectedCounts.get(signature) ?? 0));
    }
    if (missing > 0) {
      issues.push({
        code: 'missing-gameplay-bindings',
        message: `缺少 ${missing} 个玩法标记或牌型槽位。`,
        count: missing,
      });
    }
    if (unexpected > 0) {
      issues.push({
        code: 'unexpected-gameplay-bindings',
        message: `存在 ${unexpected} 个重复或不属于当前规则的玩法标记。`,
        count: unexpected,
      });
    }
  }

  const overloadedCards = deck.cards.filter((card) => (card.gameplay?.length ?? 0) > 4);
  if (overloadedCards.length > 0) {
    issues.push({
      code: 'surface-density-overflow',
      message: `${overloadedCards.length} 张牌承载超过 4 层玩法印谱，无法清晰印刷。`,
      count: overloadedCards.length,
    });
  }
  const overloadedRapidCards = deck.cards.filter((card) => (
    card.gameplay?.filter((binding) => binding.kind === 'rapid').length ?? 0
  ) > 1);
  if (overloadedRapidCards.length > 0) {
    issues.push({
      code: 'rapid-symbol-overflow',
      message: `${overloadedRapidCards.length} 张牌承载多组快速观察纹样，无法清晰印刷。`,
      count: overloadedRapidCards.length,
    });
  }

  return {
    valid: issues.length === 0,
    expectedCardCount: plan.totalCards,
    actualCardCount,
    expectedBindingCount: expectedBindings.length,
    actualBindingCount: actualBindings.length,
    issues,
  };
}

/** Verifies that a full deck contains every planned gameplay identity exactly once. */
export function validateDeckComposition(
  deck: Pick<DeckData, 'modeId' | 'ruleKit' | 'cards'>,
): DeckCompositionValidation {
  const plan = planDeckComposition(deck.ruleKit ?? deck.modeId);
  return validateDeckCompositionAgainstPlan(deck, plan);
}

/** Rebuilds composition metadata from the current rules instead of trusting persisted or exchanged metadata. */
export function resolveDeckComposition(
  deck: Pick<DeckData, 'modeId' | 'ruleKit' | 'cards'>,
): DeckComposition {
  const plan = planDeckComposition(deck.ruleKit ?? deck.modeId);
  const composition = summarizeDeckComposition(plan, deck.cards.length);
  if (composition.status === 'complete' && !validateDeckCompositionAgainstPlan(deck, plan).valid) {
    composition.status = 'incomplete';
  }
  return composition;
}

export function describeDeckComposition(
  deck: Pick<DeckData, 'modeId' | 'ruleKit' | 'cards'>,
): DeckCompositionState {
  const plan = planDeckComposition(deck.ruleKit ?? deck.modeId);
  const composition = summarizeDeckComposition(plan, deck.cards.length);
  const validation = validateDeckCompositionAgainstPlan(deck, plan);
  if (composition.status === 'complete' && !validation.valid) composition.status = 'incomplete';
  const currentTotal = deck.cards.length;
  const recommendedTotal = composition.recommendedTotal;
  const remaining = Math.max(0, recommendedTotal - currentTotal);
  const excess = Math.max(0, currentTotal - recommendedTotal);
  let summary: string;
  if (composition.status === 'complete') {
    summary = `完整盒装 ${recommendedTotal} 张`;
  } else if (composition.status === 'sample') {
    summary = `样卡 ${currentTotal} / 盒装 ${recommendedTotal} 张`;
  } else if (remaining === 0 && excess === 0 && !validation.valid) {
    summary = validation.issues.some((issue) => (
      issue.code === 'surface-density-overflow' || issue.code === 'rapid-symbol-overflow'
    ))
      ? `规则过密 / 盒装 ${recommendedTotal} 张`
      : `牌型未完成 / 盒装 ${recommendedTotal} 张`;
  } else {
    summary = `待适配 ${currentTotal} / 盒装 ${recommendedTotal} 张`;
  }
  return { composition, validation, currentTotal, recommendedTotal, remaining, excess, summary };
}

export function assessDeckPrintReadiness(
  deck: Pick<DeckData, 'modeId' | 'ruleKit' | 'cards'>,
): DeckPrintReadiness {
  const state = describeDeckComposition(deck);
  if (state.composition.status === 'complete') {
    return { ...state, ready: true, message: `完整盒装 ${state.recommendedTotal} 张，可以印刷导出` };
  }
  if (state.remaining === 0 && state.excess === 0 && !state.validation.valid) {
    const densityIssue = state.validation.issues.find(
      (issue) => issue.code === 'surface-density-overflow',
    );
    const rapidIssue = state.validation.issues.find(
      (issue) => issue.code === 'rapid-symbol-overflow',
    );
    return {
      ...state,
      ready: false,
      message: rapidIssue
        ? `快速纹样过密：${rapidIssue.count} 张承载多组纹样，请减少快速观察积木或拆分为子套牌`
        : densityIssue
        ? `牌面规则过密：${densityIssue.count} 张超过 4 层，请减少玩法积木或拆分为子套牌`
        : '牌型未完成：缺少玩法标记或构成不匹配，请重新炼制完整套牌',
    };
  }
  if (state.remaining > 0) {
    const prefix = state.composition.status === 'sample' ? '样卡不可印刷' : '牌组待适配';
    return {
      ...state,
      ready: false,
      message: `${prefix}，还差 ${state.remaining} 张，请先完整炼制`,
    };
  }
  return {
    ...state,
    ready: false,
    message: `牌组待适配，当前多 ${state.excess} 张，请按新规则重新炼制`,
  };
}

function expressionCategory(value: unknown): Extract<CardGameplayBinding, { kind: 'expression' }>['targetCategory'] {
  switch (value) {
    case 'living':
      return 'animal';
    case 'place':
      return 'place';
    case 'action':
      return 'action';
    case 'concept':
      return 'emotion';
    default:
      return 'object';
  }
}

function cloneGameplayBinding(binding: CardGameplayBinding): CardGameplayBinding {
  if (binding.kind === 'rapid') return { ...binding, symbolIds: [...binding.symbolIds] };
  return { ...binding };
}

export function gameplayBindingsForSlot(
  plan: DeckCompositionPlan,
  slot: DeckCompositionSlot,
): CardGameplayBinding[] {
  if (slot.plannedBindings?.length) return slot.plannedBindings.map(cloneGameplayBinding);

  const bindings: CardGameplayBinding[] = [];
  const moduleId = typeof slot.attributes.moduleId === 'string' ? slot.attributes.moduleId : undefined;
  const symbolIds = slot.attributes.symbolIds;
  if (Array.isArray(symbolIds) && symbolIds.every((value) => typeof value === 'string')) {
    const matchRule = slot.attributes.matchRule;
    bindings.push({
      kind: 'rapid',
      symbolIds: [...symbolIds],
      ...(typeof matchRule === 'string' ? { matchRule } : {}),
      ...(moduleId ? { moduleId } : {}),
    });
  }

  const pairId = slot.attributes.pairId;
  const pairSide = slot.attributes.pairSide;
  if (typeof pairId === 'string' && (pairSide === 'A' || pairSide === 'B')) {
    const factionId = slot.attributes.factionId;
    bindings.push({
      kind: 'memory',
      pairId,
      pairRole: pairSide.toLowerCase() as 'a' | 'b',
      ...(typeof factionId === 'string' ? { factionId } : {}),
      ...(moduleId ? { moduleId } : {}),
    });
  }

  if (plan.kind === 'strategy') {
    const category = slot.attributes.category;
    const quantityValue = slot.attributes.quantityValue;
    if (typeof category === 'number' && typeof quantityValue === 'number') {
      const targetTotal = slot.attributes.targetTotal;
      const triggerRelation = slot.attributes.triggerRelation;
      bindings.push({
        kind: 'quantity',
        categoryId: `category-${category}`,
        value: quantityValue,
        ...(typeof targetTotal === 'number' ? { targetTotal } : {}),
        ...(typeof triggerRelation === 'string' ? { triggerRelation } : {}),
        ...(moduleId ? { moduleId } : {}),
      });
    }
  } else if (plan.kind === 'expression') {
    bindings.push({
      kind: 'expression',
      targetId: slot.uniqueKey,
      targetCategory: expressionCategory(slot.attributes.targetCategory),
      ...(moduleId ? { moduleId } : {}),
    });
  } else if (plan.kind === 'mischief') {
    const family = String(slot.attributes.effectFamily ?? 'action');
    const activationRank = slot.attributes.activationRank;
    bindings.push({
      kind: 'risk',
      cardKind: family === 'hazard' ? 'hazard' : family === 'rescue' ? 'rescue' : 'action',
      ...(family === 'hazard' || family === 'rescue' ? {} : { actionKind: family }),
      ...(typeof activationRank === 'number' ? { activationRank } : {}),
      ...(moduleId ? { moduleId } : {}),
    });
  }

  if (bindings.length === 0) {
    const primaryModuleId = String(slot.attributes.primaryModuleId ?? slot.partId);
    bindings.push({ kind: 'custom', moduleId: primaryModuleId, slotRole: slot.role });
  }
  return bindings;
}
