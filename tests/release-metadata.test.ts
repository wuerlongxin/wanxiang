import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
  dependencies: Record<string, string>;
};
const packageLock = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
) as {
  version: string;
  packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
};
const tauriConfig = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
) as { version: string };
const cargoManifest = readFileSync(
  new URL('../src-tauri/Cargo.toml', import.meta.url),
  'utf8',
);
const cargoLock = readFileSync(
  new URL('../src-tauri/Cargo.lock', import.meta.url),
  'utf8',
);

function cargoPackageVersion(source: string): string | undefined {
  return source.match(
    /(?:^|\n)(?:\[\[?package\]?\]\n)?name = "wanxiang-deck"\nversion = "([^"]+)"/u,
  )?.[1];
}

test('keeps desktop release metadata aligned and Pixi deterministic', () => {
  const releaseVersion = packageJson.version;
  assert.equal(releaseVersion, '0.1.2');
  assert.equal(packageLock.version, releaseVersion);
  assert.equal(packageLock.packages['']?.version, releaseVersion);
  assert.equal(tauriConfig.version, releaseVersion);
  assert.equal(cargoPackageVersion(cargoManifest), releaseVersion);
  assert.equal(cargoPackageVersion(cargoLock), releaseVersion);

  assert.equal(packageJson.dependencies['pixi.js'], '8.19.0');
  assert.equal(packageLock.packages['']?.dependencies?.['pixi.js'], '8.19.0');
  assert.equal(packageLock.packages['node_modules/pixi.js']?.version, '8.19.0');
});
