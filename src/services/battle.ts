import type { CardData, DeckData } from '../types';

/**
 * 对战模式引擎（纯逻辑，不依赖渲染）。
 *
 * 玩法（与灵光《万象卡牌·对战模式》同形：选对手、开始对战）：
 * 双方各 20 点生命，用同一套牌的洗牌副本对战。起始手牌 3 张，每回合开始
 * 抽 1 张（手牌上限 7 张）。每回合获得费用：第 1 回合 2 点，每回合 +1，
 * 上限 5 点。出牌支付费用，造成等同攻击的伤害，并获得等同防御的护甲；
 * 护甲先抵挡伤害，在持有者下回合开始时消失。先把对手生命打到 0 者获胜。
 */

export type BattleDifficultyId = 'apprentice' | 'craftsman' | 'master';

export interface BattleOpponent {
  id: BattleDifficultyId;
  name: string;
  title: string;
  description: string;
}

export const BATTLE_OPPONENTS: BattleOpponent[] = [
  {
    id: 'apprentice',
    name: '见习学徒',
    title: '对手出牌随意，适合新手热身',
    description: '每回合最多出两张牌，常常留着费用不用。',
  },
  {
    id: 'craftsman',
    name: '熟练工匠',
    title: '对手会解场换血，稳步进攻',
    description: '按攻击性价比出牌，血量告急时先立护甲。',
  },
  {
    id: 'master',
    name: '宗师匠魂',
    title: '对手精打细算，追求斩杀',
    description: '算清每一分伤害，能斩杀时绝不留手。',
  },
];

export const BATTLE_OPPONENT_BY_ID: Record<BattleDifficultyId, BattleOpponent> =
  Object.fromEntries(BATTLE_OPPONENTS.map((opponent) => [opponent.id, opponent])) as Record<
    BattleDifficultyId,
    BattleOpponent
  >;

export const BATTLE_START_HP = 20;
export const BATTLE_START_HAND = 3;
export const BATTLE_MAX_HAND = 7;
export const BATTLE_MAX_ENERGY = 5;

export function battleEnergyForTurn(turn: number): number {
  return Math.min(turn + 1, BATTLE_MAX_ENERGY);
}

export type BattleSideId = 'player' | 'opponent';

export interface BattleSideState {
  hp: number;
  maxHp: number;
  armor: number;
  energy: number;
  deck: CardData[];
  hand: CardData[];
  discard: CardData[];
}

export interface BattleLogEntry {
  side: BattleSideId | 'system';
  text: string;
}

export interface BattleState {
  deckName: string;
  deckModeName: string;
  difficulty: BattleDifficultyId;
  turn: number;
  phase: 'player' | 'opponent' | 'over';
  player: BattleSideState;
  opponent: BattleSideState;
  winner: BattleSideId | null;
  log: BattleLogEntry[];
  random: BattleRandom;
}

export type BattleRandom = () => number;

function shuffle<T>(items: T[], random: BattleRandom): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

function createSide(cards: CardData[], random: BattleRandom): BattleSideState {
  const deck = shuffle(cards, random);
  const hand = deck.splice(0, BATTLE_START_HAND);
  // 保证起手至少有一张第 1 回合就能打出的牌（费用 2 点）。
  if (!hand.some((card) => card.cost <= battleEnergyForTurn(1))) {
    const affordableIndex = deck.findIndex((card) => card.cost <= battleEnergyForTurn(1));
    if (affordableIndex >= 0) {
      const [affordable] = deck.splice(affordableIndex, 1);
      deck.push(hand[0]);
      hand[0] = affordable;
    }
  }
  return {
    hp: BATTLE_START_HP,
    maxHp: BATTLE_START_HP,
    armor: 0,
    energy: battleEnergyForTurn(1),
    deck,
    hand,
    discard: [],
  };
}

export function createBattle(
  deck: DeckData,
  difficulty: BattleDifficultyId,
  random: BattleRandom = Math.random,
): BattleState {
  const state: BattleState = {
    deckName: deck.name,
    deckModeName: deck.modeId,
    difficulty,
    turn: 1,
    phase: 'player',
    player: createSide(deck.cards, random),
    opponent: createSide(deck.cards, random),
    winner: null,
    log: [],
    random,
  };
  state.log.push({
    side: 'system',
    text: `对战开始：你执「${deck.name}」迎战${BATTLE_OPPONENT_BY_ID[difficulty].name}，先手。`,
  });
  return state;
}

function drawCard(state: BattleState, sideId: BattleSideId): void {
  const side = state[sideId];
  if (side.deck.length === 0) {
    if (side.discard.length === 0) return;
    side.deck = shuffle(side.discard, state.random);
    side.discard = [];
    state.log.push({ side: 'system', text: '牌库见底，弃牌堆已洗回牌库。' });
  }
  const card = side.deck.shift();
  if (!card) return;
  if (side.hand.length >= BATTLE_MAX_HAND) {
    side.discard.push(card);
    state.log.push({
      side: sideId,
      text: `${sideId === 'player' ? '你' : '对手'}手牌已满，抽到的「${card.name}」被弃置。`,
    });
    return;
  }
  side.hand.push(card);
}

function dealDamage(state: BattleState, targetId: BattleSideId, amount: number): number {
  const target = state[targetId];
  const absorbed = Math.min(target.armor, amount);
  target.armor -= absorbed;
  const dealt = amount - absorbed;
  target.hp = Math.max(0, target.hp - dealt);
  if (target.hp <= 0 && state.winner === null) {
    state.winner = targetId === 'player' ? 'opponent' : 'player';
    state.phase = 'over';
  }
  return dealt;
}

