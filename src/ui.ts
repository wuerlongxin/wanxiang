import {
  CanvasSource,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TilingSprite,
  type FederatedPointerEvent,
} from 'pixi.js';
import arrowLeftSvg from 'lucide-static/icons/arrow-left.svg?raw';
import arrowRightSvg from 'lucide-static/icons/arrow-right.svg?raw';
import checkSvg from 'lucide-static/icons/check.svg?raw';
import chevronDownSvg from 'lucide-static/icons/chevron-down.svg?raw';
import circleSvg from 'lucide-static/icons/circle.svg?raw';
import circleCheckSvg from 'lucide-static/icons/circle-check.svg?raw';
import copySvg from 'lucide-static/icons/copy.svg?raw';
import downloadSvg from 'lucide-static/icons/download.svg?raw';
import eyeSvg from 'lucide-static/icons/eye.svg?raw';
import githubSvg from 'lucide-static/icons/github.svg?raw';
import heartSvg from 'lucide-static/icons/heart.svg?raw';
import imageSvg from 'lucide-static/icons/image.svg?raw';
import infoSvg from 'lucide-static/icons/info.svg?raw';
import layoutGridSvg from 'lucide-static/icons/layout-grid.svg?raw';
import layersSvg from 'lucide-static/icons/layers.svg?raw';
import librarySvg from 'lucide-static/icons/library.svg?raw';
import menuSvg from 'lucide-static/icons/menu.svg?raw';
import musicSvg from 'lucide-static/icons/music.svg?raw';
import music2Svg from 'lucide-static/icons/music-2.svg?raw';
import networkSvg from 'lucide-static/icons/network.svg?raw';
import minusSvg from 'lucide-static/icons/minus.svg?raw';
import penLineSvg from 'lucide-static/icons/pen-line.svg?raw';
import plusSvg from 'lucide-static/icons/plus.svg?raw';
import refreshCwSvg from 'lucide-static/icons/refresh-cw.svg?raw';
import rotate3dSvg from 'lucide-static/icons/rotate-3d.svg?raw';
import saveSvg from 'lucide-static/icons/save.svg?raw';
import searchSvg from 'lucide-static/icons/search.svg?raw';
import sendSvg from 'lucide-static/icons/send.svg?raw';
import settingsSvg from 'lucide-static/icons/settings.svg?raw';
import shieldSvg from 'lucide-static/icons/shield.svg?raw';
import shieldCheckSvg from 'lucide-static/icons/shield-check.svg?raw';
import slidersHorizontalSvg from 'lucide-static/icons/sliders-horizontal.svg?raw';
import sparklesSvg from 'lucide-static/icons/sparkles.svg?raw';
import stampSvg from 'lucide-static/icons/stamp.svg?raw';
import swordsSvg from 'lucide-static/icons/swords.svg?raw';
import trash2Svg from 'lucide-static/icons/trash-2.svg?raw';
import triangleAlertSvg from 'lucide-static/icons/triangle-alert.svg?raw';
import uploadSvg from 'lucide-static/icons/upload.svg?raw';
import volume2Svg from 'lucide-static/icons/volume-2.svg?raw';
import volumeXSvg from 'lucide-static/icons/volume-x.svg?raw';
import wandSparklesSvg from 'lucide-static/icons/wand-sparkles.svg?raw';
import xSvg from 'lucide-static/icons/x.svg?raw';
import { COLORS, FONT_FAMILY } from './theme';
import {
  attachInteractionHint,
  hideInteractionHint,
} from './interaction-hints';
import { loadLocalTexture } from './services/local-texture';

const ICON_SVGS = {
  'arrow-left': arrowLeftSvg,
  'arrow-right': arrowRightSvg,
  check: checkSvg,
  'chevron-down': chevronDownSvg,
  circle: circleSvg,
  'circle-check': circleCheckSvg,
  copy: copySvg,
  download: downloadSvg,
  eye: eyeSvg,
  github: githubSvg,
  heart: heartSvg,
  image: imageSvg,
  info: infoSvg,
  'layout-grid': layoutGridSvg,
  layers: layersSvg,
  library: librarySvg,
  menu: menuSvg,
  music: musicSvg,
  'music-2': music2Svg,
  network: networkSvg,
  minus: minusSvg,
  'pen-line': penLineSvg,
  plus: plusSvg,
  'refresh-cw': refreshCwSvg,
  'rotate-3d': rotate3dSvg,
  save: saveSvg,
  search: searchSvg,
  send: sendSvg,
  settings: settingsSvg,
  shield: shieldSvg,
  'shield-check': shieldCheckSvg,
  'sliders-horizontal': slidersHorizontalSvg,
  sparkles: sparklesSvg,
  stamp: stampSvg,
  swords: swordsSvg,
  'trash-2': trash2Svg,
  'triangle-alert': triangleAlertSvg,
  upload: uploadSvg,
  'volume-2': volume2Svg,
  'volume-x': volumeXSvg,
  'wand-sparkles': wandSparklesSvg,
  x: xSvg,
} as const;

export type IconName = keyof typeof ICON_SVGS;
export type SizeValue = number | { width: number; height?: number };

const iconTextures = new Map<string, Texture>();
let measureContext: CanvasRenderingContext2D | null = null;

const ICON_TEXTURE_RESOLUTION = 3;
const EASTERN_UI = {
  lacquerDeep: 0x160d10,
  lacquer: 0x241417,
  lacquerRaised: 0x352025,
  cinnabarDeep: 0x651f1c,
  gilt: 0xc5964d,
  giltBright: 0xf2c66d,
  porcelain: 0x78a6a1,
} as const;

type EasternMaterialKind = 'xuan-ink' | 'lacquer-gilt' | 'silk-brocade' | 'mineral-patina';
type EasternMaterialClip = 'notched' | 'rounded';

const EASTERN_MATERIAL_PATHS: Record<EasternMaterialKind, string> = {
  'xuan-ink': '/assets/ui/textures/xuan-ink.jpg',
  'lacquer-gilt': '/assets/ui/textures/lacquer-gilt.jpg',
  'silk-brocade': '/assets/ui/textures/silk-brocade.jpg',
  'mineral-patina': '/assets/ui/textures/mineral-patina.jpg',
};

const EASTERN_MATERIAL_TILE_SCALE: Record<EasternMaterialKind, number> = {
  'xuan-ink': 0.32,
  'lacquer-gilt': 0.25,
  'silk-brocade': 0.18,
  'mineral-patina': 0.24,
};

const easternMaterialTextures = new Map<EasternMaterialKind, Texture>();
const easternMaterialRequests = new Map<EasternMaterialKind, Promise<Texture>>();

function loadEasternMaterialTexture(kind: EasternMaterialKind): Promise<Texture> {
  const cached = easternMaterialTextures.get(kind);
  if (cached && !cached.destroyed) return Promise.resolve(cached);
  const pending = easternMaterialRequests.get(kind);
  if (pending) return pending;

  const request = loadLocalTexture(EASTERN_MATERIAL_PATHS[kind])
    .then((texture) => {
      if (!texture.destroyed) easternMaterialTextures.set(kind, texture);
      return texture;
    })
    .catch(() => Texture.EMPTY)
    .finally(() => {
      if (easternMaterialRequests.get(kind) === request) {
        easternMaterialRequests.delete(kind);
      }
    });
  easternMaterialRequests.set(kind, request);
  return request;
}

interface EasternFramePaint {
  fillColor: number;
  fillAlpha?: number;
  borderColor?: number;
  borderAlpha?: number;
  borderWidth?: number;
  accentColor?: number;
  accentAlpha?: number;
  innerAlpha?: number;
  notch?: number;
}

function traceNotchedRect(
  graphics: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  requestedNotch = 4,
): Graphics {
  const notch = Math.max(1, Math.min(requestedNotch, width / 4, height / 3));
  return graphics
    .moveTo(x + notch, y)
    .lineTo(x + width - notch, y)
    .lineTo(x + width, y + notch)
    .lineTo(x + width, y + height - notch)
    .lineTo(x + width - notch, y + height)
    .lineTo(x + notch, y + height)
    .lineTo(x, y + height - notch)
    .lineTo(x, y + notch)
    .closePath();
}

