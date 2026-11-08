import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const buildScriptUrl = new URL('../src-tauri/build.rs', import.meta.url);

test('release builds never compile AI credentials from dotenv or rustc env', async () => {
  const buildScript = await readFile(buildScriptUrl, 'utf8');
  assert.doesNotMatch(buildScript, /OPENAI_API_KEY|rustc-env|dotenv/i);

  // The desktop AI settings module (src-tauri/src/config.rs) was deleted
  // with the AI feature, and no .env file is read for credentials.
  assert.equal(existsSync(new URL('../src-tauri/src/config.rs', import.meta.url)), false);
  assert.equal(existsSync(new URL('../.env.example', import.meta.url)), false);

  const rustFiles = (await readdir(new URL('../src-tauri/src', import.meta.url)))
    .filter((file) => file.endsWith('.rs'));
  for (const file of rustFiles) {
    const source = await readFile(new URL(`../src-tauri/src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /OPENAI_API_KEY|OPENAI_BASE_URL|dotenvy/i, file);
  }
});