export interface PlayCardResult {
  ok: boolean;
  reason?: string;
  card?: CardData;
  damageDealt?: number;
  armorGained?: number;
}

/** 打出一张手牌：扣费、造成攻击伤害、获得等同防御的护甲。 */
export function playCard(
  state: BattleState,
  sideId: BattleSideId,
  cardId: string,
): PlayCardResult {
  if (state.phase === 'over') return { ok: false, reason: '对战已结束。' };
  if (sideId === 'player' && state.phase !== 'player') {
    return { ok: false, reason: '现在不是你的回合。' };
  }
  if (sideId === 'opponent' && state.phase !== 'opponent') {
    return { ok: false, reason: '现在不是对手的回合。' };
  }
  const side = state[sideId];
  const index = side.hand.findIndex((card) => card.id === cardId);
  if (index < 0) return { ok: false, reason: '手牌中没有这张牌。' };
  const card = side.hand[index];
  if (card.cost > side.energy) return { ok: false, reason: `费用不足，需要 ${card.cost} 点。` };
  side.hand.splice(index, 1);
  side.discard.push(card);
  side.energy -= card.cost;
  side.armor += card.defense;
  const otherId: BattleSideId = sideId === 'player' ? 'opponent' : 'player';
  const damageDealt = dealDamage(state, otherId, card.attack);
  const who = sideId === 'player' ? '你' : '对手';
  state.log.push({
    side: sideId,
    text: `${who}打出了「${card.name}」，造成 ${damageDealt} 点伤害，获得 ${card.defense} 点护甲。`,
  });
  return { ok: true, card, damageDealt, armorGained: card.defense };
}

/** 玩家结束回合：随后由对手行动。调用方用 planOpponentPlays 取得对手出牌。 */
export function endPlayerTurn(state: BattleState): boolean {
  if (state.phase !== 'player') return false;
  state.phase = 'opponent';
  return true;
}

/** 对手回合结束：回合数 +1，玩家获得费用并抽牌。 */
export function endOpponentTurn(state: BattleState): boolean {
  if (state.phase !== 'opponent') return false;
  state.turn += 1;
  state.phase = 'player';
  const player = state.player;
  player.armor = 0;
  player.energy = battleEnergyForTurn(state.turn);
  drawCard(state, 'player');
  state.log.push({ side: 'system', text: `第 ${state.turn} 回合：你的费用恢复至 ${player.energy} 点。` });
  return true;
}

function affordable(hand: CardData[], energy: number): CardData[] {
  return hand.filter((card) => card.cost <= energy);
}

function planApprentice(state: BattleState, random: BattleRandom): string[] {
  const plays: string[] = [];
  let energy = state.opponent.energy;
  const hand = [...state.opponent.hand];
  const maxPlays = 2;
  for (let attempt = 0; attempt < maxPlays; attempt += 1) {
    const options = affordable(hand, energy);
    if (options.length === 0) break;
    if (random() < 0.5) break;
    const choice = options[Math.floor(random() * options.length)];
    plays.push(choice.id);
    energy -= choice.cost;
    hand.splice(hand.indexOf(choice), 1);
  }
  return plays;
}

function planCraftsman(state: BattleState): string[] {
  const plays: string[] = [];
  let energy = state.opponent.energy;
  const hand = [...state.opponent.hand];
  const byValue = (a: CardData, b: CardData): number =>
    b.attack / b.cost - a.attack / a.cost || b.attack - a.attack;
  if (state.opponent.hp <= 8) {
    const guard = affordable(hand, energy).sort((a, b) => b.defense - a.defense)[0];
    if (guard) {
      plays.push(guard.id);
      energy -= guard.cost;
      hand.splice(hand.indexOf(guard), 1);
    }
  }
  for (const card of affordable(hand, energy).sort(byValue)) {
    if (card.cost > energy) continue;
    plays.push(card.id);
    energy -= card.cost;
    hand.splice(hand.indexOf(card), 1);
  }
  return plays;
}

function planMaster(state: BattleState): string[] {
  const hand = state.opponent.hand;
  const energy = state.opponent.energy;
  const foe = state.player;
  let best: { ids: string[]; score: number } = { ids: [], score: -1 };
  const count = hand.length;
  for (let mask = 0; mask < 1 << count; mask += 1) {
    let cost = 0;
    let attack = 0;
    let armor = 0;
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      const card = hand[index];
      cost += card.cost;
      attack += card.attack;
      armor += card.defense;
      ids.push(card.id);
    }
    if (cost > energy) continue;
    const effective = Math.max(0, attack - foe.armor);
    const lethal = effective >= foe.hp;
    const score = lethal
      ? 10000 - cost
      : effective * 10 + (state.opponent.hp <= 10 ? armor : 0);
    if (score > best.score) best = { ids, score };
  }
  return best.ids;
}

/** 按难度为对手规划本回合的出牌顺序（只规划，不结算）。 */
export function planOpponentPlays(
  state: BattleState,
  random: BattleRandom = Math.random,
): string[] {
  if (state.phase !== 'opponent') return [];
  switch (state.difficulty) {
    case 'apprentice':
      return planApprentice(state, random);
    case 'craftsman':
      return planCraftsman(state);
    case 'master':
      return planMaster(state);
  }
}

/** 对手回合开始：护甲清零、费用恢复、抽牌。 */
export function startOpponentTurn(state: BattleState): void {
  if (state.phase !== 'opponent') return;
  const opponent = state.opponent;
  opponent.armor = 0;
  opponent.energy = battleEnergyForTurn(state.turn);
  drawCard(state, 'opponent');
}