function drawEasternFrame(
  graphics: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  paint: EasternFramePaint,
): void {
  const notch = paint.notch ?? 5;
  const borderColor = paint.borderColor ?? EASTERN_UI.gilt;
  const borderAlpha = paint.borderAlpha ?? 0.58;
  graphics.clear();
  traceNotchedRect(graphics, x, y, width, height, notch)
    .fill({ color: paint.fillColor, alpha: paint.fillAlpha ?? 1 })
    .stroke({
      color: borderColor,
      alpha: borderAlpha,
      width: paint.borderWidth ?? 1,
    });

  if (width > 28 && height > 20 && (paint.innerAlpha ?? 0.18) > 0) {
    traceNotchedRect(graphics, x + 2.5, y + 2.5, width - 5, height - 5, Math.max(2, notch - 1))
      .stroke({ color: EASTERN_UI.giltBright, alpha: paint.innerAlpha ?? 0.18, width: 0.6 });
  }

  const accentAlpha = paint.accentAlpha ?? 0;
  if (accentAlpha > 0 && width > 24) {
    const centerX = x + width / 2;
    const ornamentHalfWidth = Math.min(22, width * 0.18);
    const ornamentY = y + 1.5;
    const accentColor = paint.accentColor ?? EASTERN_UI.porcelain;
    graphics
      .moveTo(centerX - ornamentHalfWidth, ornamentY)
      .lineTo(centerX - 3.5, ornamentY)
      .moveTo(centerX + 3.5, ornamentY)
      .lineTo(centerX + ornamentHalfWidth, ornamentY)
      .stroke({ color: accentColor, alpha: accentAlpha, width: 1 });
    graphics
      .moveTo(centerX, ornamentY - 1.8)
      .lineTo(centerX + 2.6, ornamentY)
      .lineTo(centerX, ornamentY + 1.8)
      .lineTo(centerX - 2.6, ornamentY)
      .closePath()
      .fill({ color: accentColor, alpha: accentAlpha });
  }
}

function traceOctagon(graphics: Graphics, centerX: number, centerY: number, radius: number): Graphics {
  const inset = radius * 0.42;
  return graphics
    .moveTo(centerX - inset, centerY - radius)
    .lineTo(centerX + inset, centerY - radius)
    .lineTo(centerX + radius, centerY - inset)
    .lineTo(centerX + radius, centerY + inset)
    .lineTo(centerX + inset, centerY + radius)
    .lineTo(centerX - inset, centerY + radius)
    .lineTo(centerX - radius, centerY + inset)
    .lineTo(centerX - radius, centerY - inset)
    .closePath();
}

class EasternMaterialLayer extends Container {
  private readonly pattern = new TilingSprite({
    texture: Texture.EMPTY,
    width: 1,
    height: 1,
    roundPixels: true,
  });
  private readonly clipMask = new Graphics();
  private materialKind: EasternMaterialKind;
  private clip: EasternMaterialClip;
  private frameX = Number.NaN;
  private frameY = Number.NaN;
  private frameWidth = Number.NaN;
  private frameHeight = Number.NaN;
  private frameCorner = Number.NaN;
  private disposed = false;

  constructor(
    kind: EasternMaterialKind,
    clip: EasternMaterialClip,
    opacity: number,
  ) {
    super();
    this.materialKind = kind;
    this.clip = clip;
    this.eventMode = 'none';
    this.pattern.eventMode = 'none';
    this.clipMask.eventMode = 'none';
    this.pattern.alpha = opacity;
    this.pattern.tileScale.set(EASTERN_MATERIAL_TILE_SCALE[kind]);
    this.pattern.mask = this.clipMask;
    this.addChild(this.pattern, this.clipMask);
    void this.bindTexture(kind);
  }

  private async bindTexture(kind: EasternMaterialKind): Promise<void> {
    const texture = await loadEasternMaterialTexture(kind);
    if (this.disposed || this.materialKind !== kind || texture.destroyed) return;
    this.pattern.texture = texture;
  }

  setMaterial(kind: EasternMaterialKind): void {
    if (kind === this.materialKind) return;
    this.materialKind = kind;
    const cached = easternMaterialTextures.get(kind);
    this.pattern.texture = cached && !cached.destroyed ? cached : Texture.EMPTY;
    this.pattern.tileScale.set(EASTERN_MATERIAL_TILE_SCALE[kind]);
    void this.bindTexture(kind);
  }

  setOpacity(opacity: number): void {
    this.pattern.alpha = Math.min(0.28, Math.max(0, opacity));
  }

  setFrame(
    x: number,
    y: number,
    width: number,
    height: number,
    corner: number,
    clip = this.clip,
  ): void {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    if (
      x === this.frameX &&
      y === this.frameY &&
      safeWidth === this.frameWidth &&
      safeHeight === this.frameHeight &&
      corner === this.frameCorner &&
      clip === this.clip
    ) {
      return;
    }

    this.frameX = x;
    this.frameY = y;
    this.frameWidth = safeWidth;
    this.frameHeight = safeHeight;
    this.frameCorner = corner;
    this.clip = clip;
    this.pattern.position.set(x, y);
    this.pattern.width = safeWidth;
    this.pattern.height = safeHeight;

    const edgeInset = Math.min(1.1, Math.max(0.45, safeHeight * 0.075));
    const maskX = x + edgeInset;
    const maskY = y + edgeInset;
    const maskWidth = Math.max(0.5, safeWidth - edgeInset * 2);
    const maskHeight = Math.max(0.5, safeHeight - edgeInset * 2);
    this.clipMask.clear();
    if (clip === 'rounded') {
      this.clipMask
        .roundRect(
          maskX,
          maskY,
          maskWidth,
          maskHeight,
          Math.max(0.5, Math.min(corner, maskWidth / 2, maskHeight / 2)),
        )
        .fill({ color: COLORS.white });
    } else {
      traceNotchedRect(
        this.clipMask,
        maskX,
        maskY,
        maskWidth,
        maskHeight,
        Math.max(1, corner - edgeInset),
      ).fill({ color: COLORS.white });
    }
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.disposed = true;
    this.pattern.texture = Texture.EMPTY;
    super.destroy(options);
  }
}

function resolveSize(
  value: SizeValue,
  height: number | undefined,
  currentHeight: number,
): { width: number; height: number } {
  if (typeof value === 'number') {
    return { width: value, height: height ?? currentHeight };
  }
  return { width: value.width, height: value.height ?? currentHeight };
}

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext || typeof document === 'undefined') return measureContext;
  measureContext = document.createElement('canvas').getContext('2d');
  return measureContext;
}

function measureLabel(value: string, fontSize: number, fontWeight = '500'): number {
  const context = getMeasureContext();
  if (!context) return Array.from(value).length * fontSize;
  context.font = `${fontWeight} ${fontSize}px ${FONT_FAMILY}`;
  return context.measureText(value).width;
}

function truncateLabel(
  value: string,
  maxWidth: number,
  fontSize: number,
  fontWeight = '500',
  keepEnd = false,
): string {
  if (!value || maxWidth <= 0) return '';
  if (measureLabel(value, fontSize, fontWeight) <= maxWidth) return value;

  const characters = Array.from(value);
  const ellipsis = '\u2026';
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    const slice = keepEnd ? characters.slice(-midpoint).join('') : characters.slice(0, midpoint).join('');
    const candidate = keepEnd ? `${ellipsis}${slice}` : `${slice}${ellipsis}`;
    if (measureLabel(candidate, fontSize, fontWeight) <= maxWidth) low = midpoint;
    else high = midpoint - 1;
  }

  const slice = keepEnd ? characters.slice(-low).join('') : characters.slice(0, low).join('');
  return keepEnd ? `${ellipsis}${slice}` : `${slice}${ellipsis}`;
}

function rasterizeLucideSvg(svg: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 24 * ICON_TEXTURE_RESOLUTION;
  canvas.height = 24 * ICON_TEXTURE_RESOLUTION;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  context.scale(ICON_TEXTURE_RESOLUTION, ICON_TEXTURE_RESOLUTION);
  context.strokeStyle = '#ffffff';
  context.lineWidth = 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;

  for (const element of Array.from(root.children)) {
    const number = (attribute: string, fallback = 0): number =>
      Number.parseFloat(element.getAttribute(attribute) ?? '') || fallback;
    context.beginPath();
    switch (element.tagName.toLowerCase()) {
      case 'path': {
        const data = element.getAttribute('d');
        if (data) context.stroke(new Path2D(data));
        continue;
      }
      case 'circle':
        context.arc(number('cx'), number('cy'), number('r'), 0, Math.PI * 2);
        break;
      case 'ellipse':
        context.ellipse(number('cx'), number('cy'), number('rx'), number('ry'), 0, 0, Math.PI * 2);
        break;
      case 'line':
        context.moveTo(number('x1'), number('y1'));
        context.lineTo(number('x2'), number('y2'));
        break;
      case 'rect': {
        const x = number('x');
        const y = number('y');
        const width = number('width');
        const height = number('height');
        const radius = Math.max(number('rx'), number('ry'));
        context.roundRect(x, y, width, height, radius);
        break;
      }
      case 'polyline':
      case 'polygon': {
        const points = (element.getAttribute('points') ?? '')
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (points.length >= 2) context.moveTo(points[0], points[1]);
        for (let index = 2; index + 1 < points.length; index += 2) {
          context.lineTo(points[index], points[index + 1]);
        }
        if (element.tagName.toLowerCase() === 'polygon') context.closePath();
        break;
      }
      default:
        continue;
    }
    context.stroke();
  }
  return canvas;
}

