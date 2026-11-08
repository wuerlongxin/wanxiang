import type { Plugin } from 'vite';

export interface ProductionChunk {
  code: string;
  dynamicImports: string[];
  facadeModuleId: string | null;
  fileName: string;
  imports: string[];
  isEntry: boolean;
  moduleIds: string[];
}

export interface PixiCspBuildReport {
  appChunk: string;
  coreChunk: string;
  entryChunk: string;
  pixiPackageRoot: string;
  replacementCounts: Record<string, number>;
  runtimeChunk: string;
}

const REQUIRED_POLYFILL_MODULE_SUFFIXES = [
  '/node_modules/pixi.js/lib/unsafe-eval/init.mjs',
  '/node_modules/pixi.js/lib/unsafe-eval/particle/generateParticleUpdatePolyfill.mjs',
  '/node_modules/pixi.js/lib/unsafe-eval/shader/generateShaderSyncPolyfill.mjs',
  '/node_modules/pixi.js/lib/unsafe-eval/ubo/generateUboSyncPolyfill.mjs',
  '/node_modules/pixi.js/lib/unsafe-eval/uniforms/generateUniformsSyncPolyfill.mjs',
] as const;

const REQUIRED_REPLACEMENTS = new Map<string, number>([
  ['_unsafeEvalCheck', 1],
  ['_systemCheck', 1],
  ['_generateUniformsSync', 1],
  ['_generateUboSync', 2],
  ['_generateShaderSync', 1],
  ['generateParticleUpdate', 1],
]);

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/[?#].*$/u, '');
}

function moduleMatches(moduleId: string, suffix: string): boolean {
  return normalizePath(moduleId).endsWith(suffix);
}

function findSingleChunk(
  chunks: readonly ProductionChunk[],
  label: string,
  predicate: (chunk: ProductionChunk) => boolean,
): ProductionChunk {
  const matches = chunks.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`${label}应恰好存在一个构建块，实际为 ${matches.length} 个。`);
  }
  return matches[0];
}

function localDynamicImports(code: string): Array<{ path: string; position: number }> {
  return [...code.matchAll(/\bimport\(\s*["']([^"']+\.js)["']\s*\)/gu)].map((match) => ({
    path: match[1],
    position: match.index,
  }));
}

