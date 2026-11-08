import type {
  DeckData,
  GameModeId,
  GameplayMechanicId,
  GameplayRuleModule,
  RuleBook,
  RuleKit,
  RuleModuleContent,
  RuleParameter,
  RuleVariant,
} from './types';
import { planDeckComposition, summarizeDeckComposition } from './deck-composition.ts';
import { createCustomCompositionParameters } from './custom-composition.ts';
import {
  MAX_RULE_MODULES,
  normalizeRuleKitModuleIds,
  normalizeUniqueRuleModuleIds,
  requireRuleModuleId,
} from './rule-kit-constraints.ts';

type RuleModuleTemplate = Omit<GameplayRuleModule, 'id' | 'source' | 'enabled'> & {
  templateId: GameplayMechanicId;
};

export interface CustomRuleModuleInput {
  id?: string;
  name?: string;
  summary?: string;
  glyph?: string;
  accentHex?: string;
  tags?: string[];
  deckParts?: string;
  cardsInPlay?: number;
  content?: Partial<RuleModuleContent>;
}

const RAPID_MATCH: RuleModuleTemplate = {
  templateId: 'rapid-match',
  name: '瞬纹竞速',
  summary: '同步观察牌面，抢先确认唯一对应关系。',
  glyph: '瞬',
  accentHex: '#ef694f',
  tags: ['观察', '反应', '同步行动'],
  parameters: [
    {
      id: 'matchRule',
      label: '匹配条件',
      control: 'select',
      value: 'same-symbol',
      choices: [
        { value: 'same-symbol', label: '相同符号' },
      ],
    },
    { id: 'handSize', label: '同时亮牌', control: 'stepper', value: 1, min: 1, max: 3, step: 1, unit: '张' },
    {
      id: 'announceAction',
      label: '确认动作',
      control: 'select',
      value: 'name-and-point',
      choices: [
        { value: 'name-and-point', label: '喊出名称并指出位置' },
        { value: 'point-only', label: '只需指出位置' },
        { value: 'gesture', label: '完成自定义手势' },
      ],
    },
  ],
  content: {
    objective: ['抢先找出两张牌之间唯一成立的{{matchRule}}，在补给牌库耗尽前赢得最多公共牌。'],
    setup: ['洗匀完整套牌，每位玩家亮出{{handSize}}观察牌，中央翻开1张公共牌，其余牌组成补给牌库。'],
    flow: [
      '所有玩家同时比较自己的牌与公共牌，寻找唯一成立的{{matchRule}}。',
      '率先确认的玩家需要{{announceAction}}；确认无误后收走旧公共牌计1分，并将匹配成功的观察牌覆盖到公共牌区。',
      '成功者从补给牌库补回1张观察牌，新公共牌放稳后立即开始下一轮。',
      '若超过约定时间仍无人找到，由裁判提示共同符号的类别后继续观察；本轮牌面保持不变。',
    ],
    victory: ['补给牌库耗尽并完成当前轮后，收集公共牌最多的玩家获胜。'],
    variants: [
      { id: 'rapid-inverse', name: '逆向检索', description: '改为寻找两张牌中没有出现的指定特征。' },
      { id: 'rapid-passing', name: '环形传递', description: '玩家只比较自己与左侧玩家的牌，成功后双方交换手牌。' },
    ],
  },
};

