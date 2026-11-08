import { buildCardGameplayPresentation } from './card-gameplay-presentation.ts';
import {
  gameplayBindingsForSlot,
  type DeckCompositionPlan,
  type DeckCompositionSlot,
} from './deck-composition.ts';
import type { CardData, CardGameplayBinding, GameplayRuleModule } from './types.ts';

export interface GeneratedCardSemanticFields {
  role: string;
  ability: string;
  attack: number;
  defense: number;
  rarity: CardData['rarity'];
}

export interface CardSlotSemanticProjection {
  rolePrefix: string;
  abilityPrefix: string;
  attack: number;
  defense: number;
  rarity: CardData['rarity'];
  bindings: CardGameplayBinding[];
}

export type CardSlotSemanticIssue =
  | 'role'
  | 'ability'
  | 'attack'
  | 'defense'
  | 'rarity';

export interface CardSlotSemanticValidation {
  valid: boolean;
  issues: CardSlotSemanticIssue[];
  expected: CardSlotSemanticProjection;
}

const RARITIES: CardData['rarity'][] = ['普通', '稀有', '史诗', '传说'];
const CREATIVE_ABILITY_LABEL = '【角色灵感·不参与规则结算】';
const CREATIVE_ABILITY_SEPARATOR = ' · ';
const MAX_CARD_ABILITY_LENGTH = 320;

const EXPRESSION_CATEGORY_SCORE: Record<
  Extract<CardGameplayBinding, { kind: 'expression' }>['targetCategory'],
  number
> = {
  animal: 1,
  object: 2,
  place: 3,
  action: 4,
  emotion: 5,
};

const RISK_ACTION_SCORE: Record<string, number> = {
  skip: 2,
  reverse: 3,
  exchange: 4,
  forecast: 5,
  reorder: 6,
  demand: 7,
  steal: 8,
  attack: 9,
};

function clampStat(value: number): number {
  return Math.max(0, Math.min(99, Math.round(value)));
}

function terminalOrdinal(value: string, fallback: number): number {
  const match = value.trim().match(/(\d+)$/u);
  if (!match) return fallback;
  const ordinal = Number(match[1]);
  return Number.isInteger(ordinal) ? clampStat(ordinal) : fallback;
}

function normalizeCreativeText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function limitCharacters(value: string, maximum: number): string {
  const characters = Array.from(value);
  if (characters.length <= maximum) return value;
  if (maximum <= 1) return characters.slice(0, maximum).join('');
  return `${characters.slice(0, maximum - 1).join('')}…`;
}

function statPairForBinding(
  binding: CardGameplayBinding,
  slot: DeckCompositionSlot,
): readonly [number, number] {
  switch (binding.kind) {
    case 'rapid': {
      const relation = binding.matchRule === 'same-color'
        ? 2
        : binding.matchRule === 'same-category'
          ? 3
          : 1;
      return [binding.symbolIds.length, relation];
    }
    case 'memory':
      return [
        terminalOrdinal(binding.pairId, slot.index + 1),
        binding.pairRole === 'a' ? 1 : 2,
      ];
    case 'quantity':
      return [binding.value, binding.targetTotal ?? 0];
    case 'expression':
      return [
        EXPRESSION_CATEGORY_SCORE[binding.targetCategory],
        terminalOrdinal(binding.targetId, slot.index + 1),
      ];
    case 'risk':
      if (binding.cardKind === 'hazard') {
        return [9, binding.activationRank ?? terminalOrdinal(slot.id, slot.index + 1)];
      }
      if (binding.cardKind === 'rescue') {
        return [1, binding.activationRank ?? terminalOrdinal(slot.id, slot.index + 1)];
      }
      return [
        RISK_ACTION_SCORE[binding.actionKind ?? ''] ?? 5,
        terminalOrdinal(slot.id, slot.index + 1),
      ];
    case 'custom':
      return [1, terminalOrdinal(slot.uniqueKey, slot.index + 1)];
  }
}

function rarityRankForBinding(
  binding: CardGameplayBinding,
  slot: DeckCompositionSlot,
): number {
  switch (binding.kind) {
    case 'rapid': {
      const ordinal = slot.index + 1;
      return ordinal % 16 === 0 ? 3 : ordinal % 8 === 0 ? 2 : ordinal % 4 === 0 ? 1 : 0;
    }
    case 'memory': {
      const pair = terminalOrdinal(binding.pairId, slot.index + 1);
      return pair % 12 === 0 ? 3 : pair % 6 === 0 ? 2 : pair % 3 === 0 ? 1 : 0;
    }
    case 'quantity': {
      const target = Math.max(1, binding.targetTotal ?? binding.value);
      const ratio = binding.value / target;
      return ratio >= 1 ? 3 : ratio >= 0.75 ? 2 : ratio >= 0.4 ? 1 : 0;
    }
    case 'expression':
      return binding.targetCategory === 'emotion'
        ? 2
        : binding.targetCategory === 'action' || binding.targetCategory === 'place'
          ? 1
          : 0;
    case 'risk':
      if (binding.cardKind === 'hazard') return 3;
      if (binding.cardKind === 'rescue') return 2;
      return ['forecast', 'reorder', 'steal'].includes(binding.actionKind ?? '') ? 1 : 0;
    case 'custom': {
      const ordinal = slot.index + 1;
      return ordinal % 16 === 0 ? 3 : ordinal % 8 === 0 ? 2 : ordinal % 4 === 0 ? 1 : 0;
    }
  }
}

