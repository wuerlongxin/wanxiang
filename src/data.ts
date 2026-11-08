import type { CardBackDesign, CardData, CardGameplayBinding, DeckData, GameMode, GameModeId, RuleKit } from './types';
import {
  gameplayBindingsForSlot,
  planDeckComposition,
  summarizeDeckComposition,
  type DeckCompositionSlot,
} from './deck-composition.ts';
import { createRuleKitForMode, summarizeRuleKit } from './rules.ts';
import type { ArtStyleId } from './art-styles';

export const GAME_MODES: GameMode[] = [
  {
    id: 'reflex',
    index: '01',
    name: '闪击试炼',
    english: 'REFLEX',
    cardName: '焰刻追光者',
    tagline: '先手 · 连击 · 决胜一瞬',
    accent: 0xff6d5f,
    accentHex: '#ff6d5f',
    accentSoft: 0xffb067,
    deep: 0x531b24,
    artwork: '/assets/cards/reflex.jpg',
    glyph: '疾',
  },
  {
    id: 'memory',
    index: '02',
    name: '星图回响',
    english: 'MEMORY',
    cardName: '星图守忆人',
    tagline: '观察 · 配对 · 唤醒星痕',
    accent: 0x5fc9e8,
    accentHex: '#5fc9e8',
    accentSoft: 0x8ff0db,
    deep: 0x173f55,
    artwork: '/assets/cards/memory.jpg',
    glyph: '忆',
  },
  {
    id: 'strategy',
    index: '03',
    name: '万象棋局',
    english: 'STRATEGY',
    cardName: '霜脉棋师',
    tagline: '布局 · 资源 · 逆转战局',
    accent: 0x54d59c,
    accentHex: '#54d59c',
    accentSoft: 0xd1e77f,
    deep: 0x183f32,
    artwork: '/assets/cards/strategy.jpg',
    glyph: '策',
  },
  {
    id: 'expression',
    index: '04',
    name: '共鸣剧场',
    english: 'EXPRESSION',
    cardName: '共鸣织诗者',
    tagline: '表达 · 协作 · 共创篇章',
    accent: 0xf2bd59,
    accentHex: '#f2bd59',
    accentSoft: 0xff7c8b,
    deep: 0x58401b,
    artwork: '/assets/cards/expression.jpg',
    glyph: '和',
  },
  {
    id: 'mischief',
    index: '05',
    name: '奇趣乱斗',
    english: 'MISCHIEF',
    cardName: '混沌糖炮手',
    tagline: '猜心 · 反制 · 欢乐翻盘',
    accent: 0xc88cff,
    accentHex: '#c88cff',
    accentSoft: 0xff83b6,
    deep: 0x48215d,
    artwork: '/assets/cards/mischief.jpg',
    glyph: '趣',
  },
];

export const MODE_BY_ID = Object.fromEntries(GAME_MODES.map((mode) => [mode.id, mode])) as Record<
  GameModeId,
  GameMode
>;

const CARD_BACK_STYLES: CardBackDesign['style'][] = ['forge', 'constellation', 'circuit', 'sigil'];

const STARTER_ART_STYLE: Record<GameModeId, ArtStyleId> = {
  reflex: 'lacquer-gilt',
  memory: 'silk-landscape',
  strategy: 'dunhuang-mineral',
  expression: 'paper-cut-festival',
  mischief: 'cyber-guochao',
};

const STARTER_AUTHORS: Record<GameModeId, string> = {
  reflex: '南星',
  memory: '鲸屿',
  strategy: '木棉',
  expression: '折光',
  mischief: '小满',
};

type StarterCardBlueprint = Pick<
  CardData,
  'name' | 'title' | 'attack' | 'defense' | 'cost' | 'skill' | 'flavor' | 'rarity'
>;

