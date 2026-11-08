import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');

const inputStart = uiSource.indexOf('export class CanvasInput');
const inputEnd = uiSource.indexOf('export interface CanvasSliderOptions', inputStart);
const canvasInputSource = uiSource.slice(inputStart, inputEnd);

test('uses separate inert DOM bridges for single-line and multiline canvas input', () => {
  assert.match(indexSource, /<input[\s\S]*?id="ime-input-bridge"[\s\S]*?aria-hidden="true"/u);
  assert.match(indexSource, /<textarea[\s\S]*?id="ime-bridge"[\s\S]*?aria-hidden="true"/u);
  assert.match(indexSource, /id="ime-input-bridge"[\s\S]*?tabindex="-1"/u);
  assert.match(indexSource, /id="ime-bridge"[\s\S]*?tabindex="-1"/u);
  assert.match(styleSource, /#ime-input-bridge,\s*#ime-bridge\s*\{/u);
  const bridgeStyles = styleSource.slice(
    styleSource.indexOf('#ime-input-bridge'),
    styleSource.indexOf('#ime-bridge {\n  resize', styleSource.indexOf('#ime-input-bridge')),
  );
  assert.doesNotMatch(bridgeStyles, /display:\s*none/u);
  assert.doesNotMatch(bridgeStyles, /visibility:\s*hidden/u);
});

test('selects a native input bridge for single-line fields and a textarea for multiline fields', () => {
  assert.match(
    canvasInputSource,
    /this\.multiline\s*\? document\.querySelector<HTMLTextAreaElement>\('#ime-bridge'\)[\s\S]*?: document\.querySelector<HTMLInputElement>\('#ime-input-bridge'\)/u,
  );
  assert.match(canvasInputSource, /private bridge\?: HTMLInputElement \| HTMLTextAreaElement/u);
});

test('protects secure values while focused and removes them from the DOM when focus ends', () => {
  assert.match(
    canvasInputSource,
    /bridge\.type = this\.secure && !this\.revealSecure \? 'password' : 'text'/u,
  );
  assert.match(canvasInputSource, /bridge\.autocomplete = this\.secure \? 'new-password' : 'off'/u);
  assert.match(canvasInputSource, /bridge\.removeAttribute\('aria-hidden'\)/u);

  const disconnectStart = canvasInputSource.indexOf('private disconnectBridge');
  const finishFocusStart = canvasInputSource.indexOf('private finishFocus', disconnectStart);
  const disconnectSource = canvasInputSource.slice(disconnectStart, finishFocusStart);
  assert.match(disconnectSource, /bridge\.value = ''/u);
  assert.match(disconnectSource, /bridge\.setAttribute\('aria-hidden', 'true'\)/u);
  assert.match(disconnectSource, /bridge\.autocomplete = 'off'/u);
  assert.match(disconnectSource, /bridge\.type = 'text'/u);

  const revealStart = canvasInputSource.indexOf('setSecureReveal');
  const revealEnd = canvasInputSource.indexOf('setLabel', revealStart);
  assert.match(
    canvasInputSource.slice(revealStart, revealEnd),
    /this\.bridge\.type = this\.secure && !this\.revealSecure \? 'password' : 'text'/u,
  );
});
