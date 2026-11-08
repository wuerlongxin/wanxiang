import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_GAMEPLAY_MODULE_SEALS,
  RAPID_SYMBOL_GLYPHS,
  buildCardGameplayPresentation,
  resolveGameplayDisplayTier,
  resolveRapidSymbolGlyph,
} from '../src/card-gameplay-presentation.ts';
import type { CardGameplayBinding, GameplayRuleModule } from '../src/types.ts';

function gameplayModule(
  id: string,
  overrides: Partial<GameplayRuleModule> = {},
): GameplayRuleModule {
  return {
    id,
    source: 'custom',
    name: `玩法 ${id}`,
    summary: '',
    glyph: '创',
    accentHex: '#c84f3d',
    tags: [],
    enabled: true,
    parameters: [],
    content: { objective: [], setup: [], flow: [], victory: [], variants: [] },
    ...overrides,
  };
}

function present(
  gameplay: CardGameplayBinding[],
  modules: GameplayRuleModule[] = [],
  tierOrWidth: 'thumbnail' | 'standard' | 'full' | number = 'full',
) {
  return buildCardGameplayPresentation({ gameplay }, modules, tierOrWidth);
}

test('display tiers switch exactly at 96 and 180 logical pixels', () => {
  assert.equal(resolveGameplayDisplayTier(-1), 'thumbnail');
  assert.equal(resolveGameplayDisplayTier(95.999), 'thumbnail');
  assert.equal(resolveGameplayDisplayTier(96), 'standard');
  assert.equal(resolveGameplayDisplayTier(179.999), 'standard');
  assert.equal(resolveGameplayDisplayTier(180), 'full');

  const binding: CardGameplayBinding = {
    kind: 'memory',
    pairId: 'pair-01',
    pairRole: 'a',
  };
  const thumbnail = present([binding], [], 95);
  const standard = present([binding], [], 96);
  const full = present([binding], [], 180);
  assert.equal(thumbnail.tier, 'thumbnail');
  assert.equal(thumbnail.items[0].primary, '');
  assert.equal(standard.items[0].primary, '配01·A契');
  assert.equal(standard.items[0].secondary, '');
  assert.equal(full.items[0].primary, '配 01 · A 半契');
  assert.match(full.items[0].secondary, /B 半契/u);
});

test('all 31 rapid symbols have a stable eastern glyph for plain and module-prefixed IDs', () => {
  const symbolIds = RAPID_SYMBOL_GLYPHS.map((_, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    if (index % 3 === 0) return `symbol-${ordinal}`;
    if (index % 3 === 1) return `rapid-module:symbol-${ordinal}`;
    return `rapid-module:s${ordinal}`;
  });
  const presentation = present([{
    kind: 'rapid',
    moduleId: 'rapid-module',
    symbolIds,
    matchRule: 'same-symbol',
  }]);

  assert.deepEqual(presentation.rapidSymbols.map((symbol) => symbol.glyph), [...RAPID_SYMBOL_GLYPHS]);
  assert.deepEqual(
    presentation.rapidSymbols.map((symbol) => symbol.canonicalId),
    RAPID_SYMBOL_GLYPHS.map((_, index) => `symbol-${String(index + 1).padStart(2, '0')}`),
  );
  assert.equal(presentation.rapidSymbols[0].id, 'symbol-01');
  assert.equal(presentation.rapidSymbols[30].label, '31 · 轮');
  assert.equal(resolveRapidSymbolGlyph('another-module:symbol-16'), '龙');
  assert.equal(resolveRapidSymbolGlyph('symbol-99'), '纹');
});

test('rapid presentation keeps all symbols at thumbnail scale and describes the match rule', () => {
  const presentation = present([{
    kind: 'rapid',
    symbolIds: ['symbol-01', 'symbol-02', 'symbol-03', 'symbol-04', 'symbol-05', 'symbol-06'],
    matchRule: 'same-color',
  }], [], 'thumbnail');
  assert.equal(presentation.rapidSymbols.length, 6);
  assert.ok(presentation.rapidSymbols.every((symbol) => symbol.label === ''));
  assert.deepEqual(presentation.rapidSymbols.map((symbol) => symbol.glyph), ['日', '月', '星', '云', '山', '水']);
  assert.equal(presentation.items[0].mark, '纹');
  assert.equal(presentation.items[0].relation, '唯一同色');
});

test('memory presentation exposes pair number, complementary half-seal and faction', () => {
  const presentation = present([{
    kind: 'memory',
    moduleId: 'memory-module',
    pairId: 'memory-module:p07',
    pairRole: 'b',
    factionId: 'team:red',
  }]);
  const item = presentation.items[0];
  assert.equal(item.mark, '◑');
  assert.equal(item.primary, '配 07 · B 半契');
  assert.equal(item.secondary, '与配 07 · A 半契相合；red阵营');
  assert.match(item.description, /配对 07.*B 半契.*A 半契/u);
});