const STARTER_CARD_BLUEPRINTS: Record<GameModeId, readonly StarterCardBlueprint[]> = {
  reflex: [
    {
      name: '焰刻追光者', title: '同纹先行者', attack: 9, defense: 4, cost: 3, rarity: '传说',
      skill: '发现本牌与公共牌的唯一同纹并喊出名称后，立即将本牌覆盖到公共牌上。',
      flavor: '他追的不是火光，是两枚纹样相认的一瞬。',
    },
    {
      name: '镜纹辨星师', title: '双面观察员', attack: 6, defense: 7, cost: 4, rarity: '史诗',
      skill: '正确指出相同纹样后，可指定一名玩家展示手牌顶端的一个图案。',
      flavor: '铜镜转过半圈，藏在边角的星纹便醒了。',
    },
    {
      name: '折光报时童', title: '连击传令官', attack: 8, defense: 5, cost: 2, rarity: '稀有',
      skill: '连续两次率先完成匹配时，第二次无需喊名即可结算，但必须准确指出图案。',
      flavor: '纸鹤掠过长空，把答案送到钟声之前。',
    },
    {
      name: '月轮寻印官', title: '逆向寻纹者', attack: 5, defense: 9, cost: 5, rarity: '稀有',
      skill: '启用逆向变体时，率先指出两牌中不存在的指定图案，可额外打出一张手牌。',
      flavor: '众人看见已有之物，他专注于那一道留白。',
    },
  ],
  memory: [
    {
      name: '星图守忆人', title: '星痕记录者', attack: 4, defense: 9, cost: 3, rarity: '传说',
      skill: '翻出的两张牌配对成功后，将其中一个位置标记为星痕，本回合可再翻一组。',
      flavor: '每颗星都记得自己曾在何处发亮。',
    },
    {
      name: '玉盘复位师', title: '阵列整理者', attack: 5, defense: 8, cost: 2, rarity: '史诗',
      skill: '配对失败并盖回时，可将其中一张旋转九十度，作为仅自己可用的位置提示。',
      flavor: '山河归位，记忆也沿着玉盘的刻度归来。',
    },
    {
      name: '千鹤联想童', title: '动作记忆使', attack: 7, defense: 5, cost: 4, rarity: '稀有',
      skill: '翻牌前完成本牌指定动作；本次配对成功时额外获得一枚记忆标记。',
      flavor: '一只纸鹤是一条线索，千只便是一片星河。',
    },
    {
      name: '流火巡格者', title: '阵营校验官', attack: 8, defense: 4, cost: 5, rarity: '稀有',
      skill: '启用阵营变体时，仅当图案与阵营均相同才收取卡牌；成功后可查看一张未翻开的牌。',
      flavor: '脚步越快，越要记清每一束光落下的位置。',
    },
  ],
  strategy: [
    {
      name: '霜脉棋师', title: '精确计数者', attack: 6, defense: 9, cost: 4, rarity: '传说',
      skill: '当桌面同类符号总数恰好为五时抢先触发，收取本轮所有亮牌。',
      flavor: '山河落入方寸，胜机藏在不多不少的第五枚。',
    },
    {
      name: '赤轮调度使', title: '节奏推进者', attack: 9, defense: 5, cost: 3, rarity: '史诗',
      skill: '打出本牌后可令一种符号数量增加一；若因此超过五，本回合不能触发结算。',
      flavor: '他让机关快一拍，也承担越过刻度的代价。',
    },
    {
      name: '星盘验算官', title: '双重条件师', attack: 5, defense: 8, cost: 5, rarity: '稀有',
      skill: '启用双重条件时，可用两种符号的数量之和凑成五并完成触发。',
      flavor: '两条星轨交汇时，答案仍旧落在同一个刻度。',
    },
    {
      name: '纸阵留白客', title: '弃牌谋略家', attack: 7, defense: 6, cost: 2, rarity: '稀有',
      skill: '可弃置本牌跳过一次出牌，以保留当前桌面总数；每轮限用一次。',
      flavor: '最好的落子有时是一片没有落下的纸。',
    },
  ],
  expression: [
    {
      name: '共鸣织诗者', title: '无言提示者', attack: 5, defense: 8, cost: 3, rarity: '传说',
      skill: '担任提示者时只能放置颜色、形状与动作图标；队友猜中后获得一枚共鸣标记。',
      flavor: '他不说一个字，却让整片天空读懂了答案。',
    },
    {
      name: '月镜分类师', title: '子类引路人', attack: 4, defense: 9, cost: 2, rarity: '史诗',
      skill: '每回合可额外放置一个子类别图标，但不能选择目标最直观的特征。',
      flavor: '镜中没有谜底，只有通往谜底的那一类光。',
    },
    {
      name: '流焰接句客', title: '连环猜领队', attack: 8, defense: 5, cost: 5, rarity: '稀有',
      skill: '队友猜中后可保留一个已放图标进入下一题；连续猜中时共鸣标记逐次增加。',
      flavor: '上一句的余韵，正好成为下一段故事的开头。',
    },
    {
      name: '山河图标匠', title: '线索编排师', attack: 6, defense: 7, cost: 4, rarity: '稀有',
      skill: '提示图标达到上限时，可收回一个旧图标并替换为新图标，但计时不会暂停。',
      flavor: '方寸图标排成山河，队友便循着脉络抵达。',
    },
  ],
  mischief: [
    {
      name: '混沌糖炮手', title: '风险改写者', attack: 9, defense: 4, cost: 4, rarity: '传说',
      skill: '抽到危机牌并使用拆除效果后，可将危机牌暗中放回牌堆任意位置。',
      flavor: '甜味只是烟幕，真正的惊喜藏在下一次抽牌。',
    },
    {
      name: '千鹤换序师', title: '未来编排者', attack: 5, defense: 8, cost: 3, rarity: '史诗',
      skill: '查看牌堆顶三张牌并任意重排，然后将本牌弃置。',
      flavor: '纸鹤飞过三种未来，只带回来最好笑的那一种。',
    },
    {
      name: '疾火反转客', title: '回合搅局者', attack: 8, defense: 5, cost: 2, rarity: '稀有',
      skill: '打出后反转行动顺序，并由下一位玩家立刻开始回合。',
      flavor: '他跑得太快，连回合的方向都跟着掉头。',
    },
    {
      name: '月轮借宝官', title: '资源交换者', attack: 6, defense: 7, cost: 5, rarity: '稀有',
      skill: '指定一名玩家与你随机交换一张手牌；双方手牌为空时不能使用。',
      flavor: '月轮转一圈，谁的宝贝到了谁手里可就难说了。',
    },
  ],
};