function referencesChunk(reference: string, chunk: ProductionChunk): boolean {
  const normalizedReference = normalizePath(reference).replace(/^\.\//u, '');
  const normalizedFileName = normalizePath(chunk.fileName).replace(/^\.\//u, '');
  const chunkBaseName = normalizedFileName.split('/').at(-1);
  return normalizedReference === normalizedFileName
    || normalizedReference === chunkBaseName
    || normalizedReference.endsWith(`/${chunkBaseName}`);
}

function staticDependencyClosure(
  start: ProductionChunk,
  chunksByFileName: ReadonlyMap<string, ProductionChunk>,
): Set<string> {
  const visited = new Set<string>();
  const pending = [start.fileName];
  while (pending.length) {
    const fileName = pending.pop();
    if (!fileName || visited.has(fileName)) continue;
    visited.add(fileName);
    const chunk = chunksByFileName.get(fileName);
    if (!chunk) continue;
    for (const dependency of chunk.imports) {
      if (chunksByFileName.has(dependency) && !visited.has(dependency)) pending.push(dependency);
    }
  }
  return visited;
}

function countToken(source: string, token: string): number {
  let count = 0;
  let position = source.indexOf(token);
  while (position !== -1) {
    count += 1;
    position = source.indexOf(token, position + token.length);
  }
  return count;
}

function pixiPackageRoot(moduleId: string): string | null {
  const normalized = normalizePath(moduleId);
  const marker = '/node_modules/pixi.js/';
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return null;
  return normalized.slice(0, index + marker.length - 1);
}

export function verifyPixiCspProductionChunks(
  chunks: readonly ProductionChunk[],
): PixiCspBuildReport {
  const entry = findSingleChunk(
    chunks,
    '桌面前端入口',
    (chunk) => chunk.isEntry && chunk.moduleIds.some((id) => moduleMatches(id, '/src/main.ts')),
  );
  const runtime = findSingleChunk(
    chunks,
    'Pixi CSP 安全运行时',
    (chunk) => chunk.moduleIds.some((id) => moduleMatches(id, '/src/pixi-runtime.ts')),
  );
  const app = findSingleChunk(
    chunks,
    'Pixi 应用',
    (chunk) => chunk.moduleIds.some((id) => moduleMatches(id, '/src/app.ts')),
  );

  const dynamicImports = localDynamicImports(entry.code);
  const runtimeImports = dynamicImports.filter((item) => referencesChunk(item.path, runtime));
  const appImports = dynamicImports.filter((item) => referencesChunk(item.path, app));
  if (runtimeImports.length !== 1 || appImports.length !== 1) {
    throw new Error('前端入口必须分别动态加载一次 Pixi CSP 运行时和应用块。');
  }
  if (runtimeImports[0].position >= appImports[0].position) {
    throw new Error('Pixi 应用块在 CSP 安全运行时之前加载。');
  }
  if (!entry.dynamicImports.some((dependency) => referencesChunk(dependency, runtime))) {
    throw new Error('入口构建元数据缺少 Pixi CSP 运行时动态依赖。');
  }
  if (!entry.dynamicImports.some((dependency) => referencesChunk(dependency, app))) {
    throw new Error('入口构建元数据缺少 Pixi 应用动态依赖。');
  }

  for (const suffix of REQUIRED_POLYFILL_MODULE_SUFFIXES) {
    if (!runtime.moduleIds.some((id) => moduleMatches(id, suffix))) {
      throw new Error(`Pixi CSP 运行时缺少静态替代模块：${suffix}`);
    }
  }

  const replacementCounts: Record<string, number> = {};
  for (const [method, minimum] of REQUIRED_REPLACEMENTS) {
    const count = countToken(runtime.code, method);
    replacementCounts[method] = count;
    if (count < minimum) {
      throw new Error(`Pixi CSP 运行时缺少 ${method} 静态替代，至少需要 ${minimum} 处。`);
    }
  }
  if (!/_unsafeEvalCheck\s*\(\s*\)\s*\{\s*\}/u.test(runtime.code)) {
    throw new Error('Pixi CSP 运行时没有覆盖渲染器动态求值检查。');
  }
  if (!/_systemCheck\s*\(\s*\)\s*\{\s*\}/u.test(runtime.code)) {
    throw new Error('Pixi CSP 运行时没有覆盖 UBO 动态求值检查。');
  }
  if (/\bnew\s+Function\s*\(|\beval\s*\(/u.test(runtime.code)) {
    throw new Error('Pixi CSP 运行时仍包含动态代码求值。');
  }

  const abstractRendererModules = chunks.flatMap((chunk) => (
    chunk.moduleIds
      .filter((id) => /\/node_modules\/pixi\.js\/lib\/rendering\/renderers\/shared\/system\/AbstractRenderer\.(?:mjs|js)$/u.test(normalizePath(id)))
      .map((moduleId) => ({ chunk, moduleId }))
  ));
  if (abstractRendererModules.length !== 1) {
    throw new Error(`Pixi AbstractRenderer 应只打包一次，实际为 ${abstractRendererModules.length} 次。`);
  }
  const core = abstractRendererModules[0].chunk;

  const packageRoots = new Set(
    chunks.flatMap((chunk) => chunk.moduleIds.map(pixiPackageRoot).filter((root): root is string => Boolean(root))),
  );
  if (packageRoots.size !== 1) {
    throw new Error(`生产模块图必须只包含一份 Pixi，实际来源为 ${packageRoots.size} 份。`);
  }

  const chunksByFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  if (!staticDependencyClosure(runtime, chunksByFileName).has(core.fileName)) {
    throw new Error('Pixi CSP 运行时没有引用应用所用的 AbstractRenderer 核心块。');
  }
  if (!staticDependencyClosure(app, chunksByFileName).has(core.fileName)) {
    throw new Error('Pixi 应用没有引用 CSP 运行时所修补的 AbstractRenderer 核心块。');
  }

  return {
    appChunk: app.fileName,
    coreChunk: core.fileName,
    entryChunk: entry.fileName,
    pixiPackageRoot: [...packageRoots][0],
    replacementCounts,
    runtimeChunk: runtime.fileName,
  };
}

export function pixiCspBuildGuard(): Plugin {
  return {
    name: 'artificer-pixi-csp-build-guard',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const chunks: ProductionChunk[] = Object.values(bundle).flatMap((output) => (
        output.type === 'chunk'
          ? [{
            code: output.code,
            dynamicImports: [...output.dynamicImports],
            facadeModuleId: output.facadeModuleId,
            fileName: output.fileName,
            imports: [...output.imports],
            isEntry: output.isEntry,
            moduleIds: [...output.moduleIds],
          }]
          : []
      ));
      verifyPixiCspProductionChunks(chunks);
    },
  };
}