function textureForIcon(name: string): Texture {
  const safeName = name in ICON_SVGS ? (name as IconName) : 'circle';
  const cached = iconTextures.get(safeName);
  if (cached && !cached.destroyed) return cached;

  const canvas = rasterizeLucideSvg(ICON_SVGS[safeName]);
  const texture = new Texture({
    label: `lucide:${safeName}`,
    source: new CanvasSource({
      resource: canvas,
      resolution: ICON_TEXTURE_RESOLUTION,
      autoGarbageCollect: false,
    }),
  });
  iconTextures.set(safeName, texture);
  return texture;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const texture of iconTextures.values()) {
      if (!texture.destroyed) texture.destroy(true);
    }
    iconTextures.clear();
  });
}

function makeText(
  text: string,
  fontSize: number,
  fill: number = COLORS.paper,
  fontWeight: '400' | '500' | '600' | '700' = '500',
): Text {
  return new Text({
    text,
    style: {
      fontFamily: FONT_FAMILY,
      fontSize,
      fontWeight,
      fill,
      letterSpacing: 0,
    },
  });
}

export interface IconSpriteOptions {
  icon: IconName | string;
  size?: number;
  color?: number;
}

export class IconSprite extends Sprite {
  private iconName: string;
  private iconWidth: number;
  private iconHeight: number;

  constructor(icon: IconName | string, size?: number, color?: number);
  constructor(options: IconSpriteOptions);
  constructor(
    iconOrOptions: IconName | string | IconSpriteOptions,
    size = 18,
    color = COLORS.paper,
  ) {
    const options =
      typeof iconOrOptions === 'string'
        ? { icon: iconOrOptions, size, color }
        : {
            icon: iconOrOptions.icon,
            size: iconOrOptions.size ?? 18,
            color: iconOrOptions.color ?? COLORS.paper,
          };
    super({ texture: textureForIcon(options.icon) });
    this.iconName = options.icon;
    this.iconWidth = options.size;
    this.iconHeight = options.size;
    this.tint = options.color;
    this.width = options.size;
    this.height = options.size;
  }

  setIcon(icon: IconName | string): void {
    if (icon === this.iconName) return;
    this.iconName = icon;
    this.texture = textureForIcon(icon);
    this.width = this.iconWidth;
    this.height = this.iconHeight;
  }

  setColor(color: number): void {
    this.tint = color;
  }

  override setSize(value: SizeValue, height?: number): void {
    const size = resolveSize(value, height, this.iconHeight);
    this.iconWidth = Math.max(1, size.width);
    this.iconHeight = Math.max(1, size.height);
    this.width = this.iconWidth;
    this.height = this.iconHeight;
  }

  override destroy(options?: Parameters<Sprite['destroy']>[0]): void {
    // Icon textures are shared by every instance and owned by this module-level cache.
    const safeOptions =
      options === true
        ? { children: true, texture: false, textureSource: false }
        : options && typeof options === 'object'
          ? { ...options, texture: false, textureSource: false }
          : options;
    super.destroy(safeOptions);
  }
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface CanvasButtonOptions {
  label: string;
  icon?: IconName | string;
  width?: number;
  height?: number;
  variant?: ButtonVariant;
  accent?: number;
  iconOnly?: boolean;
  tooltip?: string;
  disabled?: boolean;
  selected?: boolean;
  onPress?: (button: CanvasButton) => void;
}

const ACTION_ICONS: ReadonlyArray<[RegExp, IconName]> = [
  [/返回|后退|back/i, 'arrow-left'],
  [/下一步|继续|next/i, 'arrow-right'],
  [/保存|save/i, 'save'],
  [/下载|导出|download|export/i, 'download'],
  [/上传|导入|upload|import/i, 'upload'],
  [/生成|创作|generate|create/i, 'wand-sparkles'],
  [/搜索|查找|search/i, 'search'],
  [/删除|移除|delete|remove/i, 'trash-2'],
  [/发送|发布|send|publish/i, 'send'],
  [/设置|settings?/i, 'settings'],
  [/添加|新增|add/i, 'plus'],
  [/完成|确认|确定|done|confirm/i, 'check'],
];

function inferredIcon(label: string): IconName | undefined {
  return ACTION_ICONS.find(([pattern]) => pattern.test(label))?.[1];
}

export class CanvasButton extends Container {
  private readonly background = new Graphics();
  private readonly material = new EasternMaterialLayer('silk-brocade', 'notched', 0.1);
  private readonly labelText = makeText('', 14, COLORS.paper, '600');
  private iconSprite?: IconSprite;
  private controlWidth: number;
  private controlHeight: number;
  private variant: ButtonVariant;
  private accent: number;
  private iconName?: IconName | string;
  private buttonLabel: string;
  private semanticLabel: string;
  private iconWasExplicit: boolean;
  private iconOnly: boolean;
  private disabled = false;
  private selected = false;
  private hovered = false;
  private pressed = false;
  private onPress?: (button: CanvasButton) => void;
  readonly tooltip?: string;
  private readonly detachInteractionHint: () => void;

  constructor(options: CanvasButtonOptions | string, onPress?: () => void) {
    super();
    const settings: CanvasButtonOptions =
      typeof options === 'string'
        ? { label: options, onPress: onPress ? () => onPress() : undefined }
        : options;

    this.controlHeight = Math.max(32, settings.height ?? 40);
    this.iconOnly = settings.iconOnly ?? !settings.label;
    this.controlWidth = Math.max(
      this.iconOnly ? this.controlHeight : 72,
      settings.width ?? (this.iconOnly ? this.controlHeight : 112),
    );
    this.variant = settings.variant ?? 'secondary';
    this.accent = settings.accent ?? COLORS.jade;
    this.buttonLabel = settings.label;
    this.semanticLabel = settings.label.trim();
    this.iconWasExplicit = Boolean(settings.icon);
    this.iconName = settings.icon ?? inferredIcon(settings.label);
    this.tooltip = settings.tooltip;
    this.onPress = settings.onPress;
    this.selected = settings.selected ?? false;

    this.addChild(this.background, this.material, this.labelText);
    if (this.iconName) {
      this.iconSprite = new IconSprite(this.iconName, 17);
      this.addChild(this.iconSprite);
    }

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerover', this.handlePointerOver);
    this.on('pointerout', this.handlePointerOut);
    this.on('pointerdown', this.handlePointerDown);
    this.on('pointerup', this.handlePointerUp);
    this.on('pointerupoutside', this.handlePointerUpOutside);
    this.on('pointertap', this.handleTap);
    this.detachInteractionHint = attachInteractionHint(
      this,
      () => {
        const action = this.tooltip || this.semanticLabel || this.buttonLabel || '执行操作';
        return this.disabled ? `暂不可用：${action}` : action;
      },
    );
    this.setLabel(settings.label);
    this.setDisabled(settings.disabled ?? false);
  }

  private handlePointerOver = (): void => {
    if (this.disabled) return;
    this.hovered = true;
    this.draw();
  };

  private handlePointerOut = (): void => {
    this.hovered = false;
    this.pressed = false;
    this.draw();
  };

  private handlePointerDown = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
    if (this.disabled) return;
    this.pressed = true;
    this.draw();
  };

  private handlePointerUp = (): void => {
    this.pressed = false;
    this.draw();
  };

  private handlePointerUpOutside = (): void => {
    this.pressed = false;
    this.draw();
  };