/**
 * 本地完整套牌内容（无 AI）。
 *
 * 原来的本地生成只有每种玩法 4 张手写样卡可循环：套牌张数虽然对得上规划，
 * 但名字、技能与卡面都在重复，严格说只是 4 张样卡的复制品，不能直接开局。
 * 这里为每个规则槽位确定性地派生一张独立卡牌：名字取自按玩法洗牌后的
 * 词缀组合（保证同套牌内不重名），称号、数值与稀有度由槽位哈希决定，
 * 技能文案则按该槽位的玩法标记写成（符号、配对、数值、目标或功能家族），
 * 卡面仍循环本机 4 张内置图，但按玩法分组取图：记忆配对的 A/B 两面共用
 * 一张图，策略同类、共鸣同目标类别、奇趣同功能家族也共用一张图，
 * 便于在桌面上按图分组识别。
 */
const LOCAL_NAME_PARTS: Record<GameModeId, { prefixes: string[]; suffixes: string[] }> = {
  reflex: {
    prefixes: ['焰刻', '星轨', '云雷', '霜刃', '月轮', '澜涛', '烟岚', '金晷'],
    suffixes: ['追光者', '辨星师', '报时童', '寻印官', '巡格者', '守夜人', '引路客', '望舒使'],
  },
  memory: {
    prefixes: ['星图', '玉盘', '千鹤', '流火', '雾汀', '雪盏', '松涛', '沧澜'],
    suffixes: ['守忆人', '复位师', '联想童', '巡格者', '校验官', '记星使', '归位客', '望川者'],
  },
  strategy: {
    prefixes: ['霜脉', '赤轮', '星盘', '纸阵', '玄枰', '青瓷', '铁马', '云汀'],
    suffixes: ['棋师', '调度使', '验算官', '留白客', '谋略家', '守关人', '推演者', '布阵师'],
  },
  expression: {
    prefixes: ['共鸣', '月镜', '流焰', '山河', '云锦', '雾鼓', '雪弦', '星野'],
    suffixes: ['织诗者', '分类师', '接句客', '图标匠', '传声使', '绘梦人', '和声客', '叙事者'],
  },
  mischief: {
    prefixes: ['混沌', '千鹤', '疾火', '月轮', '糖霜', '雾炮', '星屑', '云梯'],
    suffixes: ['糖炮手', '换序师', '反转客', '借宝官', '捣蛋使', '翻盘手', '藏宝者', '戏法师'],
  },
};

