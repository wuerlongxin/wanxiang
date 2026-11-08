export type ArtStyleCategory = 'eastern' | 'global';

export interface ArtStylePreset {
  id: string;
  name: string;
  category: ArtStyleCategory;
  categoryLabel: string;
  tagline: string;
  description: string;
  prompt: string;
  palette: {
    ink: number;
    primary: number;
    secondary: number;
    accent: number;
    paper: number;
  };
  motif: 'cloud' | 'ink' | 'flower' | 'cut' | 'shadow' | 'cave' | 'lacquer' | 'porcelain' | 'enamel' | 'print' | 'bronze' | 'mountain' | 'crackle' | 'oracle' | 'neon' | 'glass' | 'geometry' | 'gouache';
}

export type ArtStyleCorner = 'ruyi' | 'seal' | 'cloud' | 'lattice' | 'fan' | 'arch' | 'step';

export interface ArtStyleUiTheme {
  accent: number;
  secondary: number;
  panel: number;
  panelRaised: number;
  paper: number;
  ink: number;
  ornament: number;
  corner: ArtStyleCorner;
  motif: ArtStylePreset['motif'];
}

export const ART_STYLE_PRESETS = [
  {
    id: 'danqing-animation',
    name: '丹青动画',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '经典中国美术片气韵',
    description: '宣纸肌理、手绘赛璐璐平涂与含蓄留白，轮廓灵动，色彩温暖明快。',
    prompt: 'Original Chinese hand-painted animation-inspired art direction, xuan-paper texture, lyrical brush contours, warm cel-like color blocks, generous negative space, playful theatrical motion, distinctly original characters; do not imitate any named studio, franchise, or artist.',
    palette: { ink: 0x241711, primary: 0xb8442f, secondary: 0xe8a948, accent: 0x74a58a, paper: 0xf4dfbd },
    motif: 'cloud',
  },
  {
    id: 'freehand-ink',
    name: '水墨写意',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '墨分五色 · 气韵流动',
    description: '浓淡干湿的墨色层次配合朱砂点睛，让角色从留白与飞白中自然显现。',
    prompt: 'Original expressive Chinese ink-wash painting, layered wet and dry brushwork, controlled ink blooms, xuan-paper grain, cinnabar accents, poetic negative space, clear youthful subject silhouette, dynamic but elegant composition.',
    palette: { ink: 0x171512, primary: 0x4b4640, secondary: 0xa9a28f, accent: 0xc84b35, paper: 0xeee5d1 },
    motif: 'ink',
  },
  {
    id: 'gongbi-rich-color',
    name: '工笔重彩',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '细线敷彩 · 华章层叠',
    description: '精密白描、层层罩染与金线收边，适合华服、灵兽和宫阙题材。',
    prompt: 'Original gongbi-inspired Chinese meticulous painting, precise flowing linework, layered mineral pigments, elegant decorative garments, fine gold contours, balanced palace-and-nature motifs, premium collectible illustration.',
    palette: { ink: 0x2b1720, primary: 0x9f3244, secondary: 0x275c63, accent: 0xdcae54, paper: 0xf1d6bd },
    motif: 'flower',
  },
  {
    id: 'paper-cut-festival',
    name: '锦纸剪影',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '层叠剪纸 · 吉祥窗花',
    description: '以多层彩纸、镂空纹样和利落侧影营造节庆般的清晰视觉节奏。',
    prompt: 'Original layered Chinese paper-cut illustration, crisp hand-cut silhouettes, folded-paper symmetry, auspicious botanical motifs, visible fiber edges, warm festive red with contrasting jade and gold layers, strong readable shapes.',
    palette: { ink: 0x381314, primary: 0xc93432, secondary: 0x166b61, accent: 0xf2b744, paper: 0xf4d6ae },
    motif: 'cut',
  },
  {
    id: 'shadow-puppet-glow',
    name: '皮影灯彩',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '雕花皮影 · 暖灯透彩',
    description: '通透皮革、镂刻关节与灯幕光晕，让人物姿态具有强烈戏剧动感。',
    prompt: 'Original Chinese shadow-puppet-inspired illustration, translucent carved leather shapes, articulated theatrical poses, intricate punched patterns, amber lantern backlight, saturated vermilion and teal pigments, dramatic screen shadows.',
    palette: { ink: 0x26110e, primary: 0xac3427, secondary: 0x277c73, accent: 0xf0a53b, paper: 0xf6c879 },
    motif: 'shadow',
  },
  {
    id: 'dunhuang-mineral',
    name: '敦煌矿彩',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '飞天流云 · 千年矿色',
    description: '石青、石绿、朱砂与土金形成沉着绚烂的壁画层次，飘带构成视觉动线。',
    prompt: 'Original mural art drawing from historic Dunhuang mineral-pigment vocabulary, flowing ribbons and celestial cloud rhythms, azurite blue, malachite green, cinnabar and aged earth-gold, matte plaster texture, respectful non-devotional fantasy scene.',
    palette: { ink: 0x3a2520, primary: 0xa44936, secondary: 0x2a7774, accent: 0xc89a4c, paper: 0xd8b77f },
    motif: 'cave',
  },
  {
    id: 'lacquer-gilt',
    name: '漆器鎏金',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '朱漆玄光 · 金纹游走',
    description: '深黑与朱红漆面映出柔亮反光，细密金箔纹样适合稀有与传说卡牌。',
    prompt: 'Original Chinese lacquerware-inspired fantasy illustration, deep black and cinnabar lacquer surfaces, hand-laid gold foil lines, subtle mother-of-pearl flecks, polished warm reflections, premium restrained ornament, bold central silhouette.',
    palette: { ink: 0x130d0b, primary: 0x8f241f, secondary: 0x3f1714, accent: 0xe0b85b, paper: 0xe4c99a },
    motif: 'lacquer',
  },
  {
    id: 'blue-white-porcelain',
    name: '青花瓷韵',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '钴蓝晕染 · 温润瓷光',
    description: '白瓷底上以钴蓝笔触构筑云水与角色，少量暖金让整体保持亲和。',
    prompt: 'Original blue-and-white porcelain-inspired illustration, cobalt brush painting on luminous warm-white ceramic, soft pigment blooms beneath glaze, elegant cloud-and-water motifs, sparse antique-gold accent, clean collectible composition.',
    palette: { ink: 0x102b46, primary: 0x285a86, secondary: 0x8eabc1, accent: 0xc29a52, paper: 0xf0eee4 },
    motif: 'porcelain',
  },
  {
    id: 'cloisonne-enamel',
    name: '铜胎珐琅',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '金丝分色 · 宝石釉彩',
    description: '金属掐丝划分高饱和釉色，纹样精密而轮廓清楚，具有珠宝般光泽。',
    prompt: 'Original Chinese cloisonne-enamel-inspired illustration, delicate gold-wire partitions, jewel-like enamel cells, turquoise, lapis, vermilion and ivory palette, polished highlights, ornate but highly legible subject design.',
    palette: { ink: 0x17323d, primary: 0x168e90, secondary: 0x244e8a, accent: 0xe4b84f, paper: 0xeee0bf },
    motif: 'enamel',
  },
  {
    id: 'woodblock-new-year',
    name: '木版年画',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '套色木刻 · 喜庆英姿',
    description: '粗犷刀味、错版套色与夸张造型共同形成明快、有力、亲切的民间叙事。',
    prompt: 'Original Chinese folk woodblock-print illustration, bold carved contours, slightly misregistered color layers, warm handmade paper, auspicious everyday storytelling, confident heroic pose, vermilion, ochre, leaf green and charcoal.',
    palette: { ink: 0x2a211a, primary: 0xd34b32, secondary: 0x4f8964, accent: 0xe2a33c, paper: 0xe9c991 },
    motif: 'print',
  },
  {
    id: 'seal-bronze',
    name: '金石青铜',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '古拙铸纹 · 篆意新生',
    description: '青铜绿锈、铸造纹理和印章式几何构图，呈现厚重却不阴郁的力量感。',
    prompt: 'Original Chinese bronze-and-seal-carving-inspired fantasy art, cast relief geometry, archaic abstract motifs without copied artifacts, warm aged bronze and jade patina, stamped rhythm, monumental friendly figure, crisp central readability.',
    palette: { ink: 0x1d2a26, primary: 0x426f60, secondary: 0x8b613c, accent: 0xd2a64d, paper: 0xd7c197 },
    motif: 'bronze',
  },
  {
    id: 'silk-landscape',
    name: '绢本青绿',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '千里层峦 · 青绿流光',
    description: '细绢底、青绿山水和散点透视形成可游可居的辽阔舞台。',
    prompt: 'Original Chinese blue-green silk landscape-inspired fantasy, layered mountain planes in mineral blue and green, fine silk texture, floating mist, journey-like spatial rhythm, small yet clear heroic subject, warm gold outlining.',
    palette: { ink: 0x1f3834, primary: 0x3c8072, secondary: 0x446d86, accent: 0xd1ab58, paper: 0xe2cfaa },
    motif: 'mountain',
  },
  {
    id: 'celadon-crackle',
    name: '青瓷冰裂',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '雨过天青 · 开片微光',
    description: '温润青釉与细密开片构成安静底色，暖铜光勾勒清爽的角色焦点。',
    prompt: 'Original celadon-glaze-inspired illustration, luminous rain-washed blue-green ceramic atmosphere, delicate crackle network, soft rounded forms, calm mist, restrained warm copper highlights, serene youthful fantasy subject.',
    palette: { ink: 0x29403a, primary: 0x75a69a, secondary: 0xa9c5b7, accent: 0xb9804e, paper: 0xe8e4d4 },
    motif: 'crackle',
  },
  {
    id: 'oracle-cosmos',
    name: '甲骨星图',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '刻痕成象 · 星轨成阵',
    description: '抽象刻痕与星象线连接古老符号感和未来探索感，不直接复制具体文字。',
    prompt: 'Original oracle-bone-and-celestial-map-inspired fantasy art, abstract carved pictographic marks that are not readable text, luminous star paths, warm bone texture, deep cinnabar night, geometric cosmic diagram, adventurous central subject.',
    palette: { ink: 0x211a25, primary: 0x63394b, secondary: 0x314968, accent: 0xe0ad56, paper: 0xd8bd91 },
    motif: 'oracle',
  },
  {
    id: 'cyber-guochao',
    name: '霓虹国潮',
    category: 'eastern',
    categoryLabel: '东方美学',
    tagline: '古纹新电 · 夜市流光',
    description: '传统云纹与灯彩结构转译为霓虹能量线，兼具东方节奏与未来速度感。',
    prompt: 'Original futuristic Chinese visual language, traditional cloud and lantern rhythms transformed into energetic neon circuitry, warm vermilion and gold balanced by jade cyan, kinetic night-market atmosphere, premium holographic lighting, no logos or readable signage.',
    palette: { ink: 0x17131c, primary: 0xd14b3f, secondary: 0x1aa0a0, accent: 0xffc455, paper: 0xe9c8a4 },
    motif: 'neon',
  },
  {
    id: 'stained-glass-fable',
    name: '晶彩寓言',
    category: 'global',
    categoryLabel: '世界绘艺',
    tagline: '透光拼片 · 童话叙事',
    description: '宝石色玻璃被暖色铅线分割，适合光明、守护与团队题材。',
    prompt: 'Original stained-glass storybook illustration, jewel-toned translucent panes, warm dark leading, radiant backlight, clear friendly character silhouette, handcrafted irregular geometry, premium fantasy collectible composition.',
    palette: { ink: 0x241b2c, primary: 0xb43f56, secondary: 0x297a86, accent: 0xf0b94d, paper: 0xe4cda9 },
    motif: 'glass',
  },
  {
    id: 'art-deco-cosmos',
    name: '金线几何',
    category: 'global',
    categoryLabel: '世界绘艺',
    tagline: '放射秩序 · 摩登华彩',
    description: '放射状几何、阶梯轮廓和暖金线构成利落、华丽的舞台感。',
    prompt: 'Original geometric decorative illustration with early modern luxury vocabulary, radiant fan shapes, stepped symmetry, warm gold linework, coral, jade and midnight accents, elegant streamlined character, crisp premium print finish.',
    palette: { ink: 0x1e1a24, primary: 0xa53f45, secondary: 0x397874, accent: 0xe5ba5b, paper: 0xe4cfaa },
    motif: 'geometry',
  },
  {
    id: 'storybook-gouache',
    name: '绘本厚彩',
    category: 'global',
    categoryLabel: '世界绘艺',
    tagline: '柔暖笔触 · 冒险绘本',
    description: '不透明水粉、可见笔触和温暖环境光，让奇幻角色亲切且富有故事感。',
    prompt: 'Original hand-painted gouache storybook art, opaque layered brush strokes, warm natural lighting, tactile paper grain, charming adventurous character, rich coral, forest green and golden accents, sophisticated but youth-friendly visual storytelling.',
    palette: { ink: 0x33231d, primary: 0xc25e49, secondary: 0x598468, accent: 0xe4ad54, paper: 0xecd7b5 },
    motif: 'gouache',
  },
] as const satisfies readonly ArtStylePreset[];

