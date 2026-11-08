import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type ProductionChunk,
  verifyPixiCspProductionChunks,
} from '../scripts/pixi-csp-build-guard.ts';

const projectRoot = '/workspace';
const coreFileName = 'assets/pixi-core.js';

function chunk(overrides: Partial<ProductionChunk>): ProductionChunk {
  return {
    code: '',
    dynamicImports: [],
    facadeModuleId: null,
    fileName: 'assets/empty.js',
    imports: [],
    isEntry: false,
    moduleIds: [],
    ...overrides,
  };
}

function validChunks(): ProductionChunk[] {
  return [
    chunk({
      code: 'await import("./pixi-runtime.js"); await import("./app.js");',
      dynamicImports: ['assets/pixi-runtime.js', 'assets/app.js'],
      fileName: 'assets/index.js',
      imports: [],
      isEntry: true,
      moduleIds: [`${projectRoot}/src/main.ts`],
    }),
    chunk({
      code: [
        'function install(){',
        'Object.assign(A.prototype,{_unsafeEvalCheck(){}});',
        'Object.assign(B.prototype,{_systemCheck(){}});',
        'Object.assign(C.prototype,{_generateUniformsSync:uniforms});',
        'Object.assign(D.prototype,{_generateUboSync:glUbo});',
        'Object.assign(E.prototype,{_generateUboSync:gpuUbo});',
        'Object.assign(F.prototype,{_generateShaderSync:shader});',
        'Object.assign(G.prototype,{generateParticleUpdate:particles});',
        '}',
      ].join(''),
      fileName: 'assets/pixi-runtime.js',
      imports: [coreFileName],
      moduleIds: [
        `${projectRoot}/src/pixi-runtime.ts`,
        `${projectRoot}/node_modules/pixi.js/lib/unsafe-eval/init.mjs`,
        `${projectRoot}/node_modules/pixi.js/lib/unsafe-eval/particle/generateParticleUpdatePolyfill.mjs`,
        `${projectRoot}/node_modules/pixi.js/lib/unsafe-eval/shader/generateShaderSyncPolyfill.mjs`,
        `${projectRoot}/node_modules/pixi.js/lib/unsafe-eval/ubo/generateUboSyncPolyfill.mjs`,
        `${projectRoot}/node_modules/pixi.js/lib/unsafe-eval/uniforms/generateUniformsSyncPolyfill.mjs`,
      ],
    }),
    chunk({
      code: 'export class ArtificerDeckApp {}',
      fileName: 'assets/app.js',
      imports: [coreFileName],
      moduleIds: [`${projectRoot}/src/app.ts`],
    }),
    chunk({
      code: 'export class AbstractRenderer {}',
      fileName: coreFileName,
      moduleIds: [
        `${projectRoot}/node_modules/pixi.js/lib/rendering/renderers/shared/system/AbstractRenderer.mjs`,
      ],
    }),
  ];
}

test('accepts a production graph with a complete Pixi strict-CSP runtime', () => {
  const result = verifyPixiCspProductionChunks(validChunks());
  assert.equal(result.entryChunk, 'assets/index.js');
  assert.equal(result.runtimeChunk, 'assets/pixi-runtime.js');
  assert.equal(result.appChunk, 'assets/app.js');
  assert.equal(result.coreChunk, coreFileName);
  assert.equal(result.replacementCounts._generateUboSync, 2);
});

test('rejects an entry that evaluates the app import before the CSP runtime', () => {
  const chunks = validChunks();
  chunks[0].code = 'await import("./app.js"); await import("./pixi-runtime.js");';
  assert.throws(
    () => verifyPixiCspProductionChunks(chunks),
    /应用块在 CSP 安全运行时之前加载/u,
  );
});

test('rejects a runtime missing any static shader replacement', () => {
  const chunks = validChunks();
  chunks[1].code = chunks[1].code.replace('_generateShaderSync', 'removedShaderSync');
  assert.throws(
    () => verifyPixiCspProductionChunks(chunks),
    /缺少 _generateShaderSync 静态替代/u,
  );
});

test('rejects a runtime that falls back to dynamic code generation', () => {
  const chunks = validChunks();
  chunks[1].code += 'const compile = new Function("return 1");';
  assert.throws(
    () => verifyPixiCspProductionChunks(chunks),
    /仍包含动态代码求值/u,
  );
});

test('rejects duplicate Pixi renderer cores or package roots', () => {
  const chunks = validChunks();
  chunks.push(chunk({
    code: 'export class AbstractRenderer {}',
    fileName: 'assets/duplicate-pixi-core.js',
    moduleIds: [
      `${projectRoot}/node_modules/other/node_modules/pixi.js/lib/rendering/renderers/shared/system/AbstractRenderer.mjs`,
    ],
  }));
  assert.throws(
    () => verifyPixiCspProductionChunks(chunks),
    /AbstractRenderer 应只打包一次/u,
  );
});

test('rejects app and runtime graphs that do not reach the same core chunk', () => {
  const chunks = validChunks();
  chunks[2].imports = [];
  assert.throws(
    () => verifyPixiCspProductionChunks(chunks),
    /应用没有引用 CSP 运行时所修补/u,
  );
});