test('quantity presentation shows category, value and each target relationship', () => {
  const relations = [
    ['exact', '同类总量恰好 5'],
    ['at-least', '同类总量至少 5'],
    ['two-types', '两类合计 5'],
  ] as const;
  for (const [triggerRelation, expected] of relations) {
    const presentation = present([{
      kind: 'quantity',
      categoryId: 'quantity-module:c2',
      value: 3,
      targetTotal: 5,
      triggerRelation,
    }]);
    assert.equal(presentation.items[0].mark, '3');
    assert.equal(presentation.items[0].primary, '二类 · 数值 3');
    assert.equal(presentation.items[0].secondary, expected);
    assert.equal(presentation.items[0].relation, expected);
  }
});

test('expression presentation maps all five categories to 生器境行情 and keeps the target number', () => {
  const categories = ['animal', 'object', 'place', 'action', 'emotion'] as const;
  const bindings: CardGameplayBinding[] = categories.map((targetCategory, index) => ({
    kind: 'expression',
    targetId: `expression-module:t${String(index + 1).padStart(2, '0')}`,
    targetCategory,
  }));
  const presentation = present(bindings, [], 'standard');
  assert.deepEqual(presentation.items.map((item) => item.mark), ['生', '器', '境', '行', '情']);
  assert.deepEqual(presentation.items.map((item) => item.primary), ['生01', '器02', '境03', '行04', '情05']);
  assert.match(presentation.items[4].description, /情绪与概念.*05/u);
});

test('risk presentation maps hazard, rescue, eight actions and unknown actions', () => {
  const bindings: CardGameplayBinding[] = [
    { kind: 'risk', cardKind: 'hazard', activationRank: 2 },
    { kind: 'risk', cardKind: 'rescue', activationRank: 3 },
    ...['skip', 'reverse', 'attack', 'forecast', 'reorder', 'steal', 'exchange', 'demand'].map(
      (actionKind): CardGameplayBinding => ({ kind: 'risk', cardKind: 'action', actionKind }),
    ),
    { kind: 'risk', cardKind: 'action', actionKind: 'invented' },
  ];
  const presentation = present(bindings);
  assert.deepEqual(presentation.items.map((item) => item.mark), [
    '危', '护', '跳', '转', '追', '观', '序', '取', '易', '索', '令',
  ]);
  assert.equal(presentation.items[0].primary, '危机 · 序 02');
  assert.equal(presentation.items[1].primary, '护航 · 序 03');
  assert.equal(presentation.items[9].primary, '索 · 索要');
  assert.equal(presentation.items[10].primary, '令 · 通用指令');
});

test('custom presentation compacts deck-role labels without losing their ordinal', () => {
  const standard = present([{
    kind: 'custom',
    moduleId: 'maker',
    slotRole: '行动牌：12',
  }], [], 'standard').items[0];
  const full = present([{
    kind: 'custom',
    moduleId: 'maker',
    slotRole: '行动牌 12',
  }], [], 'full').items[0];
  assert.equal(standard.mark, '行');
  assert.equal(standard.primary, '行动12');
  assert.equal(full.primary, '行动 12');
  assert.match(full.description, /行动牌 12/u);
});

test('module context is sanitized, unknown modules fall back, and seals cap at four', () => {
  const bindings: CardGameplayBinding[] = [
    { kind: 'rapid', moduleId: 'm1', symbolIds: ['m1:s01'] },
    { kind: 'memory', moduleId: 'm2', pairId: 'm2:p01', pairRole: 'a' },
    { kind: 'quantity', moduleId: 'm3', categoryId: 'm3:c1', value: 1 },
    { kind: 'expression', moduleId: 'm4', targetId: 'm4:t01', targetCategory: 'animal' },
    { kind: 'risk', moduleId: 'm5', cardKind: 'action', actionKind: 'skip' },
  ];
  const modules = [
    gameplayModule('m1', { name: '玄纹试炼', glyph: '玄妙', accentHex: '#123abc' }),
    gameplayModule('m2', { name: ' ', glyph: ' ', accentHex: 'blue' }),
    gameplayModule('m3'),
    gameplayModule('m4'),
    gameplayModule('m5'),
  ];
  const presentation = present(bindings, modules);
  assert.equal(presentation.items[0].moduleName, '玄纹试炼');
  assert.equal(presentation.items[0].moduleGlyph, '玄');
  assert.equal(presentation.items[0].accentHex, '#123abc');
  assert.equal(presentation.items[1].moduleName, '伏光记阵');
  assert.equal(presentation.items[1].moduleGlyph, '忆');
  assert.equal(presentation.items[1].accentHex, '#4aaec8');
  assert.equal(presentation.seals.length, MAX_GAMEPLAY_MODULE_SEALS);
  assert.deepEqual(presentation.seals.map((seal) => seal.moduleId), ['m1', 'm2', 'm3', 'm4']);
  assert.equal(presentation.overflowCount, 1);
  assert.equal(presentation.items.length, 5, 'seal overflow must not discard gameplay identities');
});

test('missing gameplay produces a stable empty presentation', () => {
  assert.deepEqual(buildCardGameplayPresentation({}, [], 'full'), {
    tier: 'full',
    rapidSymbols: [],
    items: [],
    seals: [],
    overflowCount: 0,
  });
});