export type ArtStyleId = (typeof ART_STYLE_PRESETS)[number]['id'];

export const DEFAULT_ART_STYLE_ID: ArtStyleId = 'danqing-animation';

const ART_STYLE_BY_ID = new Map<ArtStyleId, (typeof ART_STYLE_PRESETS)[number]>(
  ART_STYLE_PRESETS.map((preset) => [preset.id, preset]),
);

export function isArtStyleId(value: unknown): value is ArtStyleId {
  return typeof value === 'string' && ART_STYLE_BY_ID.has(value as ArtStyleId);
}

export function resolveArtStyle(value: unknown): (typeof ART_STYLE_PRESETS)[number] {
  return ART_STYLE_BY_ID.get(isArtStyleId(value) ? value : DEFAULT_ART_STYLE_ID)!;
}

export function artStylesForCategory(category: ArtStyleCategory): readonly (typeof ART_STYLE_PRESETS)[number][] {
  return ART_STYLE_PRESETS.filter((preset) => preset.category === category);
}

function mixColor(a: number, b: number, amount: number): number {
  const ratio = Math.max(0, Math.min(1, amount));
  const mixChannel = (shift: number) => {
    const first = (a >> shift) & 0xff;
    const second = (b >> shift) & 0xff;
    return Math.round(first + (second - first) * ratio) << shift;
  };
  return mixChannel(16) | mixChannel(8) | mixChannel(0);
}