  private handleTap = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
    if (this.disabled) return;
    this.onPress?.(this);
  };

  private draw(): void {
    let backgroundColor: number = EASTERN_UI.lacquerRaised;
    let backgroundAlpha = 1;
    let borderColor: number = EASTERN_UI.gilt;
    let borderAlpha = 0.5;
    let foregroundColor: number = COLORS.paper;
    let accentAlpha = 0.28;

    if (this.variant === 'primary') {
      backgroundColor = EASTERN_UI.cinnabarDeep;
      foregroundColor = COLORS.paper;
      borderColor = EASTERN_UI.giltBright;
      borderAlpha = 0.9;
      accentAlpha = 0.86;
    } else if (this.variant === 'ghost') {
      backgroundColor = this.hovered || this.selected ? EASTERN_UI.lacquerRaised : EASTERN_UI.lacquerDeep;
      backgroundAlpha = this.hovered || this.selected ? 0.9 : 0;
      foregroundColor = this.selected ? this.accent : COLORS.paperMuted;
      borderColor = this.selected ? this.accent : EASTERN_UI.gilt;
      borderAlpha = this.hovered || this.selected ? 0.58 : 0;
      accentAlpha = this.hovered || this.selected ? 0.56 : 0;
    } else if (this.variant === 'danger') {
      backgroundColor = 0x4a171a;
      backgroundAlpha = this.hovered ? 0.92 : 0.78;
      foregroundColor = this.hovered ? COLORS.paper : COLORS.coral;
      borderColor = COLORS.danger;
      borderAlpha = this.hovered ? 0.9 : 0.62;
      accentAlpha = 0.62;
    }

    if (this.selected && this.variant !== 'primary') {
      backgroundColor = this.accent;
      backgroundAlpha = this.hovered ? 0.25 : 0.17;
      borderColor = this.accent;
      borderAlpha = 0.84;
      foregroundColor = this.accent;
      accentAlpha = 0.88;
    }
    if (this.hovered && this.variant === 'secondary') {
      borderColor = this.accent;
      borderAlpha = 0.86;
      accentAlpha = 0.72;
    }
    if (this.pressed) backgroundAlpha *= 0.78;

    drawEasternFrame(this.background, 0, 0, this.controlWidth, this.controlHeight, {
      fillColor: backgroundColor,
      fillAlpha: backgroundAlpha,
      borderColor,
      borderAlpha,
      accentColor: this.accent,
      accentAlpha,
      innerAlpha: this.variant === 'ghost' && !this.hovered && !this.selected ? 0 : 0.16,
      notch: Math.min(6, this.controlHeight * 0.15),
    });

    const materialKind: EasternMaterialKind =
      this.variant === 'primary' || this.variant === 'danger'
        ? 'lacquer-gilt'
        : this.variant === 'ghost'
          ? 'xuan-ink'
          : 'silk-brocade';
    const baseMaterialOpacity =
      this.variant === 'primary'
        ? 0.17
        : this.variant === 'danger'
          ? 0.12
          : this.variant === 'ghost'
            ? this.hovered || this.selected
              ? 0.09
              : 0.018
            : this.hovered || this.selected
              ? 0.13
              : 0.09;
    this.material.setMaterial(materialKind);
    this.material.setOpacity(baseMaterialOpacity * (this.pressed ? 0.72 : 1));
    this.material.setFrame(
      0,
      0,
      this.controlWidth,
      this.controlHeight,
      Math.min(6, this.controlHeight * 0.15),
    );

    this.labelText.style.fill = foregroundColor;
    this.iconSprite?.setColor(foregroundColor);
    this.alpha = this.disabled ? 0.42 : 1;
    this.hitArea = new Rectangle(0, 0, this.controlWidth, this.controlHeight);
    this.layout();
  }

  private layout(): void {
    const hasIcon = Boolean(this.iconSprite);
    const iconSize = Math.min(18, this.controlHeight - 14);
    const gap = hasIcon && !this.iconOnly ? 7 : 0;
    const availableTextWidth = Math.max(0, this.controlWidth - 24 - (hasIcon ? iconSize + gap : 0));
    this.labelText.text = truncateLabel(this.buttonLabel, availableTextWidth, 14, '600');
    const contentWidth =
      (hasIcon ? iconSize : 0) + (this.iconOnly ? 0 : this.labelText.width + gap);
    let cursorX = Math.round((this.controlWidth - contentWidth) / 2);

    if (this.iconSprite) {
      this.iconSprite.setSize(iconSize);
      this.iconSprite.position.set(cursorX, Math.round((this.controlHeight - iconSize) / 2));
      cursorX += iconSize + gap;
    }
    this.labelText.visible = !this.iconOnly;
    this.labelText.position.set(cursorX, Math.round((this.controlHeight - this.labelText.height) / 2));
  }

  setLabel(label: string): void {
    this.buttonLabel = label;
    if (label.trim()) this.semanticLabel = label.trim();
    if (!this.iconWasExplicit) this.applyIcon(inferredIcon(label));
    this.draw();
  }

  setIconOnly(iconOnly: boolean): void {
    if (this.iconOnly === iconOnly) return;
    this.iconOnly = iconOnly;
    this.draw();
  }

  private applyIcon(icon?: IconName | string): void {
    this.iconName = icon;
    if (!icon) {
      if (this.iconSprite) {
        this.removeChild(this.iconSprite);
        this.iconSprite.destroy();
        this.iconSprite = undefined;
      }
      return;
    }
    if (!this.iconSprite) {
      this.iconSprite = new IconSprite(icon, 17);
      this.addChild(this.iconSprite);
    } else {
      this.iconSprite.setIcon(icon);
    }
  }

  setIcon(icon?: IconName | string): void {
    this.iconWasExplicit = Boolean(icon);
    this.applyIcon(icon);
    this.draw();
  }

  setOnPress(callback?: (button: CanvasButton) => void): void {
    this.onPress = callback;
  }

  setVariant(variant: ButtonVariant, accent = this.accent): void {
    this.variant = variant;
    this.accent = accent;
    this.draw();
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.draw();
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.eventMode = 'static';
    this.cursor = disabled ? 'not-allowed' : 'pointer';
    this.hovered = false;
    this.pressed = false;
    if (disabled) hideInteractionHint(this);
    this.draw();
  }

  override setSize(value: SizeValue, height?: number): void {
    const size = resolveSize(value, height, this.controlHeight);
    this.controlWidth = Math.max(this.iconOnly ? 32 : 72, size.width);
    this.controlHeight = Math.max(32, size.height);
    this.draw();
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.detachInteractionHint();
    super.destroy(options ?? { children: true });
  }
}

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  icon?: IconName | string;
}

export interface SegmentedControlOptions<T extends string = string> {
  items?: Array<SegmentOption<T>>;
  options?: Array<SegmentOption<T>>;
  value?: T;
  width?: number;
  height?: number;
  accent?: number;
  disabled?: boolean;
  onChange?: (value: T, index: number) => void;
}

interface SegmentView<T extends string> {
  option: SegmentOption<T>;
  container: Container;
  background: Graphics;
  material: EasternMaterialLayer;
  label: Text;
  icon?: IconSprite;
}

export class SegmentedControl<T extends string = string> extends Container {
  private readonly shell = new Graphics();
  private readonly shellMaterial = new EasternMaterialLayer('xuan-ink', 'notched', 0.07);
  private segments: Array<SegmentView<T>> = [];
  private items: Array<SegmentOption<T>>;
  private currentValue: T;
  private controlWidth: number;
  private controlHeight: number;
  private accent: number;
  private disabled = false;
  private onChange?: (value: T, index: number) => void;

  constructor(options: SegmentedControlOptions<T> | Array<SegmentOption<T>>) {
    super();
    const settings: SegmentedControlOptions<T> = Array.isArray(options) ? { items: options } : options;
    this.items = settings.items ?? settings.options ?? [];
    if (this.items.length === 0) throw new Error('SegmentedControl requires at least one item.');
    this.currentValue = settings.value ?? this.items[0].value;
    this.controlWidth = Math.max(96, settings.width ?? this.items.length * 108);
    this.controlHeight = Math.max(32, settings.height ?? 38);
    this.accent = settings.accent ?? COLORS.jade;
    this.onChange = settings.onChange;
    this.addChild(this.shell, this.shellMaterial);
    this.rebuild();
    this.setDisabled(settings.disabled ?? false);
  }

