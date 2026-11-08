import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hintSource = readFileSync(
  new URL('../src/interaction-hints.ts', import.meta.url),
  'utf8',
);
const uiSource = readFileSync(
  new URL('../src/ui.ts', import.meta.url),
  'utf8',
);
const studioSource = readFileSync(
  new URL('../src/scenes/studio.ts', import.meta.url),
  'utf8',
);
const lobbySource = readFileSync(
  new URL('../src/scenes/lobby.ts', import.meta.url),
  'utf8',
);
const librarySource = readFileSync(
  new URL('../src/scenes/library.ts', import.meta.url),
  'utf8',
);
const ruleBuilderSource = readFileSync(
  new URL('../src/scenes/rule-builder.ts', import.meta.url),
  'utf8',
);
const showcaseSource = readFileSync(
  new URL('../src/scenes/showcase.ts', import.meta.url),
  'utf8',
);
const exchangeSource = readFileSync(
  new URL('../src/scenes/exchange.ts', import.meta.url),
  'utf8',
);
const chromeSource = readFileSync(
  new URL('../src/chrome.ts', import.meta.url),
  'utf8',
);

test('keeps the deepest actionable target hint when pointer events bubble', () => {
  assert.match(hintSource, /isAncestorOf\(owner, this\.owner\)/u);
  assert.match(hintSource, /if \(this\.owner && this\.owner !== owner[^\n]+\) return/u);
});

test('clears stale hit hints whenever responsive layout changes', () => {
  const layoutStart = hintSource.indexOf('layout(width: number, height: number)');
  const showStart = hintSource.indexOf('show(owner:', layoutStart);
  const layoutSource = hintSource.slice(layoutStart, showStart);

  assert.match(layoutSource, /if \(this\.visible\) this\.hide\(\)/u);
  assert.doesNotMatch(layoutSource, /this\.place\(\)/u);
});

test('keeps every disabled base control hit-testable with a not-allowed cursor', () => {
  const buttonStart = uiSource.indexOf('export class CanvasButton');
  const segmentedStart = uiSource.indexOf('export class SegmentedControl');
  const inputStart = uiSource.indexOf('export class CanvasInput');
  const sliderStart = uiSource.indexOf('export class CanvasSlider');
  const toggleStart = uiSource.indexOf('export class Toggle');
  const toastStart = uiSource.indexOf('export type ToastKind');

  const controls = [
    uiSource.slice(buttonStart, segmentedStart),
    uiSource.slice(segmentedStart, inputStart),
    uiSource.slice(inputStart, sliderStart),
    uiSource.slice(sliderStart, toggleStart),
    uiSource.slice(toggleStart, toastStart),
  ];

  for (const source of controls) {
    assert.match(source, /eventMode = 'static'/u);
    assert.match(source, /not-allowed/u);
    assert.match(source, /暂不可用/u);
    assert.doesNotMatch(source, /eventMode = this\.disabled \? 'none'/u);
  }
});

