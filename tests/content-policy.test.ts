import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

import {
  FAN_STUDY_DISCLAIMER,
  FAN_STUDY_EXPORT_MARK,
  FAN_STUDY_TERMS_VERSION,
  DeckExportPolicyError,
  assertDeckExportAllowed,
  canExchangeDeck,
  canExportDeck,
  createFanStudyDeckContentPolicy,
  createOriginalDeckContentPolicy,
  getExportMark,
  requireExplicitDeckContentPolicy,
  resolveDeckCreationMode,
  validateDeckExportPolicy,
} from '../src/services/content-policy.ts';
import type * as StorageService from '../src/services/storage.ts';
import type { DeckData } from '../src/types.ts';

const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: { middlewareMode: true },
});
after(() => vite.close());

const { normalizeDeckLibrary } = await vite.ssrLoadModule(
  '/src/services/storage.ts',
) as typeof StorageService;

const ACCEPTED_AT = 1_800_000_000_000;
const studioSource = readFileSync(
  new URL('../src/scenes/studio.ts', import.meta.url),
  'utf8',
);

function deck(contentPolicy?: DeckData['contentPolicy']): DeckData {
  return {
    id: 'legal-policy-deck',
    theme: '云海机关城',
    name: '云海守卫',
    modeId: 'strategy',
    story: '少年工匠守护云海中的机关城。',
    rules: '部署卡牌并完成机关任务。',
    cards: [{
      id: 'legal-policy-card',
      name: '铜翼守卫',
      title: '云海先锋',
      modeId: 'strategy',
      artUrl: '/assets/cards/strategy.jpg',
      attack: 5,
      defense: 6,
      cost: 3,
      skill: '入场时获得一点护盾。',
      flavor: '齿轮转动，风暴止息。',
      rarity: '稀有',
      author: '南星',
    }],
    author: '南星',
    ...(contentPolicy ? { contentPolicy } : {}),
  };
}

test('legacy and new decks default to original mode and can export', () => {
  const legacyDeck = deck();
  assert.equal(resolveDeckCreationMode(legacyDeck), 'original');
  assert.deepEqual(validateDeckExportPolicy(legacyDeck), {
    allowed: true,
    mode: 'original',
    exportMark: null,
    disclaimer: null,
  });
});

test('requires an explicit creation policy before an AI action', () => {
  let policyRequests = 0;
  const openPolicy = (): void => {
    policyRequests += 1;
  };

  assert.equal(requireExplicitDeckContentPolicy(deck(), openPolicy), false);
  assert.equal(policyRequests, 1);

  assert.equal(
    requireExplicitDeckContentPolicy(deck(createOriginalDeckContentPolicy()), openPolicy),
    true,
  );
  assert.equal(
    requireExplicitDeckContentPolicy(deck(createFanStudyDeckContentPolicy({
      materialsRightsConfirmed: true,
      personalNonCommercialConfirmed: true,
      unofficialAndUnaffiliatedConfirmed: true,
      guardianJointlyConfirmed: true,
    }, ACCEPTED_AT)), openPolicy),
    true,
  );

  assert.equal(
    requireExplicitDeckContentPolicy(deck(createFanStudyDeckContentPolicy({
      materialsRightsConfirmed: true,
    }, ACCEPTED_AT)), openPolicy),
    false,
  );
  assert.equal(
    requireExplicitDeckContentPolicy(deck(createFanStudyDeckContentPolicy({
      materialsRightsConfirmed: true,
      personalNonCommercialConfirmed: true,
      unofficialAndUnaffiliatedConfirmed: true,
      guardianJointlyConfirmed: true,
    }, ACCEPTED_AT, '0.9')), openPolicy),
    false,
  );
  const invalidAcceptance = {
    schemaVersion: 1,
    mode: 'fan-study',
    agreement: {
      termsVersion: FAN_STUDY_TERMS_VERSION,
      acceptedAt: null,
      confirmations: {
        materialsRightsConfirmed: true,
        personalNonCommercialConfirmed: true,
        unofficialAndUnaffiliatedConfirmed: true,
        guardianJointlyConfirmed: true,
      },
    },
  } as DeckData['contentPolicy'];
  assert.equal(
    requireExplicitDeckContentPolicy(deck(invalidAcceptance), openPolicy),
    false,
  );
  assert.equal(policyRequests, 4);
});