  private rebuild(): void {
    for (const segment of this.segments) {
      this.removeChild(segment.container);
      segment.container.destroy({ children: true });
    }
    this.segments = this.items.map((option, index) => {
      const container = new Container();
      const background = new Graphics();
      const material = new EasternMaterialLayer('silk-brocade', 'notched', 0.05);
      const label = makeText(option.label, 13, COLORS.paperMuted, '600');
      const icon = option.icon ? new IconSprite(option.icon, 15, COLORS.paperMuted) : undefined;
      container.addChild(background, material);
      if (icon) container.addChild(icon);
      container.addChild(label);
      container.eventMode = 'static';
      container.cursor = 'pointer';
      container.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation();
        if (this.disabled) return;
        this.setValue(option.value, true);
      });
      container.on('pointerover', () => {
        if (!this.disabled && option.value !== this.currentValue) background.alpha = 1;
      });
      container.on('pointerout', () => {
        background.alpha = option.value === this.currentValue ? 1 : 0.72;
      });
      attachInteractionHint(
        container,
        () => this.disabled ? `暂不可用：选择${option.label}` : `选择${option.label}`,
      );
      this.addChild(container);
      return { option, container, background, material, label, icon };
    });
    this.draw();
  }

  private draw(): void {
    drawEasternFrame(this.shell, 0, 0, this.controlWidth, this.controlHeight, {
      fillColor: EASTERN_UI.lacquerDeep,
      borderColor: EASTERN_UI.gilt,
      borderAlpha: 0.48,
      accentColor: EASTERN_UI.porcelain,
      accentAlpha: 0.32,
      innerAlpha: 0.12,
      notch: 5,
    });
    this.shellMaterial.setFrame(0, 0, this.controlWidth, this.controlHeight, 5);

    const segmentWidth = this.controlWidth / this.segments.length;
    for (let index = 1; index < this.segments.length; index += 1) {
      const separatorX = Math.round(segmentWidth * index) + 0.5;
      this.shell
        .moveTo(separatorX, 8)
        .lineTo(separatorX, this.controlHeight - 8)
        .stroke({ color: EASTERN_UI.porcelain, alpha: 0.26, width: 1 });
    }
    this.segments.forEach((segment, index) => {
      const selected = segment.option.value === this.currentValue;
      segment.container.cursor = this.disabled ? 'not-allowed' : 'pointer';
      const width = index === this.segments.length - 1 ? this.controlWidth - segmentWidth * index : segmentWidth;
      segment.container.position.set(segmentWidth * index, 0);
      segment.container.hitArea = new Rectangle(0, 0, width, this.controlHeight);
      // Disabled choices still need a hit target so the user can see why they
      // cannot be selected. The tap handler above already blocks the action.
      segment.container.eventMode = 'static';
      drawEasternFrame(segment.background, 3, 3, width - 6, this.controlHeight - 6, {
        fillColor: selected ? this.accent : EASTERN_UI.lacquerRaised,
        fillAlpha: selected ? 0.19 : 0.12,
        borderColor: selected ? this.accent : EASTERN_UI.gilt,
        borderAlpha: selected ? 0.76 : 0,
        accentColor: selected ? this.accent : EASTERN_UI.porcelain,
        accentAlpha: selected ? 0.76 : 0,
        innerAlpha: selected ? 0.12 : 0,
        notch: 4,
      });
      segment.background.alpha = selected ? 1 : 0.72;
      segment.material.setMaterial(selected ? 'mineral-patina' : 'silk-brocade');
      segment.material.setOpacity(selected ? 0.13 : 0.045);
      segment.material.setFrame(3, 3, width - 6, this.controlHeight - 6, 4);

      const foreground = selected ? this.accent : COLORS.paperMuted;
      const iconSize = segment.icon ? 15 : 0;
      const gap = segment.icon ? 6 : 0;
      const maxTextWidth = Math.max(0, width - 18 - iconSize - gap);
      segment.label.text = truncateLabel(segment.option.label, maxTextWidth, 13, '600');
      segment.label.style.fill = foreground;
      segment.icon?.setColor(foreground);
      const contentWidth = iconSize + gap + segment.label.width;
      let x = Math.round((width - contentWidth) / 2);
      if (segment.icon) {
        segment.icon.position.set(x, Math.round((this.controlHeight - iconSize) / 2));
        x += iconSize + gap;
      }
      segment.label.position.set(x, Math.round((this.controlHeight - segment.label.height) / 2));
    });
    this.alpha = this.disabled ? 0.42 : 1;
  }

  get value(): T {
    return this.currentValue;
  }

  setValue(value: T, emit = false): void {
    const index = this.items.findIndex((item) => item.value === value);
    if (index < 0 || value === this.currentValue) return;
    this.currentValue = value;
    this.draw();
    if (emit) this.onChange?.(value, index);
  }

  setOptions(items: Array<SegmentOption<T>>, value?: T): void {
    if (items.length === 0) return;
    this.items = items;
    this.currentValue = value && items.some((item) => item.value === value) ? value : items[0].value;
    this.rebuild();
  }

  setOnChange(callback?: (value: T, index: number) => void): void {
    this.onChange = callback;
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.segments.forEach((segment) => hideInteractionHint(segment.container));
    this.draw();
  }

  override setSize(value: SizeValue, height?: number): void {
    const size = resolveSize(value, height, this.controlHeight);
    this.controlWidth = Math.max(96, size.width);
    this.controlHeight = Math.max(32, size.height);
    this.draw();
  }
}

export interface CanvasInputOptions {
  value?: string;
  placeholder?: string;
  label?: string;
  ariaLabel?: string;
  icon?: IconName | string;
  width?: number;
  height?: number;
  multiline?: boolean;
  secure?: boolean;
  maxLength?: number;
  disabled?: boolean;
  accent?: number;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export class CanvasInput extends Container {
  private static active?: CanvasInput;

  private readonly background = new Graphics();
  private readonly material = new EasternMaterialLayer('xuan-ink', 'notched', 0.11);
  private readonly focusGlow = new Graphics();
  private readonly contentMask = new Graphics();
  private readonly caret = new Graphics();
  private readonly valueText = makeText('', 14, COLORS.paper, '500');
  private readonly placeholderText = makeText('', 14, COLORS.paperFaint, '500');
  private readonly labelText = makeText('', 12, COLORS.paperMuted, '600');
  private iconSprite?: IconSprite;
  private bridge?: HTMLInputElement | HTMLTextAreaElement;
  private controlWidth: number;
  private controlHeight: number;
  private fieldY = 0;
  private fieldHeight = 42;
  private inputValue: string;
  private placeholder: string;
  private fieldLabel: string;
  private ariaLabel: string;
  private multiline: boolean;
  private secure: boolean;
  private revealSecure = false;
  private maxLength: number;
  private disabled = false;
  private focused = false;
  private hovered = false;
  private composing = false;
  private focusStartValue = '';
  private accent: number;
  private onInput?: (value: string) => void;
  private onChange?: (value: string) => void;
  private onSubmit?: (value: string) => void;
  private onFocus?: () => void;
  private onBlur?: () => void;
  private readonly detachInteractionHint: () => void;

  constructor(options: CanvasInputOptions = {}) {
    super();
    this.fieldLabel = options.label ?? '';
    this.inputValue = options.value ?? '';
    this.placeholder = options.placeholder ?? '';
    this.ariaLabel = options.ariaLabel || this.fieldLabel || this.placeholder || '画布文本输入';
    this.multiline = options.multiline ?? false;
    this.secure = options.secure ?? false;
    this.maxLength = Math.max(1, options.maxLength ?? 240);
    this.controlWidth = Math.max(120, options.width ?? 280);
    this.controlHeight = Math.max(
      this.fieldLabel ? 60 : 38,
      options.height ?? (this.fieldLabel ? 64 : 42),
    );
    this.accent = options.accent ?? COLORS.jade;
    this.onInput = options.onInput;
    this.onChange = options.onChange;
    this.onSubmit = options.onSubmit;
    this.onFocus = options.onFocus;
    this.onBlur = options.onBlur;

    this.addChild(
      this.focusGlow,
      this.background,
      this.material,
      this.labelText,
      this.placeholderText,
      this.valueText,
      this.caret,
      this.contentMask,
    );
    this.valueText.mask = this.contentMask;
    this.placeholderText.mask = this.contentMask;
    if (options.icon) {
      this.iconSprite = new IconSprite(options.icon, 17, COLORS.paperFaint);
      this.addChildAt(this.iconSprite, this.getChildIndex(this.placeholderText));
    }

    this.eventMode = 'static';
    this.cursor = 'text';
    this.on('pointerover', this.handlePointerOver);
    this.on('pointerout', this.handlePointerOut);
    this.on('pointertap', this.handleTap);
    this.detachInteractionHint = attachInteractionHint(
      this,
      () => {
        const action = `编辑${this.fieldLabel || this.placeholder || '文本内容'}`;
        return this.disabled ? `暂不可用：${action}` : action;
      },
    );
    this.draw();
    this.setDisabled(options.disabled ?? false);
  }

  private handleTap = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
    if (this.disabled) return;
    this.focus();
  };

  private handlePointerOver = (): void => {
    if (this.disabled) return;
    this.hovered = true;
    this.draw();
  };

  private handlePointerOut = (): void => {
    this.hovered = false;
    this.draw();
  };

  private handleBridgeInput = (): void => {
    if (!this.bridge) return;
    this.setValue(this.bridge.value, true);
  };

  private handleCompositionStart = (): void => {
    this.composing = true;
  };

  private handleCompositionEnd = (): void => {
    this.composing = false;
    this.handleBridgeInput();
  };

  private handleBridgeBlur = (): void => {
    this.finishFocus();
  };