const LOCAL_TITLES: Record<GameModeId, string[]> = {
  reflex: ['同纹先行者', '双面观察员', '连击传令官', '逆向寻纹者', '抢答快手', '纹样猎手', '瞬判使', '夺纹客'],
  memory: ['星痕记录者', '阵列整理者', '动作记忆使', '阵营校验官', '位置守望者', '星图绘卷师', '回响拾音人', '双面证人'],
  strategy: ['精确计数者', '节奏推进者', '双重条件师', '弃牌谋略家', '局势拆解师', '资源守衡者', '后手逆转家', '边界测绘师'],
  expression: ['无言提示者', '子类引路人', '连环猜领队', '线索编排师', '意象翻译官', '氛围造梦者', '默契点灯人', '故事接龙客'],
  mischief: ['风险改写者', '未来编排者', '回合搅局者', '资源交换者', '笑声收集家', '规则捣蛋鬼', '惊喜派送员', '逆风翻盘手'],
};

const LOCAL_FLAVORS: Record<GameModeId, string[]> = {
  reflex: [
    '快的不只是手，是眼睛先一步认出了答案。',
    '六枚纹样里，只有一枚在两张牌上同时发亮。',
    '他数星星不用夜晚，一眼就够了。',
    '抢答之前，先学会安静地看。',
    '火光落下时，图案已经自己排好了队。',
    '慢一步的人，看到的是上一局的星空。',
  ],
  memory: [
    '翻开是偶然，记住是本事。',
    '星星不会搬家，只等你想起它住哪。',
    '每一对牌，都是星空写给自己的回信。',
    '盖回去的不是牌，是刚刚走过的路。',
    '位置记得越牢，星星亮得越久。',
    '两张牌相认的那一刻，整片星图都点了头。',
  ],
  strategy: [
    '棋盘从不说话，只等有人算出第五枚。',
    '多一枚是贪心，少一枚是遗憾。',
    '他下的每一步，都在等对手先露出数字。',
    '胜负不在落子时，而在数到五的那一刻。',
    '四类棋子各有脾气，唯有耐心能把它们数齐。',
    '留白不是放弃，是给下一手腾出位置。',
  ],
  expression: [
    '说不出口的时候，就让图标替你开口。',
    '一个眼神，一枚图标，胜过十句解释。',
    '猜中的不是答案，是彼此想到了一处。',
    '他把故事拆成碎片，再请队友一片片拼回去。',
    '沉默是最难的提示，也是最准的提示。',
    '当全场同时点头，谜底就自己走了出来。',
  ],
  mischief: [
    '规矩是用来遵守的，也是用来翻盘的。',
    '他抽牌靠运气，赢牌靠的全是胆子。',
    '危险和惊喜住在同一张牌里，只看你先翻到哪一面。',
    '笑到最后的人，往往是先被淘汰的那个。',
    '牌堆越乱，他的心情越好。',
    '别数他的牌，数一数你还剩几次笑出声的机会。',
  ],
};

const EXPRESSION_CATEGORY_LABELS: Record<string, string> = {
  living: '角色与生灵',
  object: '器物与造物',
  place: '地点与环境',
  action: '动作与事件',
  concept: '情绪与概念',
};

