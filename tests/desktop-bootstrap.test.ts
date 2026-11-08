import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { findUnsupportedRuntimeImageReferences } from '../scripts/verify-desktop-bundle.mjs';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const pixiRuntimeSource = readFileSync(
  new URL('../src/pixi-runtime.ts', import.meta.url),
  'utf8',
);
const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const viteSource = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const tauriConfigSource = readFileSync(
  new URL('../src-tauri/tauri.conf.json', import.meta.url),
  'utf8',
);
const tauriConfig = JSON.parse(tauriConfigSource) as {
  app?: { security?: { csp?: unknown } };
};
const packageManifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { dependencies?: Record<string, string> };
const packageLock = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
) as {
  packages?: Record<string, { dependencies?: Record<string, string>; version?: string }>;
};
const installedPixiManifest = JSON.parse(
  readFileSync(new URL('../node_modules/pixi.js/package.json', import.meta.url), 'utf8'),
) as { version?: string };
const tauriCapabilitySource = readFileSync(
  new URL('../src-tauri/capabilities/default.json', import.meta.url),
  'utf8',
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:css|ts)$/u.test(entry.name) ? [path] : [];
  });
}

const runtimeSources = sourceFiles(new URL('../src', import.meta.url).pathname)
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

function collectDependencyVersions(tree: unknown, dependencyName: string): string[] {
  if (!tree || typeof tree !== 'object') return [];
  const dependencies = (tree as { dependencies?: unknown }).dependencies;
  if (!dependencies || typeof dependencies !== 'object') return [];
  return Object.entries(dependencies).flatMap(([name, dependency]) => {
    if (!dependency || typeof dependency !== 'object') return [];
    const version = (dependency as { version?: unknown }).version;
    const ownVersion = name === dependencyName && typeof version === 'string' ? [version] : [];
    return [...ownVersion, ...collectDependencyVersions(dependency, dependencyName)];
  });
}

test('desktop startup never waits forever on custom fonts', () => {
  assert.match(mainSource, /Promise\.race\(\[settled, timeout\]\)/u);
  assert.match(mainSource, /timeoutMs = 1600/u);
  assert.doesNotMatch(mainSource, /^await\s+/mu);
});