  private handleBridgeKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.setValue(this.focusStartValue, true);
      this.blur();
      return;
    }
    if (event.key === 'Enter' && !this.multiline && !this.composing) {
      event.preventDefault();
      this.onSubmit?.(this.inputValue);
      this.blur();
    }
  };

  private connectBridge(): HTMLInputElement | HTMLTextAreaElement | undefined {
    const bridge = this.multiline
      ? document.querySelector<HTMLTextAreaElement>('#ime-bridge') ?? undefined
      : document.querySelector<HTMLInputElement>('#ime-input-bridge') ?? undefined;
    if (!bridge) return undefined;
    this.bridge = bridge;
    bridge.autocomplete = this.secure ? 'new-password' : 'off';
    if (bridge instanceof HTMLInputElement) {
      bridge.type = this.secure && !this.revealSecure ? 'password' : 'text';
    }
    bridge.maxLength = this.maxLength;
    bridge.setAttribute('aria-label', this.ariaLabel);
    bridge.value = this.inputValue;
    bridge.removeAttribute('aria-hidden');
    bridge.addEventListener('input', this.handleBridgeInput);
    bridge.addEventListener('compositionstart', this.handleCompositionStart);
    bridge.addEventListener('compositionend', this.handleCompositionEnd);
    bridge.addEventListener('keydown', this.handleBridgeKeyDown);
    bridge.addEventListener('blur', this.handleBridgeBlur);
    return bridge;
  }

  private disconnectBridge(): void {
    if (!this.bridge) return;
    const bridge = this.bridge;
    bridge.removeEventListener('input', this.handleBridgeInput);
    bridge.removeEventListener('compositionstart', this.handleCompositionStart);
    bridge.removeEventListener('compositionend', this.handleCompositionEnd);
    bridge.removeEventListener('keydown', this.handleBridgeKeyDown);
    bridge.removeEventListener('blur', this.handleBridgeBlur);
    bridge.setAttribute('aria-hidden', 'true');
    bridge.value = '';
    bridge.removeAttribute('maxlength');
    bridge.setAttribute(
      'aria-label',
      bridge instanceof HTMLInputElement ? '画布单行文本输入' : '画布多行文本输入',
    );
    bridge.autocomplete = 'off';
    if (bridge instanceof HTMLInputElement) bridge.type = 'text';
    this.bridge = undefined;
  }

  private finishFocus(): void {
    if (!this.focused) return;
    this.disconnectBridge();
    this.focused = false;
    this.composing = false;
    if (CanvasInput.active === this) CanvasInput.active = undefined;
    this.draw();
    if (this.inputValue !== this.focusStartValue) this.onChange?.(this.inputValue);
    this.onBlur?.();
  }

  private draw(): void {
    const labelHeight = this.fieldLabel ? 18 : 0;
    this.fieldY = labelHeight;
    this.fieldHeight = Math.max(34, this.controlHeight - labelHeight);
    const borderColor = this.focused
      ? this.accent
      : this.hovered
        ? EASTERN_UI.giltBright
        : EASTERN_UI.gilt;
    const iconOffset = this.iconSprite ? 27 : 0;
    const contentX = 12 + iconOffset;
    const contentWidth = Math.max(1, this.controlWidth - contentX - 12);

    drawEasternFrame(this.focusGlow, -2, this.fieldY - 2, this.controlWidth + 4, this.fieldHeight + 4, {
      fillColor: EASTERN_UI.lacquer,
      fillAlpha: 0,
      borderColor: this.accent,
      borderAlpha: this.focused ? 0.22 : 0,
      borderWidth: 3,
      innerAlpha: 0,
      notch: 7,
    });
    drawEasternFrame(this.background, 0, this.fieldY, this.controlWidth, this.fieldHeight, {
      fillColor: EASTERN_UI.lacquerRaised,
      borderColor,
      borderAlpha: this.focused ? 0.88 : this.hovered ? 0.72 : 0.48,
      borderWidth: this.focused ? 1.4 : this.hovered ? 1.2 : 1,
      accentColor: this.focused ? this.accent : EASTERN_UI.porcelain,
      accentAlpha: this.focused ? 0.8 : 0.3,
      innerAlpha: this.focused ? 0.18 : 0.1,
      notch: 6,
    });
    this.material.setOpacity(this.focused ? 0.16 : this.hovered ? 0.14 : 0.11);
    this.material.setFrame(0, this.fieldY, this.controlWidth, this.fieldHeight, 6);
    this.background
      .moveTo(10, this.fieldY + this.fieldHeight - 3)
      .lineTo(this.controlWidth - 10, this.fieldY + this.fieldHeight - 3)
      .stroke({ color: EASTERN_UI.porcelain, alpha: this.focused ? 0.22 : 0.1, width: 0.7 });

    this.labelText.text = truncateLabel(this.fieldLabel, this.controlWidth, 12, '600');
    this.labelText.visible = Boolean(this.fieldLabel);
    this.labelText.position.set(1, 0);
    this.labelText.style.fill = this.focused ? EASTERN_UI.giltBright : COLORS.paperMuted;
    this.placeholderText.text = truncateLabel(this.placeholder, contentWidth, 14);
    const keepEnd = this.focused && !this.multiline;
    const visibleValue = this.secure && !this.revealSecure
      ? '\u2022'.repeat(Math.min(24, Array.from(this.inputValue).length))
      : this.inputValue;
    this.valueText.text = this.multiline
      ? visibleValue
      : truncateLabel(visibleValue, contentWidth, 14, '500', keepEnd);
    this.valueText.style.wordWrap = this.multiline;
    this.valueText.style.breakWords = this.multiline;
    this.valueText.style.wordWrapWidth = contentWidth;
    this.placeholderText.visible = !this.inputValue;
    this.valueText.visible = Boolean(this.inputValue);

    const textY = this.multiline
      ? this.fieldY + 9
      : Math.round(this.fieldY + (this.fieldHeight - this.valueText.height) / 2);
    const placeholderY = Math.round(this.fieldY + (this.fieldHeight - this.placeholderText.height) / 2);
    this.valueText.position.set(contentX, textY);
    this.placeholderText.position.set(contentX, placeholderY);
    if (this.iconSprite) {
      this.iconSprite.position.set(12, Math.round(this.fieldY + (this.fieldHeight - 17) / 2));
      this.iconSprite.setColor(this.focused ? this.accent : COLORS.paperFaint);
    }

    this.contentMask
      .clear()
      .rect(contentX, this.fieldY + 5, contentWidth, this.fieldHeight - 10)
      .fill({ color: COLORS.white });
    const caretX = Math.min(contentX + contentWidth, contentX + this.valueText.width + 1);
    this.caret
      .clear()
      .rect(caretX, this.fieldY + 10, 1, Math.max(14, this.fieldHeight - 20))
      .fill({ color: this.accent, alpha: this.focused ? 1 : 0 });

    this.hitArea = new Rectangle(0, this.fieldY, this.controlWidth, this.fieldHeight);
    this.alpha = this.disabled ? 0.42 : 1;
  }

  get value(): string {
    return this.inputValue;
  }

  get isFocused(): boolean {
    return this.focused;
  }

  focus(): void {
    if (this.disabled || this.focused) return;
    CanvasInput.active?.blur();
    CanvasInput.active = this;
    this.focused = true;
    this.focusStartValue = this.inputValue;
    this.draw();
    const bridge = this.connectBridge();
    if (bridge) {
      bridge.focus({ preventScroll: true });
      const end = bridge.value.length;
      bridge.setSelectionRange(end, end);
    }
    this.onFocus?.();
  }

  blur(): void {
    if (!this.focused) return;
    if (this.bridge && document.activeElement === this.bridge) {
      this.bridge.blur();
    } else {
      this.finishFocus();
    }
  }

  setValue(value: string, emit = false): void {
    const nextValue = Array.from(value).slice(0, this.maxLength).join('');
    if (nextValue === this.inputValue) return;
    this.inputValue = nextValue;
    if (this.bridge && this.bridge.value !== nextValue) this.bridge.value = nextValue;
    this.draw();
    if (emit) this.onInput?.(nextValue);
  }

  setPlaceholder(placeholder: string): void {
    this.placeholder = placeholder;
    this.draw();
  }

  setSecure(secure: boolean): void {
    this.secure = secure;
    if (!secure) this.revealSecure = false;
    if (this.bridge instanceof HTMLInputElement) {
      this.bridge.type = this.secure && !this.revealSecure ? 'password' : 'text';
      this.bridge.autocomplete = this.secure ? 'new-password' : 'off';
    }
    this.draw();
  }

  setSecureReveal(reveal: boolean): void {
    this.revealSecure = this.secure && reveal;
    if (this.bridge instanceof HTMLInputElement) {
      this.bridge.type = this.secure && !this.revealSecure ? 'password' : 'text';
    }
    this.draw();
  }

  setLabel(label: string): void {
    this.fieldLabel = label;
    this.draw();
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.hovered = false;
    if (disabled) hideInteractionHint(this);
    if (disabled) this.blur();
    this.eventMode = 'static';
    this.cursor = disabled ? 'not-allowed' : 'text';
    this.draw();
  }

  override setSize(value: SizeValue, height?: number): void {
    const size = resolveSize(value, height, this.controlHeight);
    this.controlWidth = Math.max(120, size.width);
    this.controlHeight = Math.max(this.fieldLabel ? 60 : 38, size.height);
    this.draw();
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.detachInteractionHint();
    if (this.focused) this.blur();
    this.disconnectBridge();
    super.destroy(options);
  }
}

export interface CanvasSliderOptions {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  label?: string;
  width?: number;
  height?: number;
  accent?: number;
  disabled?: boolean;
  formatValue?: (value: number) => string;
  onInput?: (value: number) => void;
  onChange?: (value: number) => void;
}

export class CanvasSlider extends Container {
  private readonly track = new Graphics();
  private readonly material = new EasternMaterialLayer('mineral-patina', 'rounded', 0.15);
  private readonly progress = new Graphics();
  private readonly thumb = new Graphics();
  private readonly labelText = makeText('', 12, COLORS.paperMuted, '600');
  private readonly valueText = makeText('', 12, COLORS.paper, '600');
  private controlWidth: number;
  private controlHeight: number;
  private min: number;
  private max: number;
  private step: number;
  private currentValue: number;
  private sliderLabel: string;
  private accent: number;
  private disabled = false;
  private dragging = false;
  private hovered = false;
  private dragStartValue = 0;
  private formatValue: (value: number) => string;
  private onInput?: (value: number) => void;
  private onChange?: (value: number) => void;
  private readonly detachInteractionHint: () => void;

