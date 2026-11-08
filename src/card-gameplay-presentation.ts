import type { CardData, CardGameplayBinding, GameplayRuleModule } from './types';

export type GameplayDisplayTier = 'thumbnail' | 'standard' | 'full';

export type GameplayPresentationKind = CardGameplayBinding['kind'];

export interface GameplayModuleVisual {
  moduleId: string;
  moduleName: string;
  moduleGlyph: string;
  accentHex: string;
}

export interface GameplayModuleSeal extends GameplayModuleVisual {}

export interface RapidSymbolPresentation {
  id: string;
  bindingIndex: number;
  symbolIndex: number;
  sourceId: string;
  canonicalId: string;
  index: number | null;
  glyph: string;
  label: string;
  description: string;
  moduleId: string;
  moduleName: string;
  accentHex: string;
}

export interface GameplayPresentationItem extends GameplayModuleVisual {
  bindingIndex: number;
  kind: GameplayPresentationKind;
  /** Compact graphic mark that remains useful at thumbnail scale. */
  mark: string;
  /** Tier-aware identity label. Empty for thumbnail presentations. */
  primary: string;
  /** Tier-aware relationship/effect label. Usually only populated at full scale. */
  secondary: string;
  /** Stable rules relationship, independent from display density. */
  relation?: string;
  /** Complete, tier-independent meaning for tooltips, accessibility and rulebook output. */
  description: string;
}

export interface CardGameplayPresentation {
  tier: GameplayDisplayTier;
  rapidSymbols: RapidSymbolPresentation[];
  items: GameplayPresentationItem[];
  seals: GameplayModuleSeal[];
  overflowCount: number;
}

export const MAX_GAMEPLAY_MODULE_SEALS = 4;

export const RAPID_SYMBOL_GLYPHS = [
  '日', '月', '星', '云', '山', '水', '火', '木', '金', '玉',
  '风', '雷', '花', '鸟', '鱼', '龙', '虎', '鹤', '鹿', '马',
  '舟', '灯', '扇', '琴', '剑', '印', '伞', '竹', '莲', '蝶', '轮',
] as const;

const FALLBACK_VISUALS: Record<GameplayPresentationKind, Omit<GameplayModuleVisual, 'moduleId'>> = {
  rapid: { moduleName: '瞬纹竞速', moduleGlyph: '瞬', accentHex: '#ef694f' },
  memory: { moduleName: '伏光记阵', moduleGlyph: '忆', accentHex: '#4aaec8' },
  quantity: { moduleName: '衡数鸣台', moduleGlyph: '衡', accentHex: '#d39032' },
  expression: { moduleName: '象语协作', moduleGlyph: '象', accentHex: '#c85b79' },
  risk: { moduleName: '险途牌潮', moduleGlyph: '险', accentHex: '#8c6cd8' },
  custom: { moduleName: '原创玩法', moduleGlyph: '创', accentHex: '#c84f3d' },
};

const EXPRESSION_CATEGORIES: Record<
  Extract<CardGameplayBinding, { kind: 'expression' }>['targetCategory'],
  { mark: string; label: string }
> = {
  animal: { mark: '生', label: '角色与生灵' },
  object: { mark: '器', label: '器物与造物' },
  place: { mark: '境', label: '地点与环境' },
  action: { mark: '行', label: '动作与事件' },
  emotion: { mark: '情', label: '情绪与概念' },
};

const RISK_ACTIONS: Record<string, { mark: string; label: string }> = {
  skip: { mark: '跳', label: '跳过' },
  reverse: { mark: '转', label: '反转' },
  attack: { mark: '追', label: '追击' },
  forecast: { mark: '观', label: '未来视界' },
  reorder: { mark: '序', label: '篡序' },
  steal: { mark: '取', label: '偷取' },
  exchange: { mark: '易', label: '交换' },
  demand: { mark: '索', label: '索要' },
};

const QUANTITY_RELATIONS: Record<string, (target: number | undefined) => string> = {
  exact: (target) => target === undefined ? '同类数量恰好成立' : `同类总量恰好 ${target}`,
  'at-least': (target) => target === undefined ? '同类数量至少达标' : `同类总量至少 ${target}`,
  'two-types': (target) => target === undefined ? '两类数量之和达标' : `两类合计 ${target}`,
};