test('preserves the pointer cursor on actionable studio card thumbnails', () => {
  const stripStart = studioSource.indexOf('private rebuildStrip');
  const detailStart = studioSource.indexOf('private detailMeta', stripStart);
  const stripSource = studioSource.slice(stripStart, detailStart);
  const layoutStart = studioSource.indexOf('private layoutDeckStrip');
  const layoutEnd = studioSource.indexOf('private layoutPreviewTag', layoutStart);
  const layoutSource = studioSource.slice(layoutStart, layoutEnd);

  assert.match(stripSource, /card\.setInteractiveTilt\(false\)[\s\S]*card\.cursor = 'pointer'/u);
  assert.doesNotMatch(layoutSource, /card\.setInteractiveTilt\(false\)/u);
  assert.match(stripSource, /attachInteractionHint\(card/u);
});

test('wires contextual hit hints into every shared Canvas control', () => {
  const buttonStart = uiSource.indexOf('export class CanvasButton');
  const segmentedStart = uiSource.indexOf('export class SegmentedControl');
  const inputStart = uiSource.indexOf('export class CanvasInput');
  const sliderStart = uiSource.indexOf('export class CanvasSlider');
  const toggleStart = uiSource.indexOf('export class Toggle');
  const toastStart = uiSource.indexOf('export type ToastKind');

  const controls = [
    uiSource.slice(buttonStart, segmentedStart),
    uiSource.slice(segmentedStart, inputStart),
    uiSource.slice(inputStart, sliderStart),
    uiSource.slice(sliderStart, toggleStart),
    uiSource.slice(toggleStart, toastStart),
  ];

  for (const source of controls) {
    assert.match(source, /attachInteractionHint\(/u);
  }
  assert.match(uiSource.slice(buttonStart, segmentedStart), /this\.tooltip \|\| this\.semanticLabel/u);
  assert.match(uiSource.slice(buttonStart, segmentedStart), /if \(label\.trim\(\)\) this\.semanticLabel/u);
  assert.match(uiSource.slice(inputStart, sliderStart), /编辑\$\{this\.fieldLabel/u);
  assert.match(uiSource.slice(sliderStart, toggleStart), /调整\$\{this\.sliderLabel/u);
  assert.match(uiSource.slice(toggleStart, toastStart), /this\.toggleTooltip \|\| `切换/u);
});

test('keeps bespoke hit areas stable and releases scene-owned hint targets', () => {
  assert.match(studioSource, /this\.hitArea = new Rectangle\(0, 0, width, height\)/u);
  assert.match(studioSource, /this\.previewTag\.hitArea = new Rectangle\(0, 0, 90, 26\)/u);
  assert.match(librarySource, /override destroy[\s\S]*?super\.destroy\(options \?\? \{ children: true \}\)/u);
});

test('covers bespoke scene hit targets with explicit interaction hints', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['lobby repository plaque', lobbySource, /class RepositoryCopyrightPlaque[\s\S]*?attachInteractionHint\(this/u],
    ['lobby gameplay cards', lobbySource, /card\.on\('pointertap'[\s\S]*?attachInteractionHint\(card/u],
    ['top bar home target', chromeSource, /this\.homeHit\.on\('pointertap'[\s\S]*?attachInteractionHint\([\s\S]*?this\.homeHit/u],
    ['studio style sample', studioSource, /this\.styleSample\.on\('pointertap'[\s\S]*?attachInteractionHint\([\s\S]*?this\.styleSample/u],
    ['studio preview card', studioSource, /attachInteractionHint\([\s\S]*?this\.previewCard[\s\S]*?this\.previewCard\.isFlipped/u],
    ['studio preview flip tag', studioSource, /this\.previewTag\.on\('pointertap'[\s\S]*?attachInteractionHint\([\s\S]*?this\.previewTag/u],
    ['library selectable rows', librarySource, /root\.on\('pointertap'[\s\S]*?attachInteractionHint\(root/u],
    ['library preview card', librarySource, /attachInteractionHint\([\s\S]*?this\.previewCard[\s\S]*?this\.previewCard\.isFlipped/u],
    ['rule template rows', ruleBuilderSource, /this\.addTemplateModule\(mechanicId\)[\s\S]*?attachInteractionHint\(root/u],
    ['rule combination rows', ruleBuilderSource, /this\.applyCombo\(combo\.id\)[\s\S]*?attachInteractionHint\(root/u],
    ['exchange preview card', exchangeSource, /attachInteractionHint\([\s\S]*?this\.deckCard[\s\S]*?this\.deckCard\.isFlipped/u],
    ['showcase draggable cards', showcaseSource, /piece\.on\('pointerdown'[\s\S]*?attachInteractionHint\(piece/u],
    ['toast dismiss control', uiSource, /close\.eventMode = 'static'[\s\S]*?attachInteractionHint\(close/u],
  ];

  for (const [name, source, pattern] of cases) {
    assert.match(source, pattern, name);
  }
});