test('studio local generation runs without an AI gate and keeps the selected policy', () => {
  const generateStart = studioSource.indexOf('private async generate()');
  const tickStart = studioSource.indexOf('private tick =', generateStart);
  const redrawStart = studioSource.indexOf('private async regenerateCurrentArtwork(');
  const generateSource = studioSource.slice(generateStart, tickStart);
  const redrawSource = studioSource.slice(redrawStart, generateStart);

  assert.ok(generateStart >= 0 && redrawStart >= 0 && tickStart > generateStart);
  for (const [label, actionSource] of [
    ['single-card redraw', redrawSource],
    ['full-deck generation', generateSource],
  ] as const) {
    assert.doesNotMatch(actionSource, /requireExplicitContentPolicyBeforeAi/u, label);
    assert.doesNotMatch(actionSource, /AI 正在/u, label);
  }
  assert.match(redrawSource, /requestRegeneratedArtwork/u);
  assert.match(generateSource, /requestGeneratedDeck/u);
  assert.match(
    generateSource,
    /\.\.\.\(this\.deck\.contentPolicy \? \{ contentPolicy: this\.deck\.contentPolicy \} : \{\}\)/u,
  );
});


test('persists an incomplete fan-study agreement but blocks export', () => {
  const fanStudyDeck = deck(createFanStudyDeckContentPolicy({
    materialsRightsConfirmed: true,
  }, ACCEPTED_AT));
  const normalized = normalizeDeckLibrary({
    schemaVersion: 1,
    activeDeckId: fanStudyDeck.id,
    activeDeckCid: null,
    activeDeckRevision: null,
    decks: [fanStudyDeck],
  });

  assert.equal(normalized.decks[0].contentPolicy?.mode, 'fan-study');
  assert.equal(canExchangeDeck(normalized.decks[0]), false);
  assert.equal(canExportDeck(normalized.decks[0]), false);
  const result = validateDeckExportPolicy(normalized.decks[0]);
  assert.equal(result.allowed, false);
  if (result.allowed) return;
  assert.equal(result.code, 'FAN_STUDY_CONFIRMATIONS_REQUIRED');
  assert.deepEqual(result.missingConfirmations, [
    'personalNonCommercialConfirmed',
    'unofficialAndUnaffiliatedConfirmed',
    'guardianJointlyConfirmed',
  ]);
  assert.throws(
    () => assertDeckExportAllowed(normalized.decks[0]),
    (error) => error instanceof DeckExportPolicyError &&
      error.code === 'FAN_STUDY_CONFIRMATIONS_REQUIRED',
  );
});

test('allows a fully acknowledged current agreement and supplies print notices', () => {
  const policy = createFanStudyDeckContentPolicy({
    materialsRightsConfirmed: true,
    personalNonCommercialConfirmed: true,
    unofficialAndUnaffiliatedConfirmed: true,
    guardianJointlyConfirmed: true,
  }, ACCEPTED_AT);
  const result = assertDeckExportAllowed(deck(policy));

  assert.equal(policy.agreement.termsVersion, FAN_STUDY_TERMS_VERSION);
  assert.equal(policy.agreement.acceptedAt, ACCEPTED_AT);
  assert.equal(result.exportMark, FAN_STUDY_EXPORT_MARK);
  assert.equal(getExportMark(deck(policy)), FAN_STUDY_EXPORT_MARK);
  assert.equal(canExportDeck(deck(policy)), true);
  assert.equal(canExchangeDeck(deck(policy)), false);
  assert.equal(result.disclaimer, FAN_STUDY_DISCLAIMER);
  assert.match(result.disclaimer ?? '', /不能替代权利人的明确授权/u);
});

test('requires renewed acceptance when the terms version changes', () => {
  const stalePolicy = createFanStudyDeckContentPolicy({
    materialsRightsConfirmed: true,
    personalNonCommercialConfirmed: true,
    unofficialAndUnaffiliatedConfirmed: true,
    guardianJointlyConfirmed: true,
  }, ACCEPTED_AT, '0.9');
  const result = validateDeckExportPolicy(deck(stalePolicy));

  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, 'FAN_STUDY_TERMS_OUTDATED');
});

test('rejects inconsistent or extended agreement metadata during storage validation', () => {
  const invalidPolicy = {
    schemaVersion: 1,
    mode: 'fan-study',
    agreement: {
      termsVersion: FAN_STUDY_TERMS_VERSION,
      acceptedAt: ACCEPTED_AT,
      confirmations: {
        materialsRightsConfirmed: true,
        personalNonCommercialConfirmed: false,
        unofficialAndUnaffiliatedConfirmed: false,
        guardianJointlyConfirmed: false,
      },
    },
  };
  assert.throws(
    () => normalizeDeckLibrary({
      schemaVersion: 1,
      activeDeckId: null,
      activeDeckCid: null,
      activeDeckRevision: null,
      decks: [{ ...deck(), contentPolicy: invalidPolicy }],
    }),
    /作品库包含无法识别的套牌/u,
  );
});