const MISCHIEF_FAMILY_LABELS: Record<string, { label: string; purpose: string }> = {
  hazard: { label: '危机', purpose: '作为抽牌阶段的淘汰风险。' },
  rescue: { label: '护航', purpose: '解除危机并允许重新放置风险。' },
  skip: { label: '跳过', purpose: '结束或跳过当前抽牌阶段。' },
  reverse: { label: '反转', purpose: '改变回合进行方向。' },
  attack: { label: '追击', purpose: '将额外回合压力交给下一位玩家。' },
  forecast: { label: '未来视界', purpose: '查看牌库顶部的风险信息。' },
  reorder: { label: '篡序', purpose: '重新排列已查看的牌库顶牌。' },
  steal: { label: '偷取', purpose: '随机获得对手的一张手牌。' },
  exchange: { label: '交换', purpose: '与指定玩家交换手牌资源。' },
  demand: { label: '索要', purpose: '指定类型向对手索要一张牌。' },
};

const MISCHIEF_FAMILY_ORDER = [
  'hazard', 'rescue', 'skip', 'reverse', 'attack',
  'forecast', 'reorder', 'steal', 'exchange', 'demand',
] as const;

const EXPRESSION_CATEGORY_ORDER = ['living', 'object', 'place', 'action', 'concept'] as const;

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const localNameOrders = new Map<GameModeId, string[]>();

function localNameOrder(modeId: GameModeId): string[] {
  const cached = localNameOrders.get(modeId);
  if (cached) return cached;
  const { prefixes, suffixes } = LOCAL_NAME_PARTS[modeId];
  const combos = prefixes.flatMap((prefix) => suffixes.map((suffix) => `${prefix}${suffix}`));
  const random = mulberry32(hashSeed(`wanxiang-name-order:${modeId}`));
  for (let index = combos.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [combos[index], combos[other]] = [combos[other], combos[index]];
  }
  localNameOrders.set(modeId, combos);
  return combos;
}

function skillForBinding(
  modeId: GameModeId,
  slot: DeckCompositionSlot,
  binding: CardGameplayBinding | undefined,
  seed: number,
): string {
  if (!binding) return '按说明书结算本牌的规则印谱。';
  switch (binding.kind) {
    case 'rapid': {
      const variants = [
        '连续两次率先完成匹配时，第二次无需喊名即可结算，但必须准确指出图案。',
        '正确指出相同纹样后，可指定一名玩家展示手牌顶端的一个图案。',
        '率先完成匹配后，可将本牌直接覆盖到公共牌上并立刻再翻一张。',
      ];
      return `本牌携 ${binding.symbolIds.length} 枚纹样；与公共牌比对，率先喊出唯一同纹即可收取。${variants[seed % variants.length]}`;
    }
    case 'memory': {
      const faction = typeof slot.attributes.factionId === 'string'
        ? slot.attributes.factionId.replace('faction-', '')
        : undefined;
      const side = binding.pairRole === 'a' ? 'A 面' : 'B 面';
      const other = binding.pairRole === 'a' ? 'B 面' : 'A 面';
      return `本牌为配对 ${binding.pairId} 的${side}；翻出后记住位置，待${other}出现即成对收取。${faction ? `阵营「${faction}」：仅当图案与阵营均相同才算配对成功。` : ''}`;
    }
    case 'quantity': {
      const target = binding.targetTotal ?? 5;
      return `本牌属数量类别 ${binding.categoryId.replace('category-', '')}，数值 ${binding.value}；桌面同类数值合计恰好为 ${target} 时抢先触发，收取本轮所有亮牌。`;
    }
    case 'expression': {
      const categoryId = typeof slot.attributes.targetCategory === 'string'
        ? slot.attributes.targetCategory
        : undefined;
      const label = (categoryId && EXPRESSION_CATEGORY_LABELS[categoryId]) ?? '目标';
      return `本牌目标属「${label}」；提示者只能用图标示意，不能说话，队友猜中即得分。`;
    }
    case 'risk': {
      if (binding.cardKind === 'hazard') {
        return `危机牌第 ${binding.activationRank ?? 1} 枚；抽到时须以护航化解，否则本回合结束。`;
      }
      if (binding.cardKind === 'rescue') {
        return `护航牌第 ${binding.activationRank ?? 1} 枚；可化解一张危机，并将其放回牌堆任意位置。`;
      }
      const family = binding.actionKind
        ? MISCHIEF_FAMILY_LABELS[binding.actionKind]
        : undefined;
      return family
        ? `功能牌·${family.label}：${family.purpose}`
        : '功能牌：按说明书结算本牌的效果。';
    }
    case 'custom':
      return `本牌承载「${binding.slotRole}」的规则印谱，按说明书结算。`;
    default:
      return '按说明书结算本牌的规则印谱。';
  }
}