const MEMORY_PAIR: RuleModuleTemplate = {
  templateId: 'memory-pair',
  name: '伏光记阵',
  summary: '隐藏信息反复显现，用位置记忆完成配对。',
  glyph: '忆',
  accentHex: '#4aaec8',
  tags: ['记忆', '隐藏信息', '配对'],
  parameters: [
    { id: 'pairCount', label: '配对数量', control: 'stepper', value: 24, min: 6, max: 32, step: 2, unit: '对' },
    { id: 'flipCount', label: '每回合翻牌', control: 'stepper', value: 2, min: 2, max: 2, step: 1, unit: '张' },
    { id: 'bonusTurn', label: '成功后追加回合', control: 'toggle', value: true },
  ],
  content: {
    objective: ['记住隐藏牌的位置与特征，收集比其他玩家更多的有效配对。'],
    setup: ['准备{{pairCount}}对卡牌，洗匀后背面朝上铺成规则网格，所有玩家都能看清每个位置。'],
    flow: [
      '当前玩家翻开任意{{flipCount}}，所有玩家共同查看牌面。',
      '若牌面满足本套装定义的配对条件，当前玩家收走它们并获得1分。',
      '成功后追加回合：{{bonusTurn}}。若未配对成功，将卡牌盖回原位置并切换玩家。',
      '任何玩家都不得移动未收走的牌，以确保位置记忆持续有效。',
    ],
    victory: ['桌面牌全部被收走后，配对数量最多的玩家获胜。'],
    variants: [
      { id: 'memory-action', name: '动作校验', description: '翻牌前完成牌面指定动作，错误则立刻结束回合。' },
      { id: 'memory-faction', name: '双层配对', description: '图案相同之外，还需满足阵营、颜色或元素条件。' },
    ],
  },
};

const QUANTITY_TRIGGER: RuleModuleTemplate = {
  templateId: 'quantity-trigger',
  name: '衡数鸣台',
  summary: '持续累加公开信息，在数量条件成立时抢先结算。',
  glyph: '衡',
  accentHex: '#d39032',
  tags: ['数量认知', '条件触发', '抢占'],
  parameters: [
    { id: 'targetTotal', label: '目标数量', control: 'stepper', value: 5, min: 2, max: 12, step: 1 },
    {
      id: 'triggerRelation',
      label: '触发关系',
      control: 'select',
      value: 'exact',
      choices: [
        { value: 'exact', label: '恰好等于' },
        { value: 'at-least', label: '大于或等于' },
        { value: 'two-types', label: '两类数量之和等于' },
      ],
    },
    { id: 'falsePenalty', label: '误触惩罚', control: 'stepper', value: 1, min: 0, max: 5, step: 1, unit: '张牌' },
  ],
  content: {
    objective: ['观察所有公开牌的数量变化，在同类标记总数{{triggerRelation}}{{targetTotal}}时抢先触发结算。'],
    setup: ['每位玩家获得5张起始手牌，其余牌组成补给牌库；将触发标记放在桌面中央。'],
    flow: [
      '玩家依次打出1张牌，牌面朝上放在自己面前，再从补给牌库补回1张手牌；旧牌仍保持可见。',
      '每次出牌后，所有玩家同步计算各类标记在桌面上的总数。',
      '当某类标记总数{{triggerRelation}}{{targetTotal}}时，最先触碰中央标记的玩家获得桌面全部公开牌。',
      '条件未成立便触发属于误触，误触者需支付{{falsePenalty}}作为惩罚。',
    ],
    victory: ['补给牌库耗尽并完成最后一轮后，收集卡牌最多的玩家获胜。'],
    variants: [
      { id: 'quantity-control', name: '节奏控制', description: '允许玩家弃1张手牌跳过出牌，以改变公开数量的发展。' },
      { id: 'quantity-combo', name: '复合等式', description: '由两类不同标记共同组成目标数量，任一组合成立即可触发。' },
    ],
  },
};