function roleHasPrefix(role: string, prefix: string): boolean {
  return role === prefix || role.startsWith(`${prefix} · `);
}

function normalizedAbility(ability: string, abilityPrefix: string): string {
  const creative = normalizeCreativeText(ability);
  if (!creative) return abilityPrefix;
  if (creative === abilityPrefix) return creative;
  const currentCreativePrefix = `${abilityPrefix}${CREATIVE_ABILITY_SEPARATOR}${CREATIVE_ABILITY_LABEL}`;
  const legacyCreativePrefix = `${abilityPrefix} ${CREATIVE_ABILITY_LABEL}`;
  const existingPrefix = creative.startsWith(currentCreativePrefix)
    ? currentCreativePrefix
    : creative.startsWith(legacyCreativePrefix)
      ? legacyCreativePrefix
      : null;
  const withoutRulesPrefix = existingPrefix
    ? creative.slice(existingPrefix.length).trim()
    : creative.startsWith(abilityPrefix)
      ? creative.slice(abilityPrefix.length).trim()
      : creative;
  if (!withoutRulesPrefix) return abilityPrefix;

  const available = MAX_CARD_ABILITY_LENGTH - Array.from(currentCreativePrefix).length;
  if (available <= 0) return limitCharacters(abilityPrefix, MAX_CARD_ABILITY_LENGTH);
  return `${currentCreativePrefix}${limitCharacters(withoutRulesPrefix, available)}`;
}

function abilityHasRequiredShape(ability: string, abilityPrefix: string): boolean {
  const normalized = ability.trim();
  if (normalized === abilityPrefix) return true;
  const creativePrefixes = [
    `${abilityPrefix}${CREATIVE_ABILITY_SEPARATOR}${CREATIVE_ABILITY_LABEL}`,
    `${abilityPrefix}\n${CREATIVE_ABILITY_LABEL}`,
  ];
  return creativePrefixes.some(
    (creativePrefix) => normalized.startsWith(creativePrefix) && normalized.length > creativePrefix.length,
  );
}

/**
 * Compiles the gameplay identity of one generation slot into deterministic card fields.
 * Structured bindings remain authoritative; these visible fields make the same rules legible on-card.
 */
export function compileCardSlotSemantics(
  plan: DeckCompositionPlan,
  slot: DeckCompositionSlot,
  modules: readonly GameplayRuleModule[] = [],
): CardSlotSemanticProjection {
  const bindings = gameplayBindingsForSlot(plan, slot);
  const presentation = buildCardGameplayPresentation({ gameplay: bindings }, modules, 'full');
  const descriptions = presentation.items.map((item) => item.description.trim()).filter(Boolean);
  const statPairs = bindings.map((binding) => statPairForBinding(binding, slot));
  const layerRarityFloor = bindings.length >= 4 ? 3 : bindings.length === 3 ? 2 : bindings.length === 2 ? 1 : 0;
  const rarityRank = Math.max(
    layerRarityFloor,
    ...bindings.map((binding) => rarityRankForBinding(binding, slot)),
  );

  return {
    rolePrefix: slot.role.trim() || '原创玩法牌',
    abilityPrefix: `【玩法印谱】${descriptions.join(' ') || '按创作者定义的槽位规则结算。'}`,
    attack: clampStat(statPairs.reduce((sum, [attack]) => sum + attack, 0)),
    defense: clampStat(statPairs.reduce((sum, [, defense]) => sum + defense, 0)),
    rarity: RARITIES[Math.max(0, Math.min(RARITIES.length - 1, rarityRank))],
    bindings,
  };
}

export function normalizeGeneratedCardForSlot(
  card: GeneratedCardSemanticFields,
  plan: DeckCompositionPlan,
  slot: DeckCompositionSlot,
  modules: readonly GameplayRuleModule[] = [],
): GeneratedCardSemanticFields {
  const expected = compileCardSlotSemantics(plan, slot, modules);
  const creativeRole = normalizeCreativeText(card.role);
  const creativeAbility = card.ability.trim();
  return {
    role: roleHasPrefix(creativeRole, expected.rolePrefix)
      ? creativeRole
      : creativeRole
        ? `${expected.rolePrefix} · ${creativeRole}`
        : expected.rolePrefix,
    ability: normalizedAbility(creativeAbility, expected.abilityPrefix),
    attack: expected.attack,
    defense: expected.defense,
    rarity: expected.rarity,
  };
}

export function validateGeneratedCardForSlot(
  card: GeneratedCardSemanticFields,
  plan: DeckCompositionPlan,
  slot: DeckCompositionSlot,
  modules: readonly GameplayRuleModule[] = [],
): CardSlotSemanticValidation {
  const expected = compileCardSlotSemantics(plan, slot, modules);
  const issues: CardSlotSemanticIssue[] = [];
  if (!roleHasPrefix(normalizeCreativeText(card.role), expected.rolePrefix)) issues.push('role');
  if (!abilityHasRequiredShape(card.ability, expected.abilityPrefix)) issues.push('ability');
  if (card.attack !== expected.attack) issues.push('attack');
  if (card.defense !== expected.defense) issues.push('defense');
  if (card.rarity !== expected.rarity) issues.push('rarity');
  return { valid: issues.length === 0, issues, expected };
}