function firstGlyph(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? (Array.from(trimmed)[0] ?? fallback) : fallback;
}

function validAccent(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{6}$/iu.test(value) ? value : fallback;
}

function bindingModuleId(binding: CardGameplayBinding): string {
  const explicit = binding.moduleId?.trim();
  return explicit || `builtin:${binding.kind}`;
}

function resolveModuleVisual(
  binding: CardGameplayBinding,
  modules: readonly GameplayRuleModule[],
): GameplayModuleVisual {
  const fallback = FALLBACK_VISUALS[binding.kind];
  const moduleId = bindingModuleId(binding);
  const context = binding.moduleId
    ? modules.find((candidate) => candidate.id === binding.moduleId)
    : undefined;
  return {
    moduleId,
    moduleName: context?.name.trim() || fallback.moduleName,
    moduleGlyph: firstGlyph(context?.glyph, fallback.moduleGlyph),
    accentHex: validAccent(context?.accentHex, fallback.accentHex),
  };
}

function rapidSymbolIndex(symbolId: string): number | null {
  const match = symbolId.trim().match(/(?:symbol-|s)(\d{1,2})$/iu);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 1 && index <= RAPID_SYMBOL_GLYPHS.length
    ? index
    : null;
}

export function resolveRapidSymbolGlyph(symbolId: string): string {
  const index = rapidSymbolIndex(symbolId);
  return index === null ? '纹' : RAPID_SYMBOL_GLYPHS[index - 1];
}

export function resolveGameplayDisplayTier(width: number): GameplayDisplayTier {
  if (width < 96) return 'thumbnail';
  if (width < 180) return 'standard';
  return 'full';
}

function resolveTier(tierOrWidth: GameplayDisplayTier | number): GameplayDisplayTier {
  return typeof tierOrWidth === 'number'
    ? resolveGameplayDisplayTier(tierOrWidth)
    : tierOrWidth;
}

function terminalOrdinal(value: string): string | null {
  const match = value.trim().match(/(\d+)$/u);
  if (!match) return null;
  return String(Number(match[1])).padStart(2, '0');
}

function compactIdentifier(value: string, prefixes: readonly string[]): string {
  const ordinal = terminalOrdinal(value);
  if (ordinal) return ordinal;
  const tail = value.trim().split(':').at(-1) ?? value.trim();
  let cleaned = tail;
  for (const prefix of prefixes) {
    if (cleaned.toLocaleLowerCase().startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length);
      break;
    }
  }
  const compact = Array.from(cleaned.replace(/[\s_:-]+/gu, '')).slice(0, 4).join('');
  return compact || '--';
}

function chineseCategory(categoryId: string): string {
  const ordinal = terminalOrdinal(categoryId);
  const index = ordinal ? Number(ordinal) : Number.NaN;
  return ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'][index] ?? (ordinal ?? '异');
}

function rapidMatchLabel(matchRule: string | undefined): { short: string; full: string } {
  switch (matchRule) {
    case 'same-color':
      return { short: '同色', full: '唯一同色' };
    case 'same-category':
      return { short: '同类', full: '唯一同类' };
    default:
      return { short: '同纹', full: '唯一同纹' };
  }
}

function compactCustomRole(value: string, tier: GameplayDisplayTier): string {
  const normalized = value
    .trim()
    .replace(/\s*[·|:：]\s*/gu, ' ')
    .replace(/牌(?=\s*\d|$)/gu, '')
    .replace(/\s+/gu, tier === 'standard' ? '' : ' ');
  const limit = tier === 'standard' ? 7 : 12;
  const glyphs = Array.from(normalized);
  return glyphs.length <= limit ? normalized : `${glyphs.slice(0, limit - 1).join('')}…`;
}