const ICON_COOP: RuleModuleTemplate = {
  templateId: 'icon-coop',
  name: '象语协作',
  summary: '用有限图标编码线索，由队友共同完成解读。',
  glyph: '象',
  accentHex: '#c85b79',
  tags: ['表达', '协作', '图标编码'],
  parameters: [
    { id: 'targetCount', label: '目标牌数量', control: 'stepper', value: 48, min: 24, max: 64, step: 4, unit: '张' },
    { id: 'clueLimit', label: '线索上限', control: 'stepper', value: 5, min: 2, max: 10, step: 1, unit: '枚' },
    { id: 'timeLimit', label: '回合时间', control: 'stepper', value: 180, min: 30, max: 300, step: 15, unit: '秒' },
    {
      id: 'clueMode',
      label: '表达限制',
      control: 'select',
      value: 'silent',
      choices: [
        { value: 'silent', label: '全程禁语' },
        { value: 'one-word', label: '只允许一个词' },
        { value: 'question-only', label: '只能回答是或否' },
      ],
    },
  ],
  content: {
    objective: ['在{{timeLimit}}内，用有限视觉线索帮助队友猜中目标牌。'],
    setup: ['将通用图标、类别图标与目标卡分区摆放；决定提示者与猜测者，并准备计时器。'],
    flow: [
      '提示者秘密查看1张目标卡，表达限制为：{{clueMode}}。',
      '提示者最多部署{{clueLimit}}图标，通过颜色、形状、动作、大小或类别编码线索。',
      '队友可以连续猜测；猜中后获得1分并清空本轮线索，猜错不扣分但计时继续。',
      '时间结束或线索用尽后切换提示者，开始下一回合。',
    ],
    victory: ['最先达到约定分数的队伍获胜；合作模式下则挑战在限定轮数内共同完成目标。'],
    variants: [
      { id: 'icon-blacklist', name: '直觉禁区', description: '每轮禁用一个最直观的图标，鼓励寻找间接表达。' },
      { id: 'icon-chain', name: '线索接力', description: '猜中后保留部分图标继续提示下一张牌，考验线索复用。' },
    ],
  },
};

const RISK_DRAW: RuleModuleTemplate = {
  templateId: 'risk-draw',
  name: '险途牌潮',
  summary: '在抽牌风险、保命资源与牌库顺序之间做选择。',
  glyph: '险',
  accentHex: '#8c6cd8',
  tags: ['风险管理', '手牌资源', '牌库操控'],
  parameters: [
    { id: 'hazardCount', label: '盒装危机', control: 'stepper', value: 5, min: 1, max: 8, step: 1, unit: '张' },
    { id: 'rescueCount', label: '盒装护航', control: 'stepper', value: 6, min: 1, max: 10, step: 1, unit: '张' },
    { id: 'peekCount', label: '预览牌数', control: 'stepper', value: 3, min: 1, max: 6, step: 1, unit: '张' },
  ],
  content: {
    objective: ['管理手牌与牌库风险，避免被危机淘汰并成为最后留在游戏中的玩家。'],
    setup: ['盒装含{{hazardCount}}危机牌与{{rescueCount}}护航牌；N人局只取N−1张危机与N张护航，多余牌留在盒中。每人先领1张护航和4张功能牌，再将剩余危机与功能牌洗成牌库。'],
    flow: [
      '回合中可打出任意数量的功能牌，随后必须从牌库抽1张牌来结束回合。',
      '抽到危机牌时，若没有护航牌则立即退出本局。',
      '打出护航牌可解除危机，并将危机牌秘密放回牌库任意位置。',
      '预览类效果可查看牌库顶{{peekCount}}；若卡牌文字允许，还可重新排列这些牌。',
    ],
    victory: ['当场上只剩1名玩家时游戏结束，该玩家获胜。'],
    variants: [
      { id: 'risk-forecast', name: '未来编排', description: '预览牌库顶若干张牌并重新排序，加强信息博弈。' },
      { id: 'risk-borrow', name: '资源借调', description: '加入交换或随机取得对手手牌的效果，改变资源分布。' },
    ],
  },
};

export const RULE_MODULE_TEMPLATES: Record<GameplayMechanicId, RuleModuleTemplate> = {
  'rapid-match': RAPID_MATCH,
  'memory-pair': MEMORY_PAIR,
  'quantity-trigger': QUANTITY_TRIGGER,
  'icon-coop': ICON_COOP,
  'risk-draw': RISK_DRAW,
};

