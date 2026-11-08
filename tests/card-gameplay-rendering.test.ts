import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cardViewSource = readFileSync(
  new URL('../src/card-view.ts', import.meta.url),
  'utf8',
);

test('keeps gameplay foundations under foil and gameplay ink above animated glints', () => {
  const surfaceStart = cardViewSource.indexOf('this.surface.addChild(');
  const surfaceEnd = cardViewSource.indexOf(');', surfaceStart);
  const surface = cardViewSource.slice(surfaceStart, surfaceEnd);

  const infoPanel = surface.indexOf('this.infoPanel');
  const foundation = surface.indexOf('this.gameplayFoundation');
  const surfaceGrain = surface.indexOf('this.surfaceGrain');
  const edgeGlints = surface.indexOf('this.edgeGlints');
  const ink = surface.indexOf('this.gameplayInk');
  const infoText = surface.indexOf('this.infoTextContent');

  assert.ok(infoPanel >= 0 && infoPanel < foundation);
  assert.ok(foundation < surfaceGrain);
  assert.ok(edgeGlints >= 0 && edgeGlints < ink);
  assert.ok(ink < infoText);
});

test('draws gameplay only on data, size, style, or context changes', () => {
  const drawStart = cardViewSource.indexOf('private drawGameplayMarks(): void');
  const drawEnd = cardViewSource.indexOf('private drawFoil(): void', drawStart);
  const drawMethod = cardViewSource.slice(drawStart, drawEnd);

  assert.match(cardViewSource, /public setGameplayContext\(/u);
  assert.match(cardViewSource, /this\.drawInformationPanel\(\);\s*this\.drawGameplayMarks\(\);\s*this\.drawFoil\(\);/u);
  assert.match(drawMethod, /buildCardGameplayPresentation/u);
  assert.match(drawMethod, /presentation\.rapidSymbols\.slice\(0, 6\)/u);
  assert.match(drawMethod, /presentation\.items\.slice\(0, 4\)/u);
  assert.doesNotMatch(drawMethod, /new Text(?:\s|\()/u);
  assert.doesNotMatch(drawMethod, /Ticker/u);
});

test('passes rule-module context in every deck card scene', () => {
  for (const path of [
    '../src/scenes/studio.ts',
    '../src/scenes/showcase.ts',
    '../src/scenes/library.ts',
    '../src/scenes/exchange.ts',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /\.setGameplayContext\(/u, `${path} must provide gameplay context`);
  }
});

test('adds full gameplay relationships to the hover and long-press popover', () => {
  const popoverStart = cardViewSource.indexOf('private drawAbilityPopover(): void');
  const popoverEnd = cardViewSource.indexOf('private showAbilityPopover(', popoverStart);
  const popover = cardViewSource.slice(popoverStart, popoverEnd);

  assert.match(popover, /buildCardGameplayPresentation\([\s\S]*?'full'/u);
  assert.match(popover, /item\.relation \?\? item\.description/u);
  assert.match(popover, /玩法与能力/u);
});
