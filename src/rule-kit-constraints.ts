export const MAX_RULE_MODULES = 16;

interface RuleModuleIdentity {
  id?: unknown;
}

export function normalizeRuleModuleId(value: string): string {
  return value.normalize('NFKC').trim();
}

export function normalizeUniqueRuleModuleIds(
  modules: readonly RuleModuleIdentity[],
): string[] | null {
  if (modules.length < 1 || modules.length > MAX_RULE_MODULES) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const module of modules) {
    if (typeof module.id !== 'string') return null;
    const id = normalizeRuleModuleId(module.id);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function requireRuleModuleId(value: string): string {
  const normalized = normalizeRuleModuleId(value);
  if (!normalized) throw new TypeError('玩法积木 ID 不能为空。');
  return normalized;
}

export function normalizeRuleKitModuleIds<T extends RuleModuleIdentity>(
  modules: readonly T[],
): Array<T & { id: string }> {
  const ids = normalizeUniqueRuleModuleIds(modules);
  if (!ids) {
    if (modules.length > MAX_RULE_MODULES) {
      throw new RangeError(`玩法积木最多 ${MAX_RULE_MODULES} 枚。`);
    }
    throw new TypeError('玩法积木 ID 必须非空且不得重复。');
  }
  return modules.map((module, index) => ({ ...module, id: ids[index] }));
}

export function compareRuleModuleIds(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const commonLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < commonLength; index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}