  constructor(options: CanvasSliderOptions = {}) {
    super();
    this.min = options.min ?? 0;
    this.max = Math.max(this.min, options.max ?? 100);
    this.step = Math.max(Number.EPSILON, options.step ?? 1);
    this.currentValue = this.snap(options.value ?? this.min);
    this.sliderLabel = options.label ?? '';
    this.controlWidth = Math.max(100, options.width ?? 240);
    this.controlHeight = Math.max(
      this.sliderLabel ? 38 : 24,
      options.height ?? (this.sliderLabel ? 44 : 28),
    );
    this.accent = options.accent ?? COLORS.jade;
    this.formatValue = options.formatValue ?? ((value) => String(value));
    this.onInput = options.onInput;
    this.onChange = options.onChange;
    this.addChild(this.track, this.material, this.progress, this.thumb, this.labelText, this.valueText);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerdown', this.handlePointerDown);
    this.on('pointerover', this.handlePointerOver);
    this.on('pointerout', this.handlePointerOut);
    this.on('globalpointermove', this.handlePointerMove);
    this.on('pointerup', this.handlePointerUp);
    this.on('pointerupoutside', this.handlePointerUp);
    this.detachInteractionHint = attachInteractionHint(
      this,
      () => {
        const action = `调整${this.sliderLabel || '数值'}`;
        return this.disabled ? `暂不可用：${action}` : action;
      },
    );
    this.draw();
    this.setDisabled(options.disabled ?? false);
  }

  private snap(value: number): number {
    const clamped = Math.min(this.max, Math.max(this.min, value));
    const steps = Math.round((clamped - this.min) / this.step);
    const precision = Math.min(8, Math.max(0, (String(this.step).split('.')[1] ?? '').length));
    return Number(Math.min(this.max, this.min + steps * this.step).toFixed(precision));
  }

  private updateFromEvent(event: FederatedPointerEvent, emit: boolean): void {
    const local = event.getLocalPosition(this);
    const inset = 8;
    const ratio = Math.min(1, Math.max(0, (local.x - inset) / Math.max(1, this.controlWidth - inset * 2)));
    const value = this.snap(this.min + ratio * (this.max - this.min));
    this.setValue(value, emit);
  }

  private handlePointerDown = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
    if (this.disabled) return;
    this.dragging = true;
    this.dragStartValue = this.currentValue;
    this.updateFromEvent(event, true);
    this.draw();
  };

  private handlePointerOver = (): void => {
    if (this.disabled) return;
    this.hovered = true;
    this.draw();
  };

  private handlePointerOut = (): void => {
    this.hovered = false;
    if (!this.dragging) this.draw();
  };

  private handlePointerMove = (event: FederatedPointerEvent): void => {
    if (!this.dragging || this.disabled) return;
    this.updateFromEvent(event, true);
  };

  private handlePointerUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.draw();
    if (this.currentValue !== this.dragStartValue) this.onChange?.(this.currentValue);
  };

  private draw(): void {
    const inset = 8;
    const usableWidth = Math.max(1, this.controlWidth - inset * 2);
    const ratio = this.max === this.min ? 0 : (this.currentValue - this.min) / (this.max - this.min);
    const trackY = this.sliderLabel ? this.controlHeight - 10 : Math.round(this.controlHeight / 2);
    const thumbX = inset + usableWidth * ratio;

    this.labelText.text = truncateLabel(this.sliderLabel, this.controlWidth - 64, 12, '600');
    this.labelText.visible = Boolean(this.sliderLabel);
    this.labelText.position.set(0, 0);
    this.labelText.style.fill = COLORS.paperMuted;
    this.valueText.text = this.formatValue(this.currentValue);
    this.valueText.anchor.set(1, 0);
    this.valueText.position.set(this.controlWidth, 0);
    this.valueText.visible = Boolean(this.sliderLabel);
    this.valueText.style.fill = EASTERN_UI.giltBright;

    this.track
      .clear()
      .roundRect(inset, trackY - 3, usableWidth, 6, 2)
      .fill({ color: EASTERN_UI.lacquerDeep })
      .stroke({
        color: this.hovered || this.dragging ? EASTERN_UI.giltBright : EASTERN_UI.gilt,
        alpha: this.hovered || this.dragging ? 0.76 : 0.48,
        width: this.hovered || this.dragging ? 1.25 : 1,
      })
      .circle(inset, trackY, 2.2)
      .circle(inset + usableWidth, trackY, 2.2)
      .fill({ color: EASTERN_UI.porcelain, alpha: 0.58 });
    this.material.setOpacity(this.dragging ? 0.2 : 0.15);
    this.material.setFrame(inset, trackY - 3, usableWidth, 6, 2, 'rounded');
    this.progress
      .clear()
      .roundRect(inset, trackY - 2, Math.max(2, usableWidth * ratio), 4, 1.5)
      .fill({ color: this.accent, alpha: 0.86 })
      .moveTo(inset + 2, trackY - 1)
      .lineTo(Math.max(inset + 2, thumbX - 2), trackY - 1)
      .stroke({ color: EASTERN_UI.giltBright, alpha: 0.5, width: 0.7 });
    const thumbRadius = this.dragging ? 8.5 : this.hovered ? 8 : 7;
    this.thumb.clear();
    traceOctagon(this.thumb, thumbX, trackY, thumbRadius)
      .fill({ color: COLORS.paper })
      .stroke({ color: EASTERN_UI.giltBright, alpha: 0.92, width: 1.4 });
    traceOctagon(this.thumb, thumbX, trackY, Math.max(2, thumbRadius - 3.2))
      .fill({ color: this.accent, alpha: 0.9 });

    this.hitArea = new Rectangle(0, 0, this.controlWidth, this.controlHeight);
    this.alpha = this.disabled ? 0.42 : 1;
  }

  get value(): number {
    return this.currentValue;
  }

  setValue(value: number, emit = false): void {
    const nextValue = this.snap(value);
    if (nextValue === this.currentValue) return;
    this.currentValue = nextValue;
    this.draw();
    if (emit) this.onInput?.(nextValue);
  }

  setRange(min: number, max: number, step = this.step): void {
    this.min = min;
    this.max = Math.max(min, max);
    this.step = Math.max(Number.EPSILON, step);
    this.currentValue = this.snap(this.currentValue);
    this.draw();
  }

  setLabel(label: string): void {
    this.sliderLabel = label;
    this.draw();
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.dragging = false;
    this.hovered = false;
    if (disabled) hideInteractionHint(this);
    this.eventMode = 'static';
    this.cursor = disabled ? 'not-allowed' : 'pointer';
    this.draw();
  }

  override setSize(value: SizeValue, height?: number): void {
    const size = resolveSize(value, height, this.controlHeight);
    this.controlWidth = Math.max(100, size.width);
    this.controlHeight = Math.max(this.sliderLabel ? 38 : 24, size.height);
    this.draw();
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.detachInteractionHint();
    super.destroy(options ?? { children: true });
  }
}

export interface ToggleOptions {
  label?: string;
  tooltip?: string;
  value?: boolean;
  checked?: boolean;
  width?: number;
  height?: number;
  accent?: number;
  disabled?: boolean;
  onChange?: (value: boolean) => void;
}

export class Toggle extends Container {
  private readonly track = new Graphics();
  private readonly material = new EasternMaterialLayer('lacquer-gilt', 'notched', 0.11);
  private readonly thumb = new Graphics();
  private readonly labelText = makeText('', 13, COLORS.paperMuted, '500');
  private controlWidth: number;
  private controlHeight: number;
  private toggleLabel: string;
  private readonly toggleTooltip?: string;
  private currentValue: boolean;
  private accent: number;
  private disabled = false;
  private hovered = false;
  private onChange?: (value: boolean) => void;
  private readonly detachInteractionHint: () => void;

  constructor(options: ToggleOptions = {}) {
    super();
    this.toggleLabel = options.label ?? '';
    this.toggleTooltip = options.tooltip;
    this.currentValue = options.value ?? options.checked ?? false;
    this.controlWidth = Math.max(
      this.toggleLabel ? 84 : 40,
      options.width ?? (this.toggleLabel ? 132 : 40),
    );
    this.controlHeight = Math.max(24, options.height ?? 30);
    this.accent = options.accent ?? COLORS.jade;
    this.onChange = options.onChange;
    this.addChild(this.labelText, this.track, this.material, this.thumb);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', this.handleTap);
    this.on('pointerover', this.handlePointerOver);
    this.on('pointerout', this.handlePointerOut);
    this.detachInteractionHint = attachInteractionHint(
      this,
      () => {
        const action = this.toggleTooltip || `切换${this.toggleLabel || '开关'}`;
        return this.disabled ? `暂不可用：${action}` : action;
      },
    );
    this.draw();
    this.setDisabled(options.disabled ?? false);
  }