export const RECOMMENDED_RULE_COMBOS = [
  {
    id: 'flash-memory',
    name: '闪忆双轨',
    description: '先记住隐藏位置，再以同步竞速完成公开匹配。',
    moduleIds: ['memory-pair', 'rapid-match'] as GameplayMechanicId[],
  },
  {
    id: 'signal-team',
    name: '共鸣信号',
    description: '以数量条件开启窗口，再由队友用图标完成协作任务。',
    moduleIds: ['quantity-trigger', 'icon-coop'] as GameplayMechanicId[],
  },
  {
    id: 'hidden-risk',
    name: '伏光险途',
    description: '将位置记忆变成规避危机与安排牌库的依据。',
    moduleIds: ['memory-pair', 'risk-draw'] as GameplayMechanicId[],
  },
  {
    id: 'maker-relay',
    name: '万象接力',
    description: '观察、数量与表达三种能力轮流成为回合焦点。',
    moduleIds: ['rapid-match', 'quantity-trigger', 'icon-coop'] as GameplayMechanicId[],
  },
] as const;

const MODE_MECHANICS: Record<GameModeId, GameplayMechanicId> = {
  reflex: 'rapid-match',
  memory: 'memory-pair',
  strategy: 'quantity-trigger',
  expression: 'icon-coop',
  mischief: 'risk-draw',
};

const DEFAULT_COMPONENTS: Record<GameplayMechanicId, string[]> = {
  'rapid-match': ['公共牌区', '匹配符号牌', '回合标记'],
  'memory-pair': ['成对图案牌', '背面统一的卡牌', '计分标记'],
  'quantity-trigger': ['数量标记牌', '中央触发标记', '补给牌库'],
  'icon-coop': ['目标卡', '通用图标', '类别图标', '计时器'],
  'risk-draw': ['危机牌', '护航牌', '功能牌', '抽牌牌库'],
};

function copyModule(template: RuleModuleTemplate, id: string = template.templateId): GameplayRuleModule {
  return {
    ...template,
    id: requireRuleModuleId(id),
    source: 'template',
    enabled: true,
    tags: [...template.tags],
    parameters: template.parameters.map((parameter) => ({
      ...parameter,
      choices: parameter.choices?.map((choice) => ({ ...choice })),
    })),
    content: {
      objective: [...template.content.objective],
      setup: [...template.content.setup],
      flow: [...template.content.flow],
      victory: [...template.content.victory],
      variants: template.content.variants.map((variant) => ({
        ...variant,
        enabled: variant.enabled ?? false,
      })),
    },
  };
}

function unique(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function canonicalRuleText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function uniqueRules(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    const canonical = canonicalRuleText(trimmed);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(trimmed);
  }
  return result;
}

function splitDeckRules(value: string): string[] {
  return uniqueRules(value.split(/\s*(?:\r?\n|[·•])\s*/u));
}

function safeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function minimumPlayersForRuleModules(modules: readonly GameplayRuleModule[]): number {
  const enabled = modules.filter((module) => module.enabled);
  if (enabled.some((module) => module.templateId === 'icon-coop')) return 3;
  if (enabled.some((module) => module.templateId !== undefined)) return 2;
  return 1;
}

function randomCustomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `custom-${crypto.randomUUID()}`;
  }
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRuleModule(
  templateId: GameplayMechanicId,
  instanceId: string = templateId,
): GameplayRuleModule {
  return copyModule(RULE_MODULE_TEMPLATES[templateId], instanceId);
}

export function createCustomRuleModule(input: CustomRuleModuleInput = {}): GameplayRuleModule {
  const content = input.content;
  return {
    id: input.id === undefined ? randomCustomId() : requireRuleModuleId(input.id),
    source: 'custom',
    name: input.name?.trim() || '我的玩法积木',
    summary: input.summary?.trim() || '由创作者定义的原创互动规则。',
    glyph: Array.from(input.glyph?.trim() || '创')[0],
    accentHex: /^#[0-9a-f]{6}$/i.test(input.accentHex ?? '') ? input.accentHex! : '#c84f3d',
    tags: unique(input.tags ?? ['自定义']),
    enabled: true,
    parameters: createCustomCompositionParameters(input.deckParts, input.cardsInPlay),
    content: {
      objective: unique(content?.objective ?? ['写下玩家在这一模块中要完成的目标。']),
      setup: unique(content?.setup ?? ['列出此模块加入游戏前需要准备的组件。']),
      flow: unique(content?.flow ?? ['按顺序描述玩家可执行的动作与状态变化。']),
      victory: unique(content?.victory ?? ['说明此模块如何得分、结束或判定胜负。']),
      variants: (content?.variants ?? []).map((variant) => ({
        ...variant,
        enabled: variant.enabled ?? true,
      })),
    },
  };
}

