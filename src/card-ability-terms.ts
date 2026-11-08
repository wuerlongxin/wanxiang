export interface CardAbilityTerm {
  keyword: string;
  effect: string;
}

export interface AbilityGlossarySource {
  name: string;
  skill: string;
}

const TERM_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/危机|爆炸|淘汰/u, '危机'],
  [/拆除|保命|复活/u, '化险'],
  [/反转|逆向/u, '逆转'],
  [/交换|换手/u, '易位'],
  [/重排|排序|放回|塞回/u, '篡序'],
  [/查看|展示|透视/u, '洞见'],
  [/弃置|弃牌/u, '弃策'],
  [/跳过/u, '停步'],
  [/猜中|提示|图标/u, '灵犀'],
  [/阵营/u, '阵营'],
  [/指定动作|完成[^，。；]*动作/u, '动作'],
  [/额外获得|获得[^，。；]*标记/u, '奖励'],
  [/增加|额外|再翻|继续/u, '增幅'],
  [/翻牌|配对|匹配/u, '配对'],
  [/相同|同纹|纹样|图案/u, '识纹'],
  [/恰好|凑成|总数|数量之和/u, '共鸣'],
  [/收取|收走/u, '收纳'],
  [/覆盖|盖在/u, '覆牌'],
  [/标记/u, '留痕'],
  [/限制|不能|仅/u, '制约'],
];

const COMPACT_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/本牌/gu, ''],
  [/一名玩家/gu, '玩家'],
  [/任意位置/gu, '任意牌位'],
  [/公共牌上/gu, '公共牌'],
  [/发现与公共牌的唯一同纹并喊出名称后/gu, '喊出唯一同纹'],
  [/正确指出相同纹样后/gu, '指出相同纹样'],
  [/翻出的两张牌配对成功后/gu, '两牌配对成功'],
  [/配对失败并盖回时/gu, '配对失败盖回'],
  [/当桌面同类符号总数恰好为五时抢先触发/gu, '同类总数=5时触发'],
  [/打出后可令/gu, '打出：'],
  [/然后/gu, '再'],
  [/将覆盖/gu, '覆盖'],
  [/再将弃置/gu, '弃置'],
  [/将弃置/gu, '弃置'],
  [/立即/gu, ''],
  [/可以/gu, '可'],
  [/九十度/gu, '90°'],
  [/三张/gu, '3张'],
  [/两张/gu, '2张'],
  [/一次/gu, '1次'],
  [/一个/gu, '1个'],
  [/一枚/gu, '1枚'],
  [/五时/gu, '5时'],
  [/为五/gu, '为5'],
];

function characterUnits(character: string): number {
  if (/\s/u.test(character)) return 0.36;
  if (/[\x00-\x7F]/u.test(character)) return 0.58;
  return 1;
}

function clipByUnits(value: string, maxUnits: number): string {
  let units = 0;
  let result = '';
  for (const character of value) {
    const nextUnits = characterUnits(character);
    if (units + nextUnits > maxUnits) break;
    result += character;
    units += nextUnits;
  }
  if (result.length === value.length) return result;
  return `${result.replace(/[，。；：、,.!?;:。！？]+$/u, '')}…`;
}

function compactEffect(value: string): string {
  let result = value.trim();
  for (const [pattern, replacement] of COMPACT_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result
    .replace(/^[，,：:\s]+|[，,。；;：:\s]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function chooseKeyword(value: string): string {
  for (const [pattern, keyword] of TERM_RULES) {
    if (pattern.test(value)) return keyword;
  }
  return '效果';
}

/**
 * Turns authored rules text into compact front-face entries. The source text is
 * left untouched so the card detail side can still show the complete wording.
 */
export function deriveAbilityTerms(skill: string, maxTerms = 3): CardAbilityTerm[] {
  const limit = Math.max(1, Math.min(3, Math.floor(maxTerms)));
  const normalized = skill.replace(/\s+/gu, ' ').trim();
  if (!normalized) return [];

  const sentences = normalized
    .split(/[。；;！？!?]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const clauses = sentences.flatMap((sentence) => {
    const parts = sentence
      .split(/[，,]+/u)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 1 ? parts : [sentence];
  });

  const terms: CardAbilityTerm[] = [];
  const seen = new Set<string>();
  for (const clause of clauses) {
    const effect = clipByUnits(compactEffect(clause), 17);
    if (!effect) continue;
    const keyword = chooseKeyword(clause);
    const identity = `${keyword}:${effect}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    terms.push({ keyword, effect });
    if (terms.length >= limit) break;
  }

  if (terms.length === 0) {
    return [{ keyword: chooseKeyword(normalized), effect: clipByUnits(normalized, 17) }];
  }
  return terms;
}

export function buildAbilityGlossaryEntries(
  cards: readonly AbilityGlossarySource[],
): string[] {
  return cards.map((card) => {
    const authoredSkill = card.skill.replace(/\s+/gu, ' ').trim();
    const fullSkill = authoredSkill || '无额外能力。';
    const terms = authoredSkill ? deriveAbilityTerms(authoredSkill, 3) : [];
    const compact = terms.length
      ? terms.map((term) => `【${term.keyword}】${term.effect}`).join(' · ')
      : '【常驻】依照玩法说明执行';
    return `《${card.name.trim() || '未命名卡牌'}》${compact}｜完整释义：${fullSkill}`;
  });
}