function cornerForMotif(motif: ArtStylePreset['motif']): ArtStyleCorner {
  if (['cloud', 'ink', 'mountain', 'porcelain', 'crackle'].includes(motif)) return 'cloud';
  if (['cut', 'print', 'oracle'].includes(motif)) return 'seal';
  if (['flower', 'enamel', 'gouache'].includes(motif)) return 'ruyi';
  if (['shadow', 'cave', 'glass'].includes(motif)) return 'arch';
  if (['lacquer', 'bronze'].includes(motif)) return 'lattice';
  if (motif === 'geometry') return 'step';
  return 'fan';
}

export const ART_STYLE_UI_THEMES = Object.freeze(
  Object.fromEntries(
    ART_STYLE_PRESETS.map((preset) => [
      preset.id,
      Object.freeze({
        accent: preset.palette.accent,
        secondary: preset.palette.secondary,
        panel: mixColor(preset.palette.ink, preset.palette.primary, 0.16),
        panelRaised: mixColor(preset.palette.ink, preset.palette.secondary, 0.24),
        paper: preset.palette.paper,
        ink: preset.palette.ink,
        ornament: preset.palette.primary,
        corner: cornerForMotif(preset.motif),
        motif: preset.motif,
      }),
    ]),
  ) as Record<ArtStyleId, Readonly<ArtStyleUiTheme>>,
);

export function getArtStyleUiTheme(value: unknown): Readonly<ArtStyleUiTheme> {
  return ART_STYLE_UI_THEMES[resolveArtStyle(value).id];
}