export function createRuleKit(
  title: string,
  moduleIds: GameplayMechanicId[],
  overrides: Partial<Omit<RuleKit, 'schemaVersion' | 'title' | 'modules'>> = {},
): RuleKit {
  const selected: GameplayMechanicId[] = moduleIds.length ? moduleIds : ['quantity-trigger'];
  if (selected.length > MAX_RULE_MODULES) {
    throw new RangeError(`玩法积木最多 ${MAX_RULE_MODULES} 枚。`);
  }
  const components = unique(selected.flatMap((id) => DEFAULT_COMPONENTS[id]));
  return {
    schemaVersion: 1,
    title: title.trim() || '原创卡牌玩法',
    playerRange: overrides.playerRange ?? { min: 2, max: 6 },
    durationMinutes: overrides.durationMinutes ?? { min: 15, max: 30 },
    ageFrom: overrides.ageFrom ?? 8,
    teamMode: overrides.teamMode ?? selected.includes('icon-coop'),
    components: overrides.components ? unique(overrides.components) : components,
    modules: selected.map((id, index) => createRuleModule(id, `${id}-${index + 1}`)),
    victory: overrides.victory ?? { mode: 'module-default' },
    customNotes: unique(overrides.customNotes ?? []),
  };
}

export function createRuleKitForMode(modeId: GameModeId, title = '原创卡牌玩法'): RuleKit {
  const mechanic = MODE_MECHANICS[modeId];
  const victory = mechanic === 'risk-draw' ? { mode: 'last-standing' as const } : { mode: 'module-default' as const };
  return createRuleKit(title, [mechanic], {
    playerRange: mechanic === 'icon-coop' ? { min: 3, max: 8 } : { min: 2, max: 6 },
    durationMinutes: mechanic === 'memory-pair' ? { min: 10, max: 25 } : { min: 15, max: 30 },
    ageFrom: 8,
    teamMode: mechanic === 'icon-coop',
    victory,
  });
}

export function createRuleKitFromCombo(comboId: string, title = '组合玩法'): RuleKit {
  const combo = RECOMMENDED_RULE_COMBOS.find((candidate) => candidate.id === comboId);
  return createRuleKit(title, combo ? [...combo.moduleIds] : ['quantity-trigger']);
}

function displayParameter(parameter: RuleParameter): string {
  if (parameter.control === 'toggle') return parameter.value ? '启用' : '关闭';
  const choice = parameter.choices?.find((candidate) => candidate.value === String(parameter.value));
  if (choice) return choice.label;
  return `${String(parameter.value)}${parameter.unit ?? ''}`;
}

function renderTemplate(value: string, parameters: RuleParameter[]): string {
  const values = new Map(parameters.map((parameter) => [parameter.id, displayParameter(parameter)]));
  return value.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_, id: string) => values.get(id) ?? '自定义');
}

export function renderRuleModuleContent(module: GameplayRuleModule): RuleModuleContent {
  const render = (value: string) => renderTemplate(value, module.parameters).trim();
  return {
    objective: module.content.objective.map(render).filter(Boolean),
    setup: module.content.setup.map(render).filter(Boolean),
    flow: module.content.flow.map(render).filter(Boolean),
    victory: module.content.victory.map(render).filter(Boolean),
    variants: module.content.variants.map((variant) => ({
      ...variant,
      name: render(variant.name),
      description: render(variant.description),
    })),
  };
}