  private handleTap = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
    if (this.disabled) return;
    this.setValue(!this.currentValue, true);
  };

  private handlePointerOver = (): void => {
    if (this.disabled) return;
    this.hovered = true;
    this.draw();
  };

  private handlePointerOut = (): void => {
    this.hovered = false;
    this.draw();
  };

  private draw(): void {
    const trackWidth = 40;
    const trackHeight = 22;
    const trackX = this.controlWidth - trackWidth;
    const trackY = Math.round((this.controlHeight - trackHeight) / 2);
    const thumbRadius = this.hovered ? 7.8 : 7;
    const thumbX = trackX + (this.currentValue ? trackWidth - 11 : 11);
    const thumbY = trackY + trackHeight / 2;

    this.labelText.text = truncateLabel(this.toggleLabel, Math.max(0, trackX - 10), 13, '500');
    this.labelText.visible = Boolean(this.toggleLabel);
    this.labelText.position.set(0, Math.round((this.controlHeight - this.labelText.height) / 2));
    this.labelText.style.fill = this.currentValue ? COLORS.paper : COLORS.paperMuted;
    this.track.clear();
    traceNotchedRect(this.track, trackX, trackY, trackWidth, trackHeight, 5)
      .fill({
        color: this.currentValue ? this.accent : EASTERN_UI.lacquerRaised,
        alpha: this.currentValue ? 0.72 : 1,
      })
      .stroke({
        color: this.currentValue || this.hovered ? EASTERN_UI.giltBright : EASTERN_UI.gilt,
        alpha: this.currentValue ? 0.88 : this.hovered ? 0.78 : 0.5,
        width: this.hovered ? 1.25 : 1,
      });
    this.track
      .moveTo(trackX + 8, thumbY)
      .lineTo(trackX + trackWidth - 8, thumbY)
      .stroke({ color: EASTERN_UI.porcelain, alpha: 0.24, width: 0.8 });
    this.material.setMaterial(this.currentValue ? 'mineral-patina' : 'lacquer-gilt');
    this.material.setOpacity(this.currentValue ? 0.17 : 0.11);
    this.material.setFrame(trackX, trackY, trackWidth, trackHeight, 5);
    this.thumb.clear();
    traceOctagon(this.thumb, thumbX, thumbY, thumbRadius)
      .fill({ color: this.currentValue ? COLORS.paper : COLORS.paperMuted })
      .stroke({ color: EASTERN_UI.giltBright, alpha: 0.86, width: 1 });
    traceOctagon(this.thumb, thumbX, thumbY, 2.4)
      .fill({ color: this.currentValue ? EASTERN_UI.cinnabarDeep : EASTERN_UI.porcelain, alpha: 0.9 });
    this.hitArea = new Rectangle(0, 0, this.controlWidth, this.controlHeight);
    this.alpha = this.disabled ? 0.42 : 1;
  }

  get value(): boolean {
    return this.currentValue;
  }

  get checked(): boolean {
    return this.currentValue;
  }

  setValue(value: boolean, emit = false): void {
    if (value === this.currentValue) return;
    this.currentValue = value;
    this.draw();
    if (emit) this.onChange?.(value);
  }

  setLabel(label: string): void {
    this.toggleLabel = label;
    this.draw();
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.hovered = false;
    if (disabled) hideInteractionHint(this);
    this.eventMode = 'static';
    this.cursor = disabled ? 'not-allowed' : 'pointer';
    this.draw();
  }

  override setSize(value: SizeValue, height?: number): void {
    const size = resolveSize(value, height, this.controlHeight);
    this.controlWidth = Math.max(this.toggleLabel ? 84 : 40, size.width);
    this.controlHeight = Math.max(24, size.height);
    this.draw();
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.detachInteractionHint();
    super.destroy(options ?? { children: true });
  }
}

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  duration?: number;
  onDismiss?: () => void;
}

interface ToastView {
  id: number;
  container: Container;
  background: Graphics;
  message: Text;
  icon: IconSprite;
  close: Container;
  accent: number;
  timeout?: number;
  height: number;
  onDismiss?: () => void;
}

function drawToastFrame(graphics: Graphics, width: number, height: number, accent: number): void {
  drawEasternFrame(graphics, 0, 0, width, height, {
    fillColor: EASTERN_UI.lacquerRaised,
    fillAlpha: 0.98,
    borderColor: EASTERN_UI.gilt,
    borderAlpha: 0.72,
    accentColor: accent,
    accentAlpha: 0.76,
    innerAlpha: 0.14,
    notch: 7,
  });
  graphics
    .moveTo(8, 12)
    .lineTo(8, height - 12)
    .stroke({ color: accent, alpha: 0.86, width: 2 });
  traceOctagon(graphics, 8, height / 2, 2.8).fill({ color: EASTERN_UI.giltBright, alpha: 0.92 });
}

export class ToastLayer extends Container {
  private readonly toasts: ToastView[] = [];
  private viewportWidth: number;
  private viewportHeight: number;
  private toastWidth: number;
  private nextId = 1;

  constructor(width = 1280, height = 720, toastWidth = 360) {
    super();
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.toastWidth = toastWidth;
    this.eventMode = 'passive';
  }

  show(message: string, kind?: ToastKind, duration?: number): number;
  show(message: string, options?: ToastOptions): number;
  show(
    message: string,
    kindOrOptions: ToastKind | ToastOptions = 'info',
    duration = 2800,
  ): number {
    const options =
      typeof kindOrOptions === 'string'
        ? { kind: kindOrOptions, duration }
        : {
            kind: kindOrOptions.kind ?? 'info',
            duration: kindOrOptions.duration ?? 2800,
            onDismiss: kindOrOptions.onDismiss,
          };
    const id = this.nextId++;
    const container = new Container();
    const background = new Graphics();
    const accent =
      options.kind === 'success' ? COLORS.jade : options.kind === 'error' ? COLORS.danger : COLORS.cyan;
    const iconName: IconName =
      options.kind === 'success' ? 'circle-check' : options.kind === 'error' ? 'triangle-alert' : 'info';
    const icon = new IconSprite(iconName, 18, accent);
    const availableWidth = Math.max(120, this.getActualToastWidth() - 84);
    const messageText = new Text({
      text: message,
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: 13,
        fontWeight: '500',
        fill: COLORS.paper,
        letterSpacing: 0,
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: availableWidth,
        lineHeight: 20,
      },
    });
    const close = new Container();
    const closeIcon = new IconSprite('x', 15, COLORS.paperFaint);
    close.addChild(closeIcon);
    close.hitArea = new Rectangle(-8, -8, 31, 31);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    attachInteractionHint(close, () => '关闭提示');
    const toastHeight = Math.max(48, messageText.height + 24);

    container.addChild(background, icon, messageText, close);
    container.eventMode = 'static';
    drawToastFrame(background, this.getActualToastWidth(), toastHeight, accent);
    icon.position.set(16, Math.round((toastHeight - 18) / 2));
    messageText.position.set(46, Math.round((toastHeight - messageText.height) / 2));
    close.position.set(this.getActualToastWidth() - 25, Math.round((toastHeight - 15) / 2));
    close.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.dismiss(id);
    });

    const toast: ToastView = {
      id,
      container,
      background,
      message: messageText,
      icon,
      close,
      accent,
      height: toastHeight,
      onDismiss: options.onDismiss,
    };
    this.toasts.push(toast);
    this.addChild(container);
    if (this.toasts.length > 4) this.dismiss(this.toasts[0].id);
    if (options.duration > 0) {
      toast.timeout = window.setTimeout(() => this.dismiss(id), options.duration);
    }
    this.layout();

    const status = document.querySelector<HTMLDivElement>('#a11y-status');
    if (status) status.textContent = message;
    return id;
  }

  success(message: string, duration = 2800): number {
    return this.show(message, 'success', duration);
  }

  error(message: string, duration = 3600): number {
    return this.show(message, 'error', duration);
  }

  info(message: string, duration = 2800): number {
    return this.show(message, 'info', duration);
  }

  dismiss(id: number): void {
    const index = this.toasts.findIndex((toast) => toast.id === id);
    if (index < 0) return;
    const [toast] = this.toasts.splice(index, 1);
    if (toast.timeout !== undefined) window.clearTimeout(toast.timeout);
    this.removeChild(toast.container);
    toast.container.destroy({ children: true });
    this.layout();
    toast.onDismiss?.();
  }

  clear(): void {
    for (const toast of [...this.toasts]) this.dismiss(toast.id);
  }

  private getActualToastWidth(): number {
    return Math.max(220, Math.min(this.toastWidth, this.viewportWidth - 24));
  }

  private layout(): void {
    const width = this.getActualToastWidth();
    let y = 16;
    for (const toast of this.toasts) {
      toast.message.style.wordWrapWidth = Math.max(120, width - 84);
      toast.height = Math.max(48, toast.message.height + 24);
      drawToastFrame(toast.background, width, toast.height, toast.accent);
      toast.icon.position.set(16, Math.round((toast.height - 18) / 2));
      toast.message.position.set(46, Math.round((toast.height - toast.message.height) / 2));
      toast.close.position.set(width - 25, Math.round((toast.height - 15) / 2));
      toast.container.position.set(Math.max(12, this.viewportWidth - width - 18), y);
      y += toast.height + 9;
    }
  }

  override setSize(value: SizeValue, height?: number): void {
    const size = resolveSize(value, height, this.viewportHeight);
    this.viewportWidth = Math.max(1, size.width);
    this.viewportHeight = Math.max(1, size.height);
    this.layout();
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    for (const toast of this.toasts) {
      if (toast.timeout !== undefined) window.clearTimeout(toast.timeout);
    }
    this.toasts.length = 0;
    super.destroy(options);
  }
}