test('desktop startup exposes a visible failure instead of a black window', () => {
  assert.match(indexSource, /id="boot-status"/u);
  assert.match(indexSource, /id="boot-retry"[^>]+title="重新加载万象卡域"/u);
  assert.match(mainSource, /bootstrap\(\)\.catch\(renderBootFailure\)/u);
  assert.match(mainSource, /addEventListener\('unhandledrejection'/u);
});

test('desktop close waits for the latest local deck revision to reach disk', () => {
  assert.match(mainSource, /onCloseRequested\(async \(event\)/u);
  assert.match(mainSource, /event\.preventDefault\(\)/u);
  assert.match(mainSource, /await app\.flushPendingStorage\(\)/u);
  assert.match(mainSource, /allowDiscardOnNextClose = true/u);
  assert.match(appSource, /persistedRevision < this\.libraryRevision \|\| this\.persistenceTask/u);
  assert.match(appSource, /关闭前保存失败/u);
  assert.match(tauriCapabilitySource, /core:window:allow-destroy/u);
});

test('renderer keeps WebGL first and retries with Canvas when unavailable', () => {
  assert.match(appSource, /preference: \['webgl'\]/u);
  assert.match(appSource, /catch \(webglError\)[\s\S]+preference: \['canvas'\]/u);
  assert.match(appSource, /dataset\.renderer = 'webgl'/u);
  assert.match(appSource, /dataset\.renderer = 'canvas'/u);
  assert.match(appSource, /WEBGL_INIT_TIMEOUT_MS = 3_200/u);
  assert.match(appSource, /CANVAS_INIT_TIMEOUT_MS = 3_200/u);
  assert.match(appSource, /withStartupTimeout\(\s*this\.pixi\.init\(\{ \.\.\.rendererOptions, preference: \['webgl'\] \}\)/u);
});

test('desktop startup enters the lobby even when local library restore stalls', () => {
  assert.match(mainSource, /await app\.init\(root, \(stage, message\) =>/u);
  assert.match(appSource, /LIBRARY_RESTORE_TIMEOUT_MS = 2_500/u);
  assert.match(appSource, /withStartupTimeout\(\s*loadDeckLibrary\(\),\s*LIBRARY_RESTORE_TIMEOUT_MS/u);
  assert.match(appSource, /作品库读取超时，已先进入首页/u);
  assert.match(appSource, /this\.storageBlocked = true/u);
  assert.match(appSource, /this\.openLobby\(false\)/u);
});

test('Pixi installs its strict-CSP renderer polyfill before loading the renderer and application', () => {
  const pixiRuntime = mainSource.indexOf("await import('./pixi-runtime')");
  const pixiApplication = mainSource.indexOf("await import('./app')", pixiRuntime);
  const cspPolyfill = pixiRuntimeSource.indexOf("import 'pixi.js/unsafe-eval';");
  const pixiExports = pixiRuntimeSource.indexOf("from 'pixi.js';", cspPolyfill);
  assert.notEqual(pixiRuntime, -1);
  assert.ok(pixiRuntime < pixiApplication);
  assert.notEqual(cspPolyfill, -1);
  assert.ok(cspPolyfill < pixiExports);
  assert.doesNotMatch(mainSource, /^import[^;]+from ['"]pixi\.js['"];$/mu);
  assert.equal(typeof tauriConfig.app?.security?.csp, 'string');
  assert.doesNotMatch(String(tauriConfig.app?.security?.csp), /unsafe-eval/u);
  assert.match(viteSource, /plugins: \[pixiCspBuildGuard\(\)\]/u);
  assert.match(viteSource, /dedupe: \['pixi\.js'\]/u);
  assert.match(viteSource, /include: \['pixi\.js', 'pixi\.js\/unsafe-eval'\]/u);
});

test('desktop Pixi textures avoid the tauri custom-protocol ImageBitmap path', () => {
  assert.match(pixiRuntimeSource, /'__TAURI_INTERNALS__' in globalThis/u);
  assert.match(pixiRuntimeSource, /textureLoaderConfig\.preferWorkers = false/u);
  assert.match(
    pixiRuntimeSource,
    /textureLoaderConfig\.preferCreateImageBitmap = false/u,
  );
});

test('Pixi is exactly pinned and resolves to one installed version', () => {
  const declaredVersion = packageManifest.dependencies?.['pixi.js'];
  assert.match(declaredVersion ?? '', /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
  assert.equal(installedPixiManifest.version, declaredVersion);
  assert.equal(packageLock.packages?.['']?.dependencies?.['pixi.js'], declaredVersion);

  const lockedPixiPackages = Object.entries(packageLock.packages ?? {}).filter(([path]) => (
    path === 'node_modules/pixi.js' || path.endsWith('/node_modules/pixi.js')
  ));
  assert.equal(lockedPixiPackages.length, 1);
  assert.equal(lockedPixiPackages[0]?.[1].version, declaredVersion);

  const npmTree = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['ls', 'pixi.js', '--all', '--json'],
    {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    },
  );
  assert.equal(npmTree.status, 0, npmTree.stderr || npmTree.stdout);
  const installedVersions = new Set(
    collectDependencyVersions(JSON.parse(npmTree.stdout), 'pixi.js'),
  );
  assert.deepEqual([...installedVersions], [declaredVersion]);
});

test('installed Pixi strict-CSP polyfill runs when dynamic code generation is blocked', () => {
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        'globalThis.Function = function BlockedFunction() {',
        '  throw new EvalError("unsafe-eval blocked");',
        '};',
        'await import("pixi.js/unsafe-eval");',
        'const { AbstractRenderer } = await import("pixi.js");',
        'AbstractRenderer.prototype._unsafeEvalCheck.call({});',
      ].join('\n'),
    ],
    {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    },
  );

  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
});

test('desktop resources stay local and use protocol-safe relative paths', () => {
  assert.match(viteSource, /base: '\.\/'/u);
  assert.match(indexSource, /href="\.\/assets\/fonts\/source-han-sans-cn-vf\.woff2"/u);
  assert.match(indexSource, /href="\.\/assets\/fonts\/source-han-serif-cn-vf\.woff2"/u);
  assert.doesNotMatch(indexSource, /(?:unpkg|jsdelivr|fonts\.googleapis)/u);
  assert.match(
    String(tauriConfig.app?.security?.csp),
    /connect-src 'self' ipc: http:\/\/ipc\.localhost/u,
  );
});

test('every referenced static asset exists locally and runtime code uses no asset CDN', () => {
  const assetPaths = [...new Set(runtimeSources.match(/\/assets\/[A-Za-z0-9._/-]+/gu) ?? [])].sort();
  assert.ok(assetPaths.length >= 10);
  for (const assetPath of assetPaths) {
    assert.equal(
      existsSync(new URL(`../public${assetPath}`, import.meta.url)),
      true,
      `missing local static asset: ${assetPath}`,
    );
  }

  const remoteUrls = [...new Set(
    runtimeSources.match(/https?:\/\/[A-Za-z0-9._/-]+/gu) ?? [],
  )].sort();
  assert.deepEqual(remoteUrls, [
    'https://github.com/wuerlongxin/artificer-deck',
  ]);
});

test('desktop runtime source never references WebP or AVIF images', () => {
  assert.deepEqual(findUnsupportedRuntimeImageReferences(runtimeSources), []);
});

test('bundled runtime assets avoid WebP for macOS custom-protocol compatibility', () => {
  const staticWebpPaths = runtimeSources.match(/\/assets\/[A-Za-z0-9._/-]+\.webp\b/gu) ?? [];
  assert.deepEqual(staticWebpPaths, []);
});