function presentationItem(
  binding: CardGameplayBinding,
  bindingIndex: number,
  visual: GameplayModuleVisual,
  tier: GameplayDisplayTier,
): GameplayPresentationItem {
  if (binding.kind === 'rapid') {
    const match = rapidMatchLabel(binding.matchRule);
    return {
      ...visual,
      bindingIndex,
      kind: binding.kind,
      mark: '纹',
      primary: tier === 'thumbnail' ? '' : tier === 'standard' ? match.short : match.full,
      secondary: tier === 'full' ? `每牌 ${binding.symbolIds.length} 枚象形纹样` : '',
      relation: match.full,
      description: `${match.full}；本牌含 ${binding.symbolIds.length} 枚象形纹样。`,
    };
  }

  if (binding.kind === 'memory') {
    const pair = compactIdentifier(binding.pairId, ['pair-', 'pair', 'p']);
    const side = binding.pairRole.toUpperCase();
    const counterpart = binding.pairRole === 'a' ? 'B' : 'A';
    const faction = binding.factionId
      ? compactIdentifier(binding.factionId, ['faction-', 'faction', 'team-', 'team'])
      : '';
    const factionDetail = faction ? `；${faction}阵营` : '';
    return {
      ...visual,
      bindingIndex,
      kind: binding.kind,
      mark: binding.pairRole === 'a' ? '◐' : '◑',
      primary: tier === 'thumbnail' ? '' : tier === 'standard' ? `配${pair}·${side}契` : `配 ${pair} · ${side} 半契`,
      secondary: tier === 'full' ? `与配 ${pair} · ${counterpart} 半契相合${factionDetail}` : '',
      relation: `与配 ${pair} · ${counterpart} 半契相合${factionDetail}`,
      description: `配对 ${pair} 的 ${side} 半契，需与 ${counterpart} 半契相合${factionDetail}。`,
    };
  }

  if (binding.kind === 'quantity') {
    const category = chineseCategory(binding.categoryId);
    const relationKey = binding.triggerRelation ?? 'exact';
    const relation = QUANTITY_RELATIONS[relationKey]?.(binding.targetTotal)
      ?? `按 ${compactIdentifier(relationKey, [])} 关系判定${binding.targetTotal === undefined ? '' : ` ${binding.targetTotal}`}`;
    return {
      ...visual,
      bindingIndex,
      kind: binding.kind,
      mark: String(binding.value),
      primary: tier === 'thumbnail' ? '' : tier === 'standard' ? `${category}类·${binding.value}` : `${category}类 · 数值 ${binding.value}`,
      secondary: tier === 'full' ? relation : '',
      relation,
      description: `${category}类数值 ${binding.value}；${relation}。`,
    };
  }

  if (binding.kind === 'expression') {
    const category = EXPRESSION_CATEGORIES[binding.targetCategory];
    const target = compactIdentifier(binding.targetId, ['target-', 'target', 't']);
    return {
      ...visual,
      bindingIndex,
      kind: binding.kind,
      mark: category.mark,
      primary: tier === 'thumbnail' ? '' : tier === 'standard' ? `${category.mark}${target}` : `${category.mark} · 题 ${target}`,
      secondary: tier === 'full' ? `${category.label}目标` : '',
      relation: category.label,
      description: `${category.label}的第 ${target} 张表达目标。`,
    };
  }

  if (binding.kind === 'risk') {
    const rank = binding.activationRank === undefined
      ? ''
      : String(Math.max(0, Math.round(binding.activationRank))).padStart(2, '0');
    if (binding.cardKind === 'hazard') {
      return {
        ...visual,
        bindingIndex,
        kind: binding.kind,
        mark: '危',
        primary: tier === 'thumbnail' ? '' : tier === 'standard' ? `危${rank}` : `危机${rank ? ` · 序 ${rank}` : ''}`,
        secondary: tier === 'full' ? '抽到后立即结算危机' : '',
        relation: '抽到后立即结算危机',
        description: `危机牌${rank ? `，序位 ${rank}` : ''}；抽到后立即结算。`,
      };
    }
    if (binding.cardKind === 'rescue') {
      return {
        ...visual,
        bindingIndex,
        kind: binding.kind,
        mark: '护',
        primary: tier === 'thumbnail' ? '' : tier === 'standard' ? `护${rank}` : `护航${rank ? ` · 序 ${rank}` : ''}`,
        secondary: tier === 'full' ? '解除危机并改变牌库风险' : '',
        relation: '解除危机并改变牌库风险',
        description: `护航牌${rank ? `，序位 ${rank}` : ''}；用于解除危机。`,
      };
    }
    const action = RISK_ACTIONS[binding.actionKind ?? ''] ?? { mark: '令', label: '通用指令' };
    return {
      ...visual,
      bindingIndex,
      kind: binding.kind,
      mark: action.mark,
      primary: tier === 'thumbnail' ? '' : tier === 'standard' ? action.mark : `${action.mark} · ${action.label}`,
      secondary: tier === 'full' ? '功能牌·打出后执行牌面指令' : '',
      relation: action.label,
      description: `${action.label}功能牌；打出后执行牌面指令。`,
    };
  }

  const role = compactCustomRole(binding.slotRole, tier === 'thumbnail' ? 'standard' : tier);
  const mark = firstGlyph(role, visual.moduleGlyph);
  return {
    ...visual,
    bindingIndex,
    kind: binding.kind,
    mark,
    primary: tier === 'thumbnail' ? '' : role,
    secondary: tier === 'full' ? '原创牌型角色' : '',
    relation: '原创牌型角色',
    description: `自定义牌型：${binding.slotRole.trim() || '未命名角色'}。`,
  };
}