function artIndexForSlot(modeId: GameModeId, slot: DeckCompositionSlot, index: number): number {
  const attributes = slot.attributes;
  switch (modeId) {
    case 'memory': {
      const pairId = typeof attributes.pairId === 'string' ? attributes.pairId : '';
      const pairNumber = Number(/(\d+)/u.exec(pairId)?.[1] ?? '1');
      return ((pairNumber - 1) % 4 + 4) % 4;
    }
    case 'strategy': {
      const category = typeof attributes.category === 'number' ? attributes.category : 1;
      return ((category - 1) % 4 + 4) % 4;
    }
    case 'expression': {
      const targetCategory = typeof attributes.targetCategory === 'string' ? attributes.targetCategory : 'living';
      const order = Math.max(0, EXPRESSION_CATEGORY_ORDER.indexOf(targetCategory as (typeof EXPRESSION_CATEGORY_ORDER)[number]));
      return order % 4;
    }
    case 'mischief': {
      const family = typeof attributes.effectFamily === 'string' ? attributes.effectFamily : 'skip';
      const order = Math.max(0, MISCHIEF_FAMILY_ORDER.indexOf(family as (typeof MISCHIEF_FAMILY_ORDER)[number]));
      return order % 4;
    }
    default:
      return ((index % 4) + 4) % 4;
  }
}

function rarityForSeed(seed: number): CardData['rarity'] {
  const roll = (seed >>> 12) % 100;
  if (roll < 7) return '传说';
  if (roll < 25) return '史诗';
  if (roll < 60) return '稀有';
  return '普通';
}

/**
 * 为规则槽位生成一张内容独立的本地卡牌。
 * 前 4 个槽位沿用手写样卡（大厅封面与预览共用同一批牌），其余槽位按词缀
 * 组合、槽位哈希与玩法标记确定性派生，同套牌内不重名、不重复技能。
 *
 * 注意：玩法标记必须取自套牌所带规则包（ruleKit）的规划，而不是玩法
 * 默认规划——两者槽位相同，但模块编号不同（规则包里是 rapid-match-1
 * 这样的实例编号），混用会导致整套牌的玩法校验全部判为缺失。
 */