function cloneRuleKit(ruleKit: RuleKit): RuleKit {
  return {
    ...ruleKit,
    playerRange: { ...ruleKit.playerRange },
    durationMinutes: { ...ruleKit.durationMinutes },
    components: [...ruleKit.components],
    modules: ruleKit.modules.map((module) => ({
      ...module,
      tags: [...module.tags],
      parameters: module.parameters.map((parameter) => ({
        ...parameter,
        choices: parameter.choices?.map((choice) => ({ ...choice })),
      })),
      content: {
        objective: [...module.content.objective],
        setup: [...module.content.setup],
        flow: [...module.content.flow],
        victory: [...module.content.victory],
        variants: module.content.variants.map((variant) => ({
          ...variant,
          enabled: variant.enabled ?? module.source === 'custom',
        })),
      },
    })),
    victory: { ...ruleKit.victory },
    customNotes: [...ruleKit.customNotes],
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRuleKitUsable(value: unknown): value is RuleKit {
  if (!value || typeof value !== 'object') return false;
  const kit = value as Partial<RuleKit>;
  if (
    kit.schemaVersion !== 1 ||
    typeof kit.title !== 'string' ||
    !kit.playerRange ||
    typeof kit.playerRange !== 'object' ||
    !kit.durationMinutes ||
    typeof kit.durationMinutes !== 'object' ||
    typeof kit.ageFrom !== 'number' ||
    typeof kit.teamMode !== 'boolean' ||
    !isStringArray(kit.components) ||
    !Array.isArray(kit.modules) ||
    !kit.modules.length ||
    kit.modules.length > MAX_RULE_MODULES ||
    !kit.victory ||
    typeof kit.victory !== 'object' ||
    !isStringArray(kit.customNotes)
  ) {
    return false;
  }
  return normalizeUniqueRuleModuleIds(kit.modules) !== null && kit.modules.every(
    (module) =>
      Boolean(module) &&
      typeof module.id === 'string' &&
      typeof module.name === 'string' &&
      typeof module.summary === 'string' &&
      typeof module.glyph === 'string' &&
      typeof module.accentHex === 'string' &&
      typeof module.enabled === 'boolean' &&
      isStringArray(module.tags) &&
      Array.isArray(module.parameters) &&
      Boolean(module.content) &&
      isStringArray(module.content.objective) &&
      isStringArray(module.content.setup) &&
      isStringArray(module.content.flow) &&
      isStringArray(module.content.victory) &&
      Array.isArray(module.content.variants) &&
      module.content.variants.every(
        (variant) =>
          Boolean(variant) &&
          typeof variant.id === 'string' &&
          typeof variant.name === 'string' &&
          typeof variant.description === 'string',
      ) &&
      module.parameters.every(
        (parameter) =>
          Boolean(parameter) &&
          typeof parameter.id === 'string' &&
          typeof parameter.label === 'string' &&
          ['stepper', 'toggle', 'select', 'text'].includes(parameter.control) &&
          (parameter.choices === undefined || Array.isArray(parameter.choices)),
      ),
  );
}

export function resolveDeckRuleKit(deck: DeckData): RuleKit {
  if (isRuleKitUsable(deck.ruleKit)) {
    const kit = cloneRuleKit(deck.ruleKit);
    kit.modules = normalizeRuleKitModuleIds(kit.modules);
    if (!kit.modules.some((module) => module.enabled) && kit.modules[0]) {
      kit.modules[0].enabled = true;
    }
    const requiredPlayers = minimumPlayersForRuleModules(kit.modules);
    kit.playerRange.min = Math.max(requiredPlayers, safeInteger(kit.playerRange.min, 2, 1, 8));
    kit.playerRange.max = safeInteger(kit.playerRange.max, kit.playerRange.min, kit.playerRange.min, 8);
    kit.durationMinutes.min = safeInteger(kit.durationMinutes.min, 15, 1, 240);
    kit.durationMinutes.max = safeInteger(
      kit.durationMinutes.max,
      kit.durationMinutes.min,
      kit.durationMinutes.min,
      240,
    );
    kit.ageFrom = safeInteger(kit.ageFrom, 8, 4, 18);
    kit.components = unique(kit.components);
    kit.customNotes = unique(kit.customNotes);
    for (const module of kit.modules) {
      if (module.templateId === 'rapid-match') {
        const matchRule = module.parameters.find((parameter) => parameter.id === 'matchRule');
        if (matchRule) {
          matchRule.value = 'same-symbol';
          matchRule.choices = [{ value: 'same-symbol', label: '相同符号' }];
        }
      }
      if (module.templateId === 'memory-pair') {
        const flipCount = module.parameters.find((parameter) => parameter.id === 'flipCount');
        if (flipCount) {
          flipCount.value = 2;
          flipCount.min = 2;
          flipCount.max = 2;
          flipCount.step = 1;
        }
      }
      if (!module.enabled || module.templateId !== 'risk-draw') continue;
      const hazard = module.parameters.find((parameter) => parameter.id === 'hazardCount');
      const rescue = module.parameters.find((parameter) => parameter.id === 'rescueCount');
      if (hazard) {
        hazard.value = Math.max(
          safeInteger(hazard.value, 5, 1, 8),
          Math.min(8, kit.playerRange.max - 1),
        );
      }
      if (rescue) {
        rescue.value = Math.max(
          safeInteger(rescue.value, 6, 1, 10),
          Math.min(10, kit.playerRange.max),
        );
      }
    }
    return kit;
  }

  const legacyRule = deck.rules.trim();
  if (!legacyRule) return createRuleKitForMode(deck.modeId, `${deck.name}玩法`);
  return createRuleKit(`${deck.name}玩法`, [MODE_MECHANICS[deck.modeId]], { customNotes: [legacyRule] });
}

function resolveVictory(ruleKit: RuleKit, moduleVictory: string[]): string[] {
  if (ruleKit.victory.mode === 'first-to-points') {
    const target = safeInteger(ruleKit.victory.target, 10, 1, 999);
    return [`最先达到${target}分的玩家或队伍获胜。`];
  }
  if (ruleKit.victory.mode === 'last-standing') return ['当场上只剩1名玩家或1支队伍时，游戏结束并获胜。'];
  if (ruleKit.victory.mode === 'custom' && ruleKit.victory.text?.trim()) {
    return [ruleKit.victory.text.trim()];
  }
  return unique(moduleVictory.length ? moduleVictory : ['完成所选模块的核心目标后，比较得分并判定胜负。']);
}

export function generateRuleBook(deck: DeckData): RuleBook {
  const ruleKit = resolveDeckRuleKit(deck);
  const compositionPlan = planDeckComposition(ruleKit);
  const enabledModules = ruleKit.modules.filter((module) => module.enabled);
  const modules = enabledModules.length ? enabledModules : [createRuleModule(MODE_MECHANICS[deck.modeId])];
  const rendered = modules.map((module) => ({ module, content: renderRuleModuleContent(module) }));
  const objective = unique(rendered.flatMap(({ content }) => content.objective));
  const setup = unique(rendered.flatMap(({ content }) => content.setup));
  const moduleVictory = rendered.flatMap(({ content }) => content.victory);
  const variants: RuleVariant[] = rendered.flatMap(({ module, content }) =>
    content.variants
      .filter((variant) => variant.enabled === true)
      .map((variant) => ({
        ...variant,
        id: `${module.id}:${variant.id}`,
        name: `${module.name} · ${variant.name}`,
      })),
  );
  const victory = resolveVictory(ruleKit, moduleVictory);
  const flow = [
    ...(modules.length > 1
      ? [
          {
            moduleName: '组合顺序',
            instruction: '按玩法积木在编辑器中的排列顺序分阶段进行；每个阶段只识别带对应玩法印谱的牌，完成该阶段目标后再进入下一阶段。带多枚印谱的牌可在多个阶段使用。',
          },
        ]
      : []),
    ...rendered.flatMap(({ module, content }) =>
      content.flow.map((instruction) => ({ moduleName: module.name, instruction })),
    ),
  ];
  const deckRuleSummary = summarizeRuleKit(ruleKit);
  const structuredRuleKeys = new Set(
    [...objective, ...setup, ...flow.map((step) => step.instruction), ...victory].map(canonicalRuleText),
  );
  const deckRules =
    canonicalRuleText(deck.rules) === canonicalRuleText(deckRuleSummary)
      ? []
      : splitDeckRules(deck.rules).filter((rule) => !structuredRuleKeys.has(canonicalRuleText(rule)));
  const deckRuleKeys = new Set(deckRules.map(canonicalRuleText));

  return {
    title: ruleKit.title,
    deckName: deck.name,
    world: deck.story.trim() || '每一套规则都从一次共同想象开始。',
    deckRules,
    audience: `${ruleKit.ageFrom}岁以上 · ${ruleKit.playerRange.min}-${ruleKit.playerRange.max}人${
      ruleKit.teamMode ? ' · 支持组队' : ''
    }`,
    duration:
      ruleKit.durationMinutes.min === ruleKit.durationMinutes.max
        ? `约${ruleKit.durationMinutes.min}分钟`
        : `${ruleKit.durationMinutes.min}-${ruleKit.durationMinutes.max}分钟`,
    objective: objective.length ? objective : ['完成创作者设定的核心挑战。'],
    setup: [
      `核对完整牌组共${compositionPlan.totalCards}张：${compositionPlan.parts.map((part) => `${part.label}${part.count}张`).join('、')}。`,
      `按本局人数取牌：${compositionPlan.playSetup.formula}`,
      ...(setup.length ? setup : ['洗匀卡牌，并按创作者标记摆放游戏组件。']),
    ],
    flow,
    victory,
    variants,
    components: unique([
      `完整牌组 ${compositionPlan.totalCards} 张`,
      ...compositionPlan.parts.map((part) => `${part.label} ${part.count} 张`),
      ...compositionPlan.playSetup.auxiliaryComponents,
      ...(ruleKit.components.length ? ruleKit.components : ['本套装卡牌', '计分标记']),
    ]),
    quickReference: [
      `牌组：${compositionPlan.totalCards}张完整套装`,
      `本局：${compositionPlan.playSetup.summary}`,
      ...modules.map((module) => `${module.name}：${module.summary}`),
      `胜负：${victory[0]}`,
    ],
    notes: uniqueRules([
      ...ruleKit.customNotes.filter((note) => {
        const canonical = canonicalRuleText(note);
        return !deckRuleKeys.has(canonical) && !structuredRuleKeys.has(canonical);
      }),
      ruleKit.teamMode ? '组队游玩时，建议让不同年龄的玩家交替担任提示者或起始玩家。' : '',
    ]),
  };
}

export function summarizeRuleKit(ruleKit: RuleKit): string {
  const enabled = ruleKit.modules.filter((module) => module.enabled);
  const names = (enabled.length ? enabled : ruleKit.modules).map((module) => module.name);
  return `${names.join(' + ')} · ${ruleKit.playerRange.min}-${ruleKit.playerRange.max}人 · ${
    ruleKit.durationMinutes.min === ruleKit.durationMinutes.max
      ? ruleKit.durationMinutes.min
      : `${ruleKit.durationMinutes.min}-${ruleKit.durationMinutes.max}`
  }分钟`;
}

export function renderDeckRules(deck: DeckData): string {
  const ruleKit = resolveDeckRuleKit(deck);
  const parameters = ruleKit.modules.flatMap((module) => module.parameters);
  return renderTemplate(deck.rules, parameters).trim();
}

export function applyRuleKitToDeck(deck: DeckData, nextRuleKit: RuleKit): DeckData {
  const previousSummary = summarizeRuleKit(resolveDeckRuleKit(deck));
  const hasAuthoredRules = canonicalRuleText(deck.rules) !== canonicalRuleText(previousSummary);
  const compositionPlan = planDeckComposition(nextRuleKit);
  return {
    ...deck,
    ruleKit: nextRuleKit,
    rules: hasAuthoredRules ? deck.rules : summarizeRuleKit(nextRuleKit),
    composition: summarizeDeckComposition(compositionPlan, deck.cards.length),
  };
}