function rapidSymbolsForBinding(
  binding: Extract<CardGameplayBinding, { kind: 'rapid' }>,
  bindingIndex: number,
  visual: GameplayModuleVisual,
  tier: GameplayDisplayTier,
): RapidSymbolPresentation[] {
  return binding.symbolIds.map((sourceId, symbolIndex) => {
    const index = rapidSymbolIndex(sourceId);
    const glyph = resolveRapidSymbolGlyph(sourceId);
    const ordinal = index === null ? '--' : String(index).padStart(2, '0');
    return {
      id: sourceId,
      bindingIndex,
      symbolIndex,
      sourceId,
      canonicalId: index === null ? sourceId : `symbol-${ordinal}`,
      index,
      glyph,
      label: tier === 'thumbnail' ? '' : tier === 'standard' ? glyph : `${ordinal} · ${glyph}`,
      description: index === null ? `未知象形纹样 ${sourceId}` : `象形纹样 ${ordinal}：${glyph}`,
      moduleId: visual.moduleId,
      moduleName: visual.moduleName,
      accentHex: visual.accentHex,
    };
  });
}

/**
 * Compiles gameplay bindings into a deterministic, renderer-independent display model.
 * Canvas and PDF renderers should consume this output rather than interpreting binding IDs themselves.
 */
export function buildCardGameplayPresentation(
  card: Pick<CardData, 'gameplay'>,
  modules: readonly GameplayRuleModule[] = [],
  tierOrWidth: GameplayDisplayTier | number = 'full',
): CardGameplayPresentation {
  const tier = resolveTier(tierOrWidth);
  const bindings = card.gameplay ?? [];
  const visuals = bindings.map((binding) => resolveModuleVisual(binding, modules));
  const items = bindings.map((binding, bindingIndex) =>
    presentationItem(binding, bindingIndex, visuals[bindingIndex], tier));
  const rapidSymbols = bindings.flatMap((binding, bindingIndex) =>
    binding.kind === 'rapid'
      ? rapidSymbolsForBinding(binding, bindingIndex, visuals[bindingIndex], tier)
      : []);

  const moduleVisuals = new Map<string, GameplayModuleVisual>();
  for (const visual of visuals) {
    if (!moduleVisuals.has(visual.moduleId)) moduleVisuals.set(visual.moduleId, visual);
  }
  const allSeals = [...moduleVisuals.values()];
  return {
    tier,
    rapidSymbols,
    items,
    seals: allSeals.slice(0, MAX_GAMEPLAY_MODULE_SEALS),
    overflowCount: Math.max(0, allSeals.length - MAX_GAMEPLAY_MODULE_SEALS),
  };
}