export function createLocalDeckCard(modeId: GameModeId, index = 0, ruleKit?: RuleKit): CardData {
  const plan = ruleKit ? planDeckComposition(ruleKit) : planDeckComposition(modeId);
  const slot = plan.slots[((index % plan.slots.length) + plan.slots.length) % plan.slots.length];
  if (index < STARTER_CARD_BLUEPRINTS[modeId].length) {
    const archetype = createStarterCard(modeId, index);
    return {
      ...archetype,
      artUrl: `/assets/cards/starter/${modeId}-${artIndexForSlot(modeId, slot, index) + 1}.jpg`,
      gameplay: gameplayBindingsForSlot(plan, slot),
    };
  }
  const bindings = gameplayBindingsForSlot(plan, slot);
  const seed = hashSeed(`${modeId}:${slot.id}`);
  const archetypeNames = new Set(STARTER_CARD_BLUEPRINTS[modeId].map((blueprint) => blueprint.name));
  const order = localNameOrder(modeId);
  const ordinal = index - STARTER_CARD_BLUEPRINTS[modeId].length;
  let name = '';
  let seen = -1;
  for (const candidate of order) {
    if (archetypeNames.has(candidate)) continue;
    seen += 1;
    if (seen === ordinal) {
      name = candidate;
      break;
    }
  }
  if (!name) name = `${MODE_BY_ID[modeId].name} · ${String(index + 1).padStart(2, '0')}`;
  const titles = LOCAL_TITLES[modeId];
  const flavors = LOCAL_FLAVORS[modeId];
  const artIndex = artIndexForSlot(modeId, slot, index);
  return {
    id: `${modeId}-${index + 1}`,
    name,
    title: titles[seed % titles.length],
    modeId,
    artUrl: `/assets/cards/starter/${modeId}-${artIndex + 1}.jpg`,
    attack: 4 + (seed % 6),
    defense: 4 + ((seed >>> 4) % 6),
    cost: 2 + ((seed >>> 8) % 4),
    skill: skillForBinding(modeId, slot, bindings[0], seed),
    flavor: flavors[(seed >>> 6) % flavors.length],
    rarity: rarityForSeed(seed),
    author: STARTER_AUTHORS[modeId],
    inscriptionStyle: 'seal',
    inscriptionPlacement: 'front',
    inscriptionText: STARTER_AUTHORS[modeId],
    gameplay: bindings,
  };
}

export function createCardBack(modeId: GameModeId, label: string, seed?: number): CardBackDesign {
  const modeIndex = GAME_MODES.findIndex((mode) => mode.id === modeId);
  const safeSeed = seed ?? 1103 + Math.max(0, modeIndex) * 7919;
  return {
    style: CARD_BACK_STYLES[Math.abs(safeSeed) % CARD_BACK_STYLES.length],
    seed: safeSeed,
    label,
  };
}

export function createStarterCard(modeId: GameModeId, index = 0): CardData {
  const cards = STARTER_CARD_BLUEPRINTS[modeId];
  const normalizedIndex = ((index % cards.length) + cards.length) % cards.length;
  const blueprint = cards[normalizedIndex];
  const plan = planDeckComposition(modeId);
  const slot = plan.slots[((index % plan.slots.length) + plan.slots.length) % plan.slots.length];
  return {
    id: `${modeId}-${index + 1}`,
    ...blueprint,
    modeId,
    artUrl: `/assets/cards/starter/${modeId}-${normalizedIndex + 1}.jpg`,
    author: STARTER_AUTHORS[modeId],
    inscriptionStyle: 'seal',
    inscriptionPlacement: 'front',
    inscriptionText: STARTER_AUTHORS[modeId],
    gameplay: gameplayBindingsForSlot(plan, slot),
  };
}

export function createStarterDeck(modeId: GameModeId): DeckData {
  const mode = MODE_BY_ID[modeId];
  const name = `${mode.name} · 原型套装`;
  const author = STARTER_AUTHORS[modeId];
  const ruleKit = createRuleKitForMode(modeId, `${mode.name}玩法`);
  const compositionPlan = planDeckComposition(ruleKit);
  return {
    id: `starter-${modeId}`,
    theme: mode.name,
    name,
    modeId,
    story: `在${mode.name}的边界，年轻的锻卡师以记忆、勇气与想象为燃料，唤醒沉睡的卡灵。`,
    rules: summarizeRuleKit(ruleKit),
    cards: Array.from({ length: compositionPlan.totalCards }, (_, index) => createLocalDeckCard(modeId, index, ruleKit)),
    author,
    artStyleId: STARTER_ART_STYLE[modeId],
    cardBack: createCardBack(modeId, name),
    ruleKit,
    creatorPlaque: {
      displayName: author,
      studioName: '万象少年造物局',
      signatureText: author,
      sealText: `${author}制`,
      edition: '原创首版',
      serialNumber: `AD-${mode.index}-0001`,
    },
    composition: summarizeDeckComposition(compositionPlan, compositionPlan.totalCards),
  };
}

export const THEME_PRESETS = ['赛博西游', '山海机关城', '月背学院', '云端龙舟'];
