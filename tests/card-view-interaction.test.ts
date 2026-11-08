import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cardViewSource = readFileSync(
  new URL('../src/card-view.ts', import.meta.url),
  'utf8',
);
const studioSource = readFileSync(
  new URL('../src/scenes/studio.ts', import.meta.url),
  'utf8',
);
const showcaseSource = readFileSync(
  new URL('../src/scenes/showcase.ts', import.meta.url),
  'utf8',
);
const lobbySource = readFileSync(
  new URL('../src/scenes/lobby.ts', import.meta.url),
  'utf8',
);

test('keeps the physical back visible and renders an explicitly back-placed creator mark', () => {
  const backStart = cardViewSource.indexOf('private drawBack(): void');
  const faceTextStart = cardViewSource.indexOf('private layoutText(): void', backStart);
  const backRenderer = cardViewSource.slice(backStart, faceTextStart);

  assert.ok(backStart >= 0 && faceTextStart > backStart);
  assert.match(backRenderer, /backPatternBase/u);
  assert.match(backRenderer, /backPattern\.visible = true/u);
  assert.doesNotMatch(backRenderer, /this\.data\.skill/u);
  assert.match(backRenderer, /this\.data\.inscriptionPlacement === 'back'/u);
  assert.match(backRenderer, /this\.backCreatorText/u);
  assert.match(backRenderer, /this\.data\.inscriptionText/u);
  assert.ok(
    cardViewSource.indexOf('this.backSheen,') < cardViewSource.indexOf('this.backPatternBase,'),
    'the shared pattern should render above the full-card foil wash',
  );
  assert.match(cardViewSource, /this\.backEffects\.mask = this\.backMask/u);
  assert.doesNotMatch(
    cardViewSource,
    /this\.backSurface\.mask = this\.backMask/u,
    'an initially hidden full-surface stencil can lose the entire back after a WebGL flip',
  );
});

test('keeps face and back creator marks mutually exclusive and follows author edits', () => {
  assert.match(cardViewSource, /authorOnFront = this\.data\.inscriptionPlacement !== 'back'/u);
  assert.match(studioSource, /previousInscription === previousAuthor/u);
  assert.match(studioSource, /\? \{ inscriptionText: author \}/u);
});

test('shows full ability details by mouse hover and a tap-safe touch long press', () => {
  assert.match(cardViewSource, /private abilityPopoverEnabled = false/u);
  assert.match(cardViewSource, /event\.pointerType === 'mouse'\) this\.showAbilityPopover\(false\)/u);
  assert.match(cardViewSource, /CARD_ABILITY_LONG_PRESS_MS/u);
  assert.match(cardViewSource, /this\.suppressNextTap = true/u);
  assert.match(cardViewSource, /if \(this\.suppressNextTap\)/u);
  assert.match(cardViewSource, /this\.data\.skill/u);
});

test('enables the popover only for the studio preview and selected showcase card', () => {
  assert.match(studioSource, /\.setAbilityPopoverEnabled\(true\)/u);
  assert.match(showcaseSource, /this\.card\.setAbilityPopoverEnabled\(selected\)/u);
  assert.doesNotMatch(lobbySource, /setAbilityPopoverEnabled/u);
});
