import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const installer = readFileSync(new URL('../scripts/macos-dmg/install.command', import.meta.url), 'utf8');
const packager = readFileSync(new URL('../scripts/package-macos-dmg.sh', import.meta.url), 'utf8');
const buildScript = readFileSync(new URL('../scripts/build-macos-dmg.sh', import.meta.url), 'utf8');

test('macOS installer copies the app and removes quarantine with sudo xattr', () => {
  assert.match(installer, /\/Applications\/万象卡域\.app/u);
  assert.match(installer, /sudo \/usr\/bin\/xattr -dr com\.apple\.quarantine/u);
  assert.match(installer, /\/usr\/bin\/open/u);
});

test('macOS DMG packaging injects the explanation and installer files', () => {
  assert.match(packager, /hdiutil convert .* -format UDRW/u);
  assert.match(packager, /README\.txt/u);
  assert.match(packager, /install\.command/u);
  assert.match(packager, /-format UDZO/u);
  assert.match(buildScript, /package-macos-dmg\.sh/u);
});
