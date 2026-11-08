import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createStarterDeck } from '../src/data.ts';
import { applyAuthorToEntireDeck } from '../src/services/deck-authorship.ts';

test('one action updates deck, cards, inscriptions, and creator plaque authorship', () => {
  const source = createStarterDeck('strategy');
  source.creatorPlaque = {
    displayName: '旧作者',
    studioName: '星云工坊',
    dedication: '保留题献',
  };
  source.cards[0].inscriptionPlacement = 'back';

  const updated = applyAuthorToEntireDeck(source, '  流云少年  ');
  assert.equal(updated.author, '流云少年');
  assert.ok(updated.cards.every((card) => card.author === '流云少年'));
  assert.ok(updated.cards.every((card) => card.inscriptionText === '流云少年'));
  assert.equal(updated.cards[0].inscriptionPlacement, 'back');
  assert.equal(updated.creatorPlaque?.displayName, '流云少年');
  assert.equal(updated.creatorPlaque?.signatureText, '流云少年');
  assert.equal(updated.creatorPlaque?.studioName, '星云工坊');
  assert.equal(updated.creatorPlaque?.dedication, '保留题献');
  assert.notEqual(updated, source);
});

test('project files are packaged in the frontend with independent card assets and library entry points', () => {
  const project = readFileSync(new URL('../src/services/deck-project.ts', import.meta.url), 'utf8');
  const library = readFileSync(new URL('../src/scenes/library.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');

  assert.match(project, /PROJECT_FORMAT_VERSION = 2/u);
  assert.match(project, /assets\/cards\//u);
  assert.match(project, /project\.json/u);
  assert.match(project, /deck: packagedDeck/u);
  assert.match(project, /showSaveFilePicker/u);
  assert.match(project, /@tauri-apps\/api\/core/u);
  assert.match(project, /save_deck_project_file/u);
  assert.match(project, /open_deck_project_file/u);
  assert.match(library, /将当前套牌另存为单文件工程/u);
  assert.match(library, /从本机导入套牌工程/u);
  assert.match(app, /exportDeckProject\(deck\)/u);
  assert.match(app, /importDeckProject\(\)/u);
});
