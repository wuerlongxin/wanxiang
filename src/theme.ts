export const COLORS = {
  ink: 0x100b0d,
  inkSoft: 0x181114,
  panel: 0x21181b,
  panelRaised: 0x2b2022,
  line: 0x57423f,
  lineSoft: 0x3d2f31,
  paper: 0xfff4df,
  paperMuted: 0xd0c2af,
  paperFaint: 0x91857d,
  jade: 0x4fddb2,
  jadeDeep: 0x16866f,
  gold: 0xffc857,
  amber: 0xff9f43,
  bronze: 0xa97532,
  cinnabar: 0xb9342b,
  coral: 0xff6458,
  vermilion: 0xd94335,
  cyan: 0x62d9e8,
  violet: 0xc991f4,
  danger: 0xff5a55,
  black: 0x000000,
  white: 0xffffff,
} as const;

export const BODY_FONT_NAME = 'Source Han Sans CN';
export const DISPLAY_FONT_NAME = 'Source Han Serif CN';

export const FONT_FAMILY = `"${BODY_FONT_NAME}", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
export const DISPLAY_FONT = `"${DISPLAY_FONT_NAME}", "Songti SC", STSong, "Noto Serif CJK SC", serif`;

export const CARD_RATIO = 88 / 63;
export const MOTION = {
  hover: 0.18,
  fusionFlight: 0.52,
  fusionImpact: 0.22,
  fusionZoom: 0.48,
} as const;

export function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function rgba(color: number, alpha: number): string {
  const hex = color.toString(16).padStart(6, '0');
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
