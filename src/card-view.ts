import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
  Ticker,
  TilingSprite,
  type FederatedPointerEvent,
} from 'pixi.js';

import {
  CARD_ABILITY_LONG_PRESS_MS,
  resolveCardAbilityPopoverLayout,
  type CardAbilityPopoverPlacement,
} from './card-ability-popover';
import { deriveAbilityTerms } from './card-ability-terms';
import {
  buildCardGameplayPresentation,
  type GameplayDisplayTier,
} from './card-gameplay-presentation';
import { MODE_BY_ID } from './data';
import { CARD_FACE_LAYOUT, computeArtworkCoverLayout } from './card-art-layout';
import {
  getArtStyleUiTheme,
  resolveArtStyle,
  type ArtStyleCorner,
  type ArtStyleId,
  type ArtStylePreset,
} from './art-styles';
import { CARD_RATIO, COLORS, DISPLAY_FONT, FONT_FAMILY } from './theme';
import type { CardBackDesign, CardData, GameMode, GameplayRuleModule } from './types';
import { loadLocalTexture } from './services/local-texture';
import { resolveRuntimeArtworkUrl } from './services/print-artwork-preflight';
import { audioEngine } from './services/audio';

const MIN_CARD_WIDTH = 72;
const DEFAULT_CARD_WIDTH = 252;
const ART_X_RATIO = CARD_FACE_LAYOUT.artwork.x;
const ART_Y_RATIO = CARD_FACE_LAYOUT.artwork.y;
const ART_WIDTH_RATIO = CARD_FACE_LAYOUT.artwork.width;
const ART_HEIGHT_RATIO = CARD_FACE_LAYOUT.artwork.height;
const INFO_X_RATIO = CARD_FACE_LAYOUT.infoPanel.x;
const INFO_Y_RATIO = CARD_FACE_LAYOUT.infoPanel.y;
const INFO_WIDTH_RATIO = CARD_FACE_LAYOUT.infoPanel.width;
const INFO_HEIGHT_RATIO = CARD_FACE_LAYOUT.infoPanel.height;
const GAMEPLAY_TEXT_POOL_SIZE = 20;

type CardSizeValue = number | { width: number; height: number };

export type CardMotionProfile = 'full' | 'static';

export interface CardAbilityPopoverOptions {
  placement?: CardAbilityPopoverPlacement;
}

interface CardVisualStyle {
  styled: boolean;
  accent: number;
  accentSoft: number;
  secondary: number;
  deep: number;
  paper: number;
  ink: number;
  ornament: number;
  corner: ArtStyleCorner;
  motif: ArtStylePreset['motif'];
}

const RARITY_COLOR: Record<CardData['rarity'], number> = {
  普通: COLORS.paperMuted,
  稀有: COLORS.cyan,
  史诗: COLORS.violet,
  传说: COLORS.gold,
};

interface RarityFoilProfile {
  broadAlpha: number;
  fineAlpha: number;
  borderAlpha: number;
  glareAlpha: number;
  coarseScale: number;
  fineScale: number;
  coarseAngle: number;
  fineAngle: number;
  parallax: number;
  idleDrift: number;
}

const RARITY_FOIL: Record<CardData['rarity'], RarityFoilProfile> = {
  普通: {
    broadAlpha: 0.045,
    fineAlpha: 0.025,
    borderAlpha: 0.08,
    glareAlpha: 0.34,
    coarseScale: 0.92,
    fineScale: 0.52,
    coarseAngle: -0.14,
    fineAngle: 0.42,
    parallax: 0.48,
    idleDrift: 0,
  },
  稀有: {
    broadAlpha: 0.14,
    fineAlpha: 0.1,
    borderAlpha: 0.2,
    glareAlpha: 0.58,
    coarseScale: 0.82,
    fineScale: 0.46,
    coarseAngle: -0.22,
    fineAngle: 0.58,
    parallax: 0.78,
    idleDrift: 0.35,
  },
  史诗: {
    broadAlpha: 0.22,
    fineAlpha: 0.17,
    borderAlpha: 0.31,
    glareAlpha: 0.78,
    coarseScale: 0.72,
    fineScale: 0.38,
    coarseAngle: -0.34,
    fineAngle: 0.76,
    parallax: 1.04,
    idleDrift: 0.62,
  },
  传说: {
    broadAlpha: 0.3,
    fineAlpha: 0.24,
    borderAlpha: 0.44,
    glareAlpha: 1,
    coarseScale: 0.64,
    fineScale: 0.31,
    coarseAngle: -0.48,
    fineAngle: 0.92,
    parallax: 1.28,
    idleDrift: 0.88,
  },
};

interface SharedHoloTextures {
  mineralRainbow: Texture;
  silkMica: Texture;
  radialGlare: Texture;
  chasedMetal: Texture;
}

let sharedHoloTextures: SharedHoloTextures | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mixColor(from: number, to: number, amount: number): number {
  const t = clamp(amount, 0, 1);
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;

  return (
    (Math.round(fr + (tr - fr) * t) << 16) |
    (Math.round(fg + (tg - fg) * t) << 8) |
    Math.round(fb + (tb - fb) * t)
  );
}

function colorFromHex(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const normalized = value.trim().replace(/^#/u, '');
  if (!/^[0-9a-f]{6}$/iu.test(normalized)) return fallback;
  return Number.parseInt(normalized, 16);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seedValue: number): () => number {
  let seed = seedValue || 1;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function createHoloTexture(
  size: number,
  paint: (context: CanvasRenderingContext2D, size: number) => void,
): Texture {
  if (typeof document === 'undefined') return Texture.WHITE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return Texture.WHITE;
  paint(context, size);
  const texture = Texture.from(canvas, true);
  texture.source.addressMode = 'repeat';
  texture.source.style.scaleMode = 'linear';
  return texture;
}

function getSharedHoloTextures(): SharedHoloTextures {
  if (sharedHoloTextures) return sharedHoloTextures;

  const mineralRainbow = createHoloTexture(256, (context, size) => {
    const rainbow = context.createLinearGradient(0, size, size, 0);
    rainbow.addColorStop(0, 'rgba(24, 179, 174, 0.72)');
    rainbow.addColorStop(0.18, 'rgba(97, 202, 168, 0.64)');
    rainbow.addColorStop(0.38, 'rgba(233, 195, 93, 0.76)');
    rainbow.addColorStop(0.56, 'rgba(222, 92, 86, 0.66)');
    rainbow.addColorStop(0.74, 'rgba(156, 99, 204, 0.72)');
    rainbow.addColorStop(1, 'rgba(76, 165, 220, 0.7)');
    context.fillStyle = rainbow;
    context.fillRect(0, 0, size, size);

    context.globalCompositeOperation = 'screen';
    for (let band = -2; band < 8; band += 1) {
      const y = band * size * 0.19;
      context.beginPath();
      context.moveTo(-size * 0.12, y + size * 0.08);
      context.bezierCurveTo(
        size * 0.22,
        y - size * 0.1,
        size * 0.58,
        y + size * 0.18,
        size * 1.12,
        y,
      );
      context.lineWidth = size * (band % 2 === 0 ? 0.055 : 0.026);
      context.strokeStyle = band % 3 === 0
        ? 'rgba(255, 244, 207, 0.2)'
        : 'rgba(184, 239, 236, 0.13)';
      context.stroke();
    }
  });

  const silkMica = createHoloTexture(96, (context, size) => {
    context.clearRect(0, 0, size, size);
    context.lineWidth = 0.75;
    for (let index = -12; index < 20; index += 1) {
      const offset = index * 7;
      context.beginPath();
      context.moveTo(offset, -size * 0.1);
      context.lineTo(offset + size * 0.76, size * 1.1);
      context.strokeStyle = index % 4 === 0
        ? 'rgba(255, 222, 136, 0.34)'
        : 'rgba(202, 246, 239, 0.17)';
      context.stroke();
    }
    for (let index = -16; index < 22; index += 1) {
      const offset = index * 6;
      context.beginPath();
      context.moveTo(offset, size * 1.1);
      context.lineTo(offset + size * 0.68, -size * 0.1);
      context.strokeStyle = index % 5 === 0
        ? 'rgba(214, 172, 255, 0.26)'
        : 'rgba(255, 255, 255, 0.12)';
      context.stroke();
    }
    const random = makeRandom(0x74a9b13);
    for (let index = 0; index < 74; index += 1) {
      const x = random() * size;
      const y = random() * size;
      const radius = 0.35 + random() * 1.1;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = index % 5 === 0
        ? 'rgba(255, 226, 151, 0.54)'
        : 'rgba(230, 251, 248, 0.3)';
      context.fill();
    }
  });

  const radialGlare = createHoloTexture(128, (context, size) => {
    const center = size / 2;
    const glare = context.createRadialGradient(center, center, 0, center, center, center);
    glare.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
    glare.addColorStop(0.18, 'rgba(255, 248, 222, 0.65)');
    glare.addColorStop(0.42, 'rgba(204, 244, 239, 0.24)');
    glare.addColorStop(0.72, 'rgba(154, 198, 231, 0.07)');
    glare.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = glare;
    context.fillRect(0, 0, size, size);
  });

  const chasedMetal = createHoloTexture(128, (context, size) => {
    const metal = context.createLinearGradient(0, 0, size, size * 0.38);
    metal.addColorStop(0, 'rgba(72, 112, 112, 0.72)');
    metal.addColorStop(0.16, 'rgba(240, 222, 167, 0.9)');
    metal.addColorStop(0.28, 'rgba(116, 197, 184, 0.76)');
    metal.addColorStop(0.5, 'rgba(255, 244, 214, 0.94)');
    metal.addColorStop(0.68, 'rgba(188, 109, 102, 0.72)');
    metal.addColorStop(0.84, 'rgba(141, 125, 203, 0.74)');
    metal.addColorStop(1, 'rgba(52, 105, 119, 0.7)');
    context.fillStyle = metal;
    context.fillRect(0, 0, size, size);
    context.globalCompositeOperation = 'overlay';
    for (let index = 0; index < 22; index += 1) {
      const x = (index / 22) * size;
      context.fillStyle = index % 3 === 0
        ? 'rgba(255, 255, 255, 0.34)'
        : 'rgba(21, 42, 44, 0.22)';
      context.fillRect(x, 0, index % 3 === 0 ? 1.2 : 0.55, size);
    }
  });

  sharedHoloTextures = { mineralRainbow, silkMica, radialGlare, chasedMetal };
  return sharedHoloTextures;
}

function fontSize(width: number, ratio: number, minimum: number, maximum: number): number {
  return clamp(width * ratio, minimum, maximum);
}

function fitNumericFont(value: string, desiredSize: number, maxWidth: number): number {
  const units = Array.from(value).reduce((total, character) => total + characterUnits(character), 0);
  const estimatedWidth = units * desiredSize;
  return estimatedWidth > maxWidth
    ? Math.max(4, desiredSize * (maxWidth / estimatedWidth))
    : desiredSize;
}

function cornerRadiusRatio(corner: ArtStyleCorner): number {
  if (corner === 'step' || corner === 'seal') return 0.026;
  if (corner === 'lattice') return 0.038;
  if (corner === 'arch') return 0.054;
  if (corner === 'cloud' || corner === 'ruyi') return 0.074;
  return 0.058;
}

function characterUnits(character: string): number {
  if (/\s/u.test(character)) return 0.36;
  if (/[\x00-\x7F]/u.test(character)) {
    if (/[.,:;!'"`|ijlI1]/u.test(character)) return 0.34;
    if (/[MW@#%]/u.test(character)) return 0.88;
    return 0.58;
  }
  return 1;
}

function setFittedSingleLine(label: Text, value: string, maxWidth: number): void {
  const characters = Array.from(value.trim());
  label.text = characters.join('');
  if (label.width <= maxWidth) return;

  let low = 0;
  let high = characters.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    label.text = `${characters.slice(0, midpoint).join('').trimEnd()}…`;
    if (label.width <= maxWidth) low = midpoint;
    else high = midpoint - 1;
  }
  label.text = low > 0 ? `${characters.slice(0, low).join('').trimEnd()}…` : '…';
}

function setAdaptiveSingleLine(
  label: Text,
  value: string,
  maxWidth: number,
  desiredSize: number,
  minimumScale = 0.82,
): void {
  label.style.fontSize = desiredSize;
  label.text = value.trim();
  if (label.width <= maxWidth) return;

  label.style.fontSize = Math.max(
    desiredSize * minimumScale,
    desiredSize * (maxWidth / Math.max(1, label.width)),
  );
  if (label.width > maxWidth) setFittedSingleLine(label, value, maxWidth);
}

function fitMultiline(value: string, maxWidth: number, size: number, maxLines: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized) return '';

  const maxUnits = Math.max(1, maxWidth / Math.max(size, 1));
  const lines: string[] = [];
  let line = '';
  let units = 0;
  let consumed = 0;

  for (const character of normalized) {
    const nextUnits = characterUnits(character);
    if (line && units + nextUnits > maxUnits) {
      lines.push(line.trimEnd());
      if (lines.length === maxLines) break;
      line = '';
      units = 0;
    }
    line += character;
    units += nextUnits;
    consumed += 1;
  }

  if (lines.length < maxLines && line) lines.push(line.trimEnd());
  if (consumed < normalized.length && lines.length > 0) {
    const lastIndex = lines.length - 1;
    const last = lines[lastIndex].replace(/[，。；：、,.!?;:。！？]+$/u, '');
    lines[lastIndex] = `${last.slice(0, Math.max(1, last.length - 1))}…`;
  }

  return lines.join('\n');
}

function fitCompleteMultiline(
  value: string,
  maxWidth: number,
  desiredSize: number,
  minimumSize: number,
  maxHeight: number,
): { text: string; size: number } {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized) return { text: '无额外能力。', size: desiredSize };
  const totalUnits = Array.from(normalized).reduce(
    (total, character) => total + characterUnits(character),
    0,
  );

  for (let size = desiredSize; size >= minimumSize; size -= 0.5) {
    const maxLines = Math.max(1, Math.floor(maxHeight / (size * 1.28)));
    if (maxLines * (maxWidth / size) >= totalUnits * 1.03) {
      return { text: fitMultiline(normalized, maxWidth, size, maxLines), size };
    }
  }

  const fallbackLines = Math.max(1, Math.floor(maxHeight / (minimumSize * 1.28)));
  return {
    text: fitMultiline(normalized, maxWidth, minimumSize, fallbackLines),
    size: minimumSize,
  };
}

function createText(): Text {
  return new Text({
    text: '',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 12,
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
}

/**
 * A renderer-independent Pixi card surface. Its x/y coordinate represents the
 * card centre, leaving the outer rotation free for fan layouts and transitions.
 */
export class CardView extends Container {
  private data: CardData;
  private mode: GameMode;
  private artStyleId: ArtStyleId | null = null;
  private cardWidth = DEFAULT_CARD_WIDTH;
  private cardHeight = DEFAULT_CARD_WIDTH * CARD_RATIO;

  private readonly shadow = new Graphics();
  private readonly tiltLayer = new Container();
  private readonly hoverAura = new Graphics();
  private readonly abilityPopover = new Container();
  private readonly abilityPopoverShadow = new Graphics();
  private readonly abilityPopoverPanel = new Graphics();
  private readonly abilityPopoverTitle = createText();
  private readonly abilityPopoverTerms = createText();
  private readonly abilityPopoverSkill = createText();
  private readonly flipLayer = new Container();
  private readonly surface = new Container();
  private readonly cardMask = new Graphics();
  private readonly backMask = new Graphics();
  private readonly frame = new Graphics();
  private readonly framePrism = new Graphics();
  private readonly artContent = new Container();
  private readonly fallbackArt = new Graphics();
  private readonly fallbackGlyph = createText();
  private readonly fallbackCaption = createText();
  private readonly artSprite = new Sprite({ texture: Texture.EMPTY });
  private readonly artIridescence = new TilingSprite({ texture: Texture.WHITE });
  private readonly artMicroFoil = new TilingSprite({ texture: Texture.WHITE });
  private readonly artFoil = new Graphics();
  private readonly artMask = new Graphics();
  private readonly artFrame = new Graphics();
  private readonly titlePlate = new Graphics();
  private readonly infoPanel = new Graphics();
  private readonly gameplayFoundation = new Graphics();
  private readonly gameplayInk = new Container();
  private readonly gameplayLinework = new Graphics();
  private readonly gameplayTexts = Array.from(
    { length: GAMEPLAY_TEXT_POOL_SIZE },
    () => createText(),
  );
  private readonly infoTextContent = new Container();
  private readonly infoTextMask = new Graphics();
  private readonly abilityTermPlates = new Graphics();
  private readonly borderFoil = new TilingSprite({ texture: Texture.WHITE });
  private readonly borderFoilMask = new Graphics();
  private readonly surfaceGrain = new Graphics();
  private readonly foilSheen = new Graphics();
  private readonly specularBeam = new Graphics();
  private readonly localHighlight = new Sprite({ texture: Texture.WHITE });
  private readonly borderGlow = new Graphics();
  private readonly edgeGlints = new Graphics();
  private readonly authorMark = new Graphics();
  private readonly backSurface = new Container();
  private readonly backEffects = new Container();
  private readonly backFrame = new Graphics();
  private readonly backPatternBase = new Graphics();
  private readonly backPattern = new Graphics();
  private readonly backGrain = new Graphics();
  private readonly backSheen = new Graphics();
  private readonly backBeam = new Graphics();
  private readonly backHighlight = new Graphics();
  private readonly backPrism = new Graphics();
  private readonly backGlyph = createText();
  private readonly backLabel = createText();
  private readonly backCreatorMark = new Graphics();
  private readonly backCreatorText = createText();

  private readonly titleText = createText();
  private readonly nameText = createText();
  private readonly costText = createText();
  private readonly rarityText = createText();
  private readonly abilityTermTexts = [createText(), createText(), createText()];
  private readonly attackText = createText();
  private readonly defenseText = createText();
  private readonly attackLabel = createText();
  private readonly defenseLabel = createText();
  private readonly authorText = createText();

  private interactiveTilt = true;
  private flipOnTap = false;
  private abilityPopoverEnabled = false;
  private abilityPopoverPlacement: CardAbilityPopoverPlacement = 'auto';
  private abilityPopoverTarget = 0;
  private abilityPopoverAmount = 0;
  private abilityPopoverPinned = false;
  private suppressNextTap = false;
  private longPressTimer: number | undefined;
  private longPressPointerId = -1;
  private longPressStartX = 0;
  private longPressStartY = 0;
  private foilIntensity = 0.65;
  private gameplayModules: readonly GameplayRuleModule[] = [];
  private gameplayDisplayTier: GameplayDisplayTier | undefined;
  private flipped = false;
  private flipAmount = 0;
  private flipTarget = 0;
  private backDesign: CardBackDesign = {
    style: 'forge',
    seed: 1103,
    label: '万象卡域',
  };
  private disposed = false;
  private artworkRequest = 0;
  private loadedTexture: Texture | null = null;
  private artworkAlphaTarget = 0;
  private readonly reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly coarsePointer =
    typeof window !== 'undefined' &&
    (window.matchMedia('(pointer: coarse)').matches || window.navigator.maxTouchPoints > 0);
  private pointerMotionScale = 1;
  private motionProfile: CardMotionProfile = 'full';
  private tickerAttached = false;

  private targetSkewX = 0;
  private targetSkewY = 0;
  private targetRotation = 0;
  private currentSkewX = 0;
  private currentSkewY = 0;
  private currentRotation = 0;
  private hoverAmount = 0;
  private hoverTarget = 0;
  private highlightAlpha = 0;
  private highlightTarget = 0;
  private highlightX = DEFAULT_CARD_WIDTH / 2;
  private highlightY = (DEFAULT_CARD_WIDTH * CARD_RATIO) / 2;
  private highlightTargetX = this.highlightX;
  private highlightTargetY = this.highlightY;
  private pointerX = 0;
  private pointerY = 0;
  private elapsed = 0;
  private breathPhase = 0;
  private foilPhase = 0;
  private frameAccumulator = 0;

  public constructor(data: CardData, width: number);
  public constructor(data: CardData, mode: GameMode, width: number);
  public constructor(data: CardData, modeOrWidth: GameMode | number, maybeWidth?: number) {
    super();

    this.data = data;
    this.mode = typeof modeOrWidth === 'number' ? MODE_BY_ID[data.modeId] : modeOrWidth;
    const initialWidth = typeof modeOrWidth === 'number' ? modeOrWidth : maybeWidth;
    const holoTextures = getSharedHoloTextures();
    this.artIridescence.texture = holoTextures.mineralRainbow;
    this.artMicroFoil.texture = holoTextures.silkMica;
    this.borderFoil.texture = holoTextures.chasedMetal;
    this.localHighlight.texture = holoTextures.radialGlare;
    this.localHighlight.anchor.set(0.5);

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.sortableChildren = false;

    this.addChild(this.shadow, this.tiltLayer, this.abilityPopover);
    this.tiltLayer.addChild(this.hoverAura, this.flipLayer);
    this.abilityPopover.addChild(
      this.abilityPopoverShadow,
      this.abilityPopoverPanel,
      this.abilityPopoverTitle,
      this.abilityPopoverTerms,
      this.abilityPopoverSkill,
    );
    this.abilityPopover.eventMode = 'none';
    this.abilityPopover.visible = false;
    this.abilityPopover.alpha = 0;
    this.flipLayer.addChild(this.surface, this.cardMask, this.backSurface);
    this.surface.mask = this.cardMask;
    this.backSurface.visible = false;

    this.artContent.addChild(
      this.fallbackArt,
      this.fallbackGlyph,
      this.fallbackCaption,
      this.artSprite,
      this.artIridescence,
      this.artMicroFoil,
      this.artFoil,
    );
    this.artContent.mask = this.artMask;
    this.borderFoil.mask = this.borderFoilMask;

    this.infoTextContent.addChild(
      this.abilityTermPlates,
      this.rarityText,
      ...this.abilityTermTexts,
    );
    this.infoTextContent.mask = this.infoTextMask;
    this.gameplayInk.addChild(this.gameplayLinework, ...this.gameplayTexts);
    this.gameplayFoundation.eventMode = 'none';
    this.gameplayInk.eventMode = 'none';

    this.surface.addChild(
      this.frame,
      this.borderFoil,
      this.borderFoilMask,
      this.framePrism,
      this.artContent,
      this.artMask,
      this.artFrame,
      this.titlePlate,
      this.infoPanel,
      this.gameplayFoundation,
      this.surfaceGrain,
      this.foilSheen,
      this.specularBeam,
      this.localHighlight,
      this.borderGlow,
      this.edgeGlints,
      this.gameplayInk,
      this.infoTextContent,
      this.infoTextMask,
      this.authorMark,
      this.titleText,
      this.nameText,
      this.costText,
      this.attackText,
      this.defenseText,
      this.attackLabel,
      this.defenseLabel,
      this.authorText,
    );
    this.backEffects.addChild(
      this.backGrain,
      this.backSheen,
      this.backBeam,
      this.backHighlight,
    );
    this.backEffects.mask = this.backMask;
    this.backEffects.eventMode = 'none';
    this.backMask.eventMode = 'none';
    this.backSurface.addChild(
      this.backFrame,
      this.backEffects,
      this.backMask,
      this.backPatternBase,
      this.backPattern,
      this.backPrism,
      this.backGlyph,
      this.backLabel,
      this.backCreatorMark,
      this.backCreatorText,
    );

    this.artFoil.blendMode = 'screen';
    this.artIridescence.blendMode = 'screen';
    this.artMicroFoil.blendMode = 'add';
    this.borderFoil.blendMode = 'screen';
    this.framePrism.blendMode = 'screen';
    this.surfaceGrain.blendMode = 'screen';
    this.foilSheen.blendMode = 'screen';
    this.hoverAura.blendMode = 'screen';
    this.specularBeam.blendMode = 'add';
    this.localHighlight.blendMode = 'screen';
    this.edgeGlints.blendMode = 'screen';
    this.backGrain.blendMode = 'screen';
    this.backSheen.blendMode = 'screen';
    this.backBeam.blendMode = 'add';
    this.backHighlight.blendMode = 'add';
    this.backPatternBase.blendMode = 'normal';
    this.backPattern.blendMode = 'normal';
    this.backPrism.blendMode = 'screen';

    this.on('pointerenter', this.handlePointerEnter);
    this.on('pointermove', this.handlePointerMove);
    this.on('pointerleave', this.handlePointerLeave);
    this.on('pointerdown', this.handlePointerDown);
    this.on('pointerup', this.handlePointerUp);
    this.on('pointerupoutside', this.handlePointerCancel);
    this.on('pointercancel', this.handlePointerCancel);
    this.on('pointertap', this.handlePointerTap);
    Ticker.shared.add(this.updateFrame);
    this.tickerAttached = true;

    this.setSize(initialWidth ?? DEFAULT_CARD_WIDTH);
    this.setData(data, this.mode);
  }

  public setData(data: CardData, mode: GameMode = MODE_BY_ID[data.modeId]): this {
    const shouldLoadArtwork = this.artworkRequest === 0 || data.artUrl !== this.data.artUrl;
    this.data = data;
    this.mode = mode;
    this.breathPhase = (hashString(data.id) % 628) / 100;
    this.foilPhase = (hashString(`${data.id}:${data.rarity}`) % 997) / 997;
    this.drawCard();
    if (shouldLoadArtwork) void this.loadArtwork(data.artUrl);
    return this;
  }

  public setArtStyle(styleId: ArtStyleId | undefined): this {
    const nextStyleId = resolveArtStyle(styleId).id;
    if (this.artStyleId === nextStyleId) return this;
    this.artStyleId = nextStyleId;
    this.drawCard();
    this.fitArtwork();
    return this;
  }

  /** Supplies creator-facing rule names and seals for gameplay marks. */
  public setGameplayContext(
    modules: readonly GameplayRuleModule[] | undefined,
    tier?: GameplayDisplayTier,
  ): this {
    this.gameplayModules = modules ?? [];
    this.gameplayDisplayTier = tier;
    this.drawGameplayMarks();
    this.drawAbilityPopover();
    return this;
  }

  public setMotionProfile(profile: CardMotionProfile): this {
    if (this.motionProfile === profile) return this;
    this.motionProfile = profile;
    if (profile === 'static') {
      this.frameAccumulator = 0;
      if (this.tickerAttached) {
        Ticker.shared.remove(this.updateFrame);
        this.tickerAttached = false;
      }
      this.resetInteraction();
      this.applyStaticVisualState();
    } else if (!this.tickerAttached && !this.disposed) {
      Ticker.shared.add(this.updateFrame);
      this.tickerAttached = true;
    }
    return this;
  }

  public setBackDesign(design: CardBackDesign | undefined, label?: string): this {
    this.backDesign = design ?? {
      style: 'forge',
      seed: hashString(`${this.data.modeId}:${label ?? 'wanxiang-deck'}`),
      label: label ?? this.mode.name,
    };
    this.drawBack();
    return this;
  }

  public setFlipOnTap(enabled: boolean): this {
    this.flipOnTap = enabled;
    return this;
  }

  public setAbilityPopoverEnabled(
    enabled: boolean,
    options: CardAbilityPopoverOptions = {},
  ): this {
    this.abilityPopoverEnabled = enabled;
    this.abilityPopoverPlacement = options.placement ?? 'auto';
    if (!enabled) this.hideAbilityPopover(true);
    else this.drawAbilityPopover();
    return this;
  }

  public setFlipped(value: boolean, immediate = false): this {
    const changed = this.flipped !== value;
    this.flipped = value;
    this.flipTarget = value ? 1 : 0;
    if (value) this.hideAbilityPopover(true);
    if (immediate || this.motionProfile === 'static') this.flipAmount = this.flipTarget;
    if (immediate || this.motionProfile === 'static') this.applyFlipVisualState();
    if (this.motionProfile === 'static') this.applyStaticVisualState();
    if (changed) {
      if (!immediate) audioEngine.play('card-flip');
      this.emit('flipchange', value);
    }
    return this;
  }

  public toggleFlipped(): this {
    return this.setFlipped(!this.flipped);
  }

  public isFlipped(): boolean {
    return this.flipped;
  }

  public override setSize(value: CardSizeValue, _height?: number): this {
    const width = typeof value === 'number' ? value : value.width;
    const safeWidth = Number.isFinite(width) ? Math.max(MIN_CARD_WIDTH, width) : DEFAULT_CARD_WIDTH;
    this.cardWidth = safeWidth;
    this.cardHeight = safeWidth * CARD_RATIO;
    this.pivot.set(this.cardWidth / 2, this.cardHeight / 2);
    this.tiltLayer.pivot.set(this.cardWidth / 2, this.cardHeight / 2);
    this.tiltLayer.position.set(this.cardWidth / 2, this.cardHeight / 2);
    this.flipLayer.pivot.set(this.cardWidth / 2, this.cardHeight / 2);
    this.flipLayer.position.set(this.cardWidth / 2, this.cardHeight / 2);
    this.hitArea = new Rectangle(0, 0, this.cardWidth, this.cardHeight);
    this.highlightX = clamp(this.highlightX, 0, this.cardWidth);
    this.highlightY = clamp(this.highlightY, 0, this.cardHeight);
    this.highlightTargetX = clamp(this.highlightTargetX, 0, this.cardWidth);
    this.highlightTargetY = clamp(this.highlightTargetY, 0, this.cardHeight);
    this.drawCard();
    this.fitArtwork();
    return this;
  }

  public setInteractiveTilt(enabled: boolean): this {
    this.interactiveTilt = enabled;
    this.cursor = enabled ? 'pointer' : 'default';
    if (!enabled) this.resetInteraction();
    return this;
  }

  public setFoilIntensity(intensity: number): this {
    this.foilIntensity = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
    this.drawFoil();
    if (this.motionProfile === 'static') this.applyStaticVisualState();
    return this;
  }

  private get visualStyle(): CardVisualStyle {
    if (this.artStyleId) {
      const preset = resolveArtStyle(this.artStyleId);
      const ui = getArtStyleUiTheme(preset.id);
      return {
        styled: true,
        accent: ui.accent,
        accentSoft: mixColor(preset.palette.secondary, preset.palette.paper, 0.34),
        secondary: preset.palette.secondary,
        deep: ui.panel,
        paper: ui.paper,
        ink: ui.ink,
        ornament: mixColor(ui.ornament, COLORS.gold, 0.38),
        corner: ui.corner,
        motif: ui.motif,
      };
    }
    return {
      styled: false,
      accent: this.mode.accent,
      accentSoft: this.mode.accentSoft,
      secondary: COLORS.jade,
      deep: this.mode.deep,
      paper: COLORS.paper,
      ink: COLORS.ink,
      ornament: COLORS.gold,
      corner: 'fan',
      motif: 'cloud',
    };
  }

  private drawCard(): void {
    const width = this.cardWidth;
    const height = this.cardHeight;
    const visual = this.visualStyle;
    const radius = width * (visual.styled ? cornerRadiusRatio(visual.corner) : 0.066);
    const innerRadius = radius * 0.74;
    const border = width * 0.036;
    const { accent, accentSoft, deep, ink, ornament, paper, secondary } = visual;
    const power = clamp((this.data.attack + this.data.defense) / 120, 0, 1);
    const darkMetal = mixColor(mixColor(deep, ink, 0.62), visual.styled ? visual.secondary : COLORS.vermilion, 0.07);
    const paleMetal = mixColor(accentSoft, paper, 0.3 + power * 0.42);

    this.shadow
      .clear()
      .roundRect(0, 0, width, height, radius)
      .fill({ color: COLORS.black, alpha: 0.52 });
    this.shadow.position.set(width * 0.018, width * 0.034);

    this.hoverAura.clear();
    this.hoverAura
      .roundRect(-width * 0.026, -width * 0.026, width * 1.052, height + width * 0.052, radius * 1.12)
      .stroke({ color: ornament, width: width * 0.018, alpha: 0.14 });
    this.hoverAura
      .roundRect(-width * 0.014, -width * 0.014, width * 1.028, height + width * 0.028, radius * 1.04)
      .stroke({ color: accent, width: width * 0.01, alpha: 0.2 });
    this.hoverAura
      .roundRect(-width * 0.006, -width * 0.006, width * 1.012, height + width * 0.012, radius)
      .stroke({ color: secondary, width: width * 0.006, alpha: 0.24 });
    this.hoverAura.alpha = 0;

    this.cardMask.clear().roundRect(0, 0, width, height, radius).fill(COLORS.white);
    this.backMask.clear().roundRect(0, 0, width, height, radius).fill(COLORS.white);

    this.frame.clear();
    this.frame.roundRect(0, 0, width, height, radius).fill({ color: darkMetal });
    this.frame
      .roundRect(width * 0.008, width * 0.008, width * 0.984, height - width * 0.016, radius)
      .stroke({ color: paleMetal, width: width * 0.012, alpha: 0.92 });
    this.frame
      .roundRect(border * 0.58, border * 0.58, width - border * 1.16, height - border * 1.16, innerRadius)
      .stroke({ color: accent, width: width * 0.012, alpha: 0.78 });
    this.frame
      .roundRect(border * 0.76, border * 0.76, width - border * 1.52, height - border * 1.52, innerRadius * 0.92)
      .stroke({ color: ornament, width: width * 0.0035, alpha: 0.54 });
    this.frame
      .roundRect(border, border, width - border * 2, height - border * 2, innerRadius)
      .fill({ color: mixColor(deep, ink, 0.58), alpha: 0.98 })
      .stroke({ color: mixColor(accentSoft, paper, 0.18), width: width * 0.004, alpha: 0.76 });

    this.frame
      .moveTo(width * 0.07, height * 0.145)
      .lineTo(width * 0.24, height * 0.145)
      .lineTo(width * 0.29, height * 0.157)
      .lineTo(width * 0.71, height * 0.157)
      .lineTo(width * 0.76, height * 0.145)
      .lineTo(width * 0.93, height * 0.145)
      .stroke({ color: accentSoft, width: width * 0.005, alpha: 0.64 });
    this.frame
      .moveTo(width * 0.075, height * 0.925)
      .lineTo(width * 0.29, height * 0.925)
      .moveTo(width * 0.71, height * 0.925)
      .lineTo(width * 0.925, height * 0.925)
      .stroke({ color: accent, width: width * 0.005, alpha: 0.58 });
    const rivetInset = width * 0.052;
    const rivetRadius = width * 0.008;
    this.frame
      .circle(rivetInset, rivetInset, rivetRadius)
      .circle(width - rivetInset, rivetInset, rivetRadius)
      .circle(rivetInset, height - rivetInset, rivetRadius)
      .circle(width - rivetInset, height - rivetInset, rivetRadius)
      .fill({ color: mixColor(ornament, ink, 0.28), alpha: 0.88 });

    this.drawArtwork();
    this.drawTitlePlate();
    this.drawInformationPanel();
    this.drawGameplayMarks();
    this.drawFoil();
    this.layoutText();
    this.drawBack();
    this.drawAbilityPopover();
    if (this.motionProfile === 'static') this.applyStaticVisualState();
  }

  private drawTitlePlate(): void {
    const width = this.cardWidth;
    const height = this.cardHeight;
    const visual = this.visualStyle;
    const x = width * CARD_FACE_LAYOUT.titlePlate.x;
    const y = height * CARD_FACE_LAYOUT.titlePlate.y;
    const plateWidth = width * CARD_FACE_LAYOUT.titlePlate.width;
    const plateHeight = height * CARD_FACE_LAYOUT.titlePlate.height;
    const notch = width * 0.022;

    this.titlePlate.clear();
    this.titlePlate
      .poly([
        x + notch,
        y,
        x + plateWidth - notch,
        y,
        x + plateWidth,
        y + notch,
        x + plateWidth,
        y + plateHeight - notch,
        x + plateWidth - notch,
        y + plateHeight,
        x + notch,
        y + plateHeight,
        x,
        y + plateHeight - notch,
        x,
        y + notch,
      ])
      .fill({ color: mixColor(visual.deep, visual.ink, 0.78), alpha: 0.94 })
      .stroke({
        color: mixColor(visual.ornament, visual.paper, 0.2),
        width: width * 0.005,
        alpha: 0.78,
      });
    this.titlePlate
      .poly([
        x + notch * 1.25,
        y + width * 0.009,
        x + plateWidth - notch * 1.25,
        y + width * 0.009,
        x + plateWidth - notch * 0.62,
        y + width * 0.015,
        x + notch * 0.62,
        y + width * 0.015,
      ])
      .stroke({ color: visual.paper, width: width * 0.0022, alpha: 0.34 });
    this.titlePlate
      .moveTo(x + width * 0.035, y + plateHeight - width * 0.017)
      .lineTo(x + plateWidth - width * 0.035, y + plateHeight - width * 0.017)
      .stroke({ color: visual.accent, width: width * 0.0035, alpha: 0.52 });
    this.titlePlate
      .circle(x + width * 0.025, y + plateHeight * 0.5, width * 0.006)
      .circle(x + plateWidth - width * 0.025, y + plateHeight * 0.5, width * 0.006)
      .fill({ color: visual.ornament, alpha: 0.72 });
  }

  private drawArtwork(): void {
    const width = this.cardWidth;
    const height = this.cardHeight;
    const artX = width * ART_X_RATIO;
    const artY = height * ART_Y_RATIO;
    const artWidth = width * ART_WIDTH_RATIO;
    const artHeight = height * ART_HEIGHT_RATIO;
    const artRadius = width * 0.025;
    const visual = this.visualStyle;
    const { accent, accentSoft, deep, ink, ornament, paper } = visual;
    const random = makeRandom(hashString(`${this.data.id}:${this.mode.id}:${this.artStyleId ?? 'mode'}`));

    this.artMask
      .clear()
      .roundRect(artX, artY, artWidth, artHeight, artRadius)
      .fill(COLORS.white);

    this.fallbackArt.clear();
    this.fallbackArt
      .rect(artX - width * 0.025, artY - width * 0.025, artWidth + width * 0.05, artHeight + width * 0.05)
      .fill({ color: mixColor(deep, ink, 0.25) });
    this.fallbackArt
      .ellipse(artX + artWidth * 0.5, artY + artHeight * 0.43, artWidth * 0.5, artHeight * 0.47)
      .fill({ color: accent, alpha: 0.12 });
    this.fallbackArt
      .ellipse(artX + artWidth * 0.5, artY + artHeight * 0.43, artWidth * 0.35, artHeight * 0.33)
      .stroke({ color: accentSoft, width: width * 0.008, alpha: 0.46 });
    this.fallbackArt
      .ellipse(artX + artWidth * 0.5, artY + artHeight * 0.43, artWidth * 0.25, artHeight * 0.235)
      .stroke({ color: accent, width: width * 0.004, alpha: 0.68 });

    this.fallbackArt
      .moveTo(artX - artWidth * 0.04, artY + artHeight * 0.88)
      .lineTo(artX + artWidth * 0.19, artY + artHeight * 0.48)
      .lineTo(artX + artWidth * 0.33, artY + artHeight * 0.72)
      .lineTo(artX + artWidth * 0.52, artY + artHeight * 0.32)
      .lineTo(artX + artWidth * 0.72, artY + artHeight * 0.72)
      .lineTo(artX + artWidth * 0.91, artY + artHeight * 0.42)
      .lineTo(artX + artWidth * 1.04, artY + artHeight * 0.88)
      .closePath()
      .fill({ color: accentSoft, alpha: 0.09 });
    this.fallbackArt
      .moveTo(artX - artWidth * 0.04, artY + artHeight * 0.94)
      .quadraticCurveTo(artX + artWidth * 0.18, artY + artHeight * 0.78, artX + artWidth * 0.42, artY + artHeight * 0.91)
      .quadraticCurveTo(artX + artWidth * 0.68, artY + artHeight * 1.02, artX + artWidth * 1.04, artY + artHeight * 0.78)
      .lineTo(artX + artWidth * 1.04, artY + artHeight * 1.04)
      .lineTo(artX - artWidth * 0.04, artY + artHeight * 1.04)
      .closePath()
      .fill({ color: ink, alpha: 0.34 });
    this.fallbackArt
      .moveTo(artX + artWidth * 0.05, artY + artHeight * 0.26)
      .bezierCurveTo(
        artX + artWidth * 0.22,
        artY + artHeight * 0.14,
        artX + artWidth * 0.31,
        artY + artHeight * 0.34,
        artX + artWidth * 0.48,
        artY + artHeight * 0.21,
      )
      .stroke({ color: paper, width: width * 0.004, alpha: 0.16 });

    for (let index = 0; index < 18; index += 1) {
      const x = artX + random() * artWidth;
      const y = artY + random() * artHeight * 0.82;
      const radius = width * (0.0025 + random() * 0.006);
      this.fallbackArt.circle(x, y, radius).fill({
        color: index % 4 === 0 ? accentSoft : COLORS.white,
        alpha: 0.2 + random() * 0.62,
      });
    }

    const figureX = artX + artWidth * (0.45 + (random() - 0.5) * 0.08);
    const figureY = artY + artHeight * 0.49;
    this.fallbackArt
      .circle(figureX, figureY, artWidth * 0.085)
      .fill({ color: mixColor(deep, COLORS.black, 0.58), alpha: 0.95 });
    this.fallbackArt
      .moveTo(figureX - artWidth * 0.2, artY + artHeight * 0.95)
      .quadraticCurveTo(figureX - artWidth * 0.15, figureY, figureX, figureY + artHeight * 0.08)
      .quadraticCurveTo(figureX + artWidth * 0.17, figureY, figureX + artWidth * 0.23, artY + artHeight * 0.95)
      .closePath()
      .fill({ color: mixColor(deep, COLORS.black, 0.54), alpha: 0.96 });
    this.fallbackArt
      .circle(figureX + artWidth * 0.028, figureY - artWidth * 0.018, width * 0.008)
      .fill({ color: accentSoft, alpha: 0.9 });

    const glyphSize = fontSize(width, 0.26, 20, 82);
    this.fallbackGlyph.text = this.mode.glyph;
    this.fallbackGlyph.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: glyphSize,
      fontWeight: '700',
      fill: accentSoft,
      letterSpacing: 0,
    });
    this.fallbackGlyph.anchor.set(0.5);
    this.fallbackGlyph.position.set(artX + artWidth * 0.77, artY + artHeight * 0.26);
    this.fallbackGlyph.alpha = 0.52;

    const captionSize = fontSize(width, 0.032, 7, 13);
    this.fallbackCaption.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: captionSize,
      fontWeight: '600',
      fill: paper,
      letterSpacing: 0,
    });
    setFittedSingleLine(this.fallbackCaption, this.mode.english, artWidth * 0.65);
    this.fallbackCaption.anchor.set(0.5, 1);
    this.fallbackCaption.position.set(artX + artWidth * 0.5, artY + artHeight * 0.94);
    this.fallbackCaption.alpha = 0.68;

    this.artFrame.clear();
    this.artFrame
      .roundRect(artX - width * 0.008, artY - width * 0.008, artWidth + width * 0.016, artHeight + width * 0.016, artRadius)
      .stroke({ color: mixColor(accentSoft, COLORS.white, 0.26), width: width * 0.009, alpha: 0.88 });
    this.artFrame
      .roundRect(artX + width * 0.004, artY + width * 0.004, artWidth - width * 0.008, artHeight - width * 0.008, artRadius * 0.72)
      .stroke({ color: accent, width: width * 0.004, alpha: 0.72 });
    const bracket = width * 0.07;
    this.artFrame
      .moveTo(artX, artY + bracket)
      .lineTo(artX, artY)
      .lineTo(artX + bracket, artY)
      .moveTo(artX + artWidth - bracket, artY + artHeight)
      .lineTo(artX + artWidth, artY + artHeight)
      .lineTo(artX + artWidth, artY + artHeight - bracket)
      .stroke({ color: ornament, width: width * 0.006, alpha: 0.66 });
  }

  private drawInformationPanel(): void {
    const width = this.cardWidth;
    const height = this.cardHeight;
    const panelX = width * INFO_X_RATIO;
    const panelY = height * INFO_Y_RATIO;
    const panelWidth = width * INFO_WIDTH_RATIO;
    const panelHeight = height * INFO_HEIGHT_RATIO;
    const visual = this.visualStyle;
    const { accent, accentSoft, deep, ink, ornament, paper, secondary } = visual;
    const statY = height * CARD_FACE_LAYOUT.stats.y;
    const statRadius = width * CARD_FACE_LAYOUT.stats.radius;
    const attackX = width * CARD_FACE_LAYOUT.stats.leftX;
    const defenseX = width * CARD_FACE_LAYOUT.stats.rightX;

    this.infoPanel.clear();
    this.infoPanel
      .roundRect(panelX, panelY, panelWidth, panelHeight, width * 0.024)
      .fill({ color: mixColor(deep, ink, 0.82), alpha: 0.72 })
      .stroke({ color: mixColor(accent, paper, 0.24), width: width * 0.0032, alpha: 0.5 });
    this.infoPanel
      .rect(panelX + width * 0.035, panelY + height * 0.034, panelWidth - width * 0.07, width * 0.0024)
      .fill({ color: accent, alpha: 0.28 });
    this.infoPanel
      .moveTo(panelX + width * 0.018, panelY + width * 0.055)
      .lineTo(panelX + width * 0.018, panelY + width * 0.018)
      .lineTo(panelX + width * 0.07, panelY + width * 0.018)
      .moveTo(panelX + panelWidth - width * 0.07, panelY + panelHeight - width * 0.018)
      .lineTo(panelX + panelWidth - width * 0.018, panelY + panelHeight - width * 0.018)
      .lineTo(panelX + panelWidth - width * 0.018, panelY + panelHeight - width * 0.055)
      .stroke({ color: mixColor(ornament, ink, 0.34), width: width * 0.004, alpha: 0.62 });

    this.infoTextMask
      .clear()
      .roundRect(
        panelX + width * 0.02,
        panelY + width * 0.012,
        panelWidth - width * 0.04,
        panelHeight - width * 0.024,
        width * 0.016,
      )
      .fill(COLORS.white);

    // Attack uses a cinnabar flame seal: broad static shapes keep the element
    // legible without adding filters or per-frame particles to every card.
    this.infoPanel
      .moveTo(attackX - statRadius * 0.86, statY + statRadius * 0.42)
      .bezierCurveTo(
        attackX - statRadius * 1.18,
        statY - statRadius * 0.18,
        attackX - statRadius * 0.42,
        statY - statRadius * 0.86,
        attackX - statRadius * 0.2,
        statY - statRadius * 1.46,
      )
      .bezierCurveTo(
        attackX + statRadius * 0.12,
        statY - statRadius * 0.92,
        attackX + statRadius * 0.34,
        statY - statRadius * 0.42,
        attackX + statRadius * 0.16,
        statY + statRadius * 0.48,
      )
      .closePath()
      .fill({ color: COLORS.cinnabar, alpha: 0.82 });
    this.infoPanel
      .moveTo(attackX + statRadius * 0.1, statY + statRadius * 0.46)
      .bezierCurveTo(
        attackX + statRadius * 0.52,
        statY - statRadius * 0.32,
        attackX + statRadius * 0.82,
        statY - statRadius * 0.54,
        attackX + statRadius * 0.7,
        statY - statRadius * 1.08,
      )
      .bezierCurveTo(
        attackX + statRadius * 1.24,
        statY - statRadius * 0.48,
        attackX + statRadius * 1.16,
        statY + statRadius * 0.3,
        attackX + statRadius * 0.62,
        statY + statRadius * 0.68,
      )
      .closePath()
      .fill({ color: COLORS.coral, alpha: 0.56 });
    this.infoPanel
      .circle(attackX, statY, statRadius * 1.1)
      .fill({ color: COLORS.black, alpha: 0.46 });
    this.infoPanel
      .circle(attackX, statY, statRadius)
      .fill({ color: mixColor(COLORS.cinnabar, deep, 0.54), alpha: 0.98 })
      .stroke({ color: mixColor(COLORS.coral, paper, 0.28), width: width * 0.006, alpha: 0.94 });
    this.infoPanel
      .moveTo(attackX - statRadius * 0.46, statY + statRadius * 0.37)
      .bezierCurveTo(
        attackX - statRadius * 0.18,
        statY + statRadius * 0.06,
        attackX - statRadius * 0.12,
        statY - statRadius * 0.32,
        attackX + statRadius * 0.06,
        statY - statRadius * 0.58,
      )
      .bezierCurveTo(
        attackX + statRadius * 0.54,
        statY - statRadius * 0.08,
        attackX + statRadius * 0.38,
        statY + statRadius * 0.34,
        attackX + statRadius * 0.16,
        statY + statRadius * 0.5,
      )
      .stroke({ color: COLORS.gold, width: width * 0.003, alpha: 0.56 });

    // Defense is a jade guard with concentric water ripples and a quiet wave
    // picked out beneath the numeral.
    this.infoPanel
      .ellipse(defenseX, statY + statRadius * 0.62, statRadius * 1.42, statRadius * 0.42)
      .stroke({ color: COLORS.cyan, width: width * 0.0035, alpha: 0.48 });
    this.infoPanel
      .ellipse(defenseX, statY + statRadius * 0.82, statRadius * 1.14, statRadius * 0.28)
      .stroke({ color: COLORS.jade, width: width * 0.003, alpha: 0.58 });
    this.infoPanel
      .circle(defenseX, statY, statRadius * 1.1)
      .fill({ color: COLORS.black, alpha: 0.46 });
    this.infoPanel
      .circle(defenseX, statY, statRadius)
      .fill({ color: mixColor(COLORS.jadeDeep, deep, 0.46), alpha: 0.98 })
      .stroke({ color: mixColor(COLORS.jade, paper, 0.18), width: width * 0.006, alpha: 0.94 });
    this.infoPanel
      .moveTo(defenseX - statRadius * 0.66, statY + statRadius * 0.3)
      .quadraticCurveTo(
        defenseX - statRadius * 0.32,
        statY + statRadius * 0.02,
        defenseX,
        statY + statRadius * 0.3,
      )
      .quadraticCurveTo(
        defenseX + statRadius * 0.32,
        statY + statRadius * 0.58,
        defenseX + statRadius * 0.66,
        statY + statRadius * 0.3,
      )
      .stroke({ color: mixColor(COLORS.cyan, paper, 0.18), width: width * 0.003, alpha: 0.62 });

    const costRadius = width * CARD_FACE_LAYOUT.cost.radius;
    const costX = width * CARD_FACE_LAYOUT.cost.x;
    const costY = height * CARD_FACE_LAYOUT.cost.y;
    const starPoints: number[] = [];
    for (let index = 0; index < 16; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / 8;
      const radius = index % 2 === 0 ? costRadius * 1.48 : costRadius * 1.02;
      starPoints.push(costX + Math.cos(angle) * radius, costY + Math.sin(angle) * radius);
    }
    this.infoPanel
      .poly(starPoints)
      .fill({ color: COLORS.gold, alpha: 0.46 })
      .stroke({ color: mixColor(COLORS.gold, paper, 0.24), width: width * 0.0025, alpha: 0.62 });
    this.infoPanel
      .circle(costX, costY, costRadius * 1.14)
      .fill({ color: COLORS.black, alpha: 0.46 });
    this.infoPanel
      .circle(costX, costY, costRadius)
      .fill({ color: mixColor(COLORS.gold, COLORS.bronze, 0.5), alpha: 0.98 })
      .stroke({ color: mixColor(COLORS.gold, paper, 0.32), width: width * 0.0055, alpha: 0.94 });
    this.infoPanel
      .circle(costX - costRadius * 0.22, costY - costRadius * 0.24, costRadius * 0.2)
      .fill({ color: COLORS.white, alpha: 0.36 });
    this.infoPanel
      .circle(costX + costRadius * 1.32, costY - costRadius * 0.8, costRadius * 0.12)
      .circle(costX - costRadius * 1.2, costY + costRadius * 0.88, costRadius * 0.08)
      .fill({ color: COLORS.paper, alpha: 0.72 });
  }

  private drawGameplayMarks(): void {
    const width = this.cardWidth;
    const height = this.cardHeight;
    const visual = this.visualStyle;
    const presentation = buildCardGameplayPresentation(
      this.data,
      this.gameplayModules,
      this.gameplayDisplayTier ?? width,
    );

    this.gameplayFoundation.clear();
    this.gameplayLinework.clear();
    for (const label of this.gameplayTexts) label.visible = false;
    if (presentation.items.length === 0) return;

    let textCursor = 0;
    const nextText = (): Text | undefined => {
      const label = this.gameplayTexts[textCursor];
      textCursor += 1;
      if (!label) return undefined;
      label.visible = true;
      label.alpha = 1;
      label.rotation = 0;
      return label;
    };

    // Matching glyphs stay in the left margin so the character illustration
    // and the rule seals remain independently readable.
    const visibleRapidSymbols = presentation.rapidSymbols.slice(0, 6);
    if (visibleRapidSymbols.length > 0) {
      const top = height * 0.205;
      const bottom = height * 0.69;
      const sealX = width * 0.112;
      const radius = width * (
        presentation.tier === 'thumbnail'
          ? 0.034
          : presentation.tier === 'standard'
            ? 0.04
            : 0.047
      );
      const spacing = visibleRapidSymbols.length <= 1
        ? 0
        : (bottom - top) / (visibleRapidSymbols.length - 1);

      visibleRapidSymbols.forEach((symbol, index) => {
        const centerY = visibleRapidSymbols.length <= 1 ? (top + bottom) / 2 : top + spacing * index;
        const accent = colorFromHex(symbol.accentHex, visual.accent);
        const diamond = radius * 1.2;
        this.gameplayFoundation
          .poly([
            sealX, centerY - diamond,
            sealX + diamond, centerY,
            sealX, centerY + diamond,
            sealX - diamond, centerY,
          ])
          .fill({ color: mixColor(visual.deep, accent, 0.22), alpha: 0.78 });
        this.gameplayFoundation
          .circle(sealX, centerY, radius)
          .fill({ color: mixColor(visual.ink, visual.deep, 0.42), alpha: 0.9 });
        this.gameplayLinework
          .circle(sealX, centerY, radius)
          .stroke({
            color: mixColor(accent, visual.paper, 0.28),
            width: Math.max(0.55, width * 0.003),
            alpha: 0.92,
          });
        this.gameplayLinework
          .circle(sealX, centerY, radius * 0.72)
          .stroke({
            color: visual.ornament,
            width: Math.max(0.35, width * 0.0018),
            alpha: 0.54,
          });

        const glyph = nextText();
        if (!glyph) return;
        glyph.text = symbol.glyph;
        glyph.style = new TextStyle({
          fontFamily: DISPLAY_FONT,
          fontSize: fontSize(width, 0.048, 5.5, 15),
          fontWeight: '800',
          fill: mixColor(visual.paper, COLORS.white, 0.14),
          stroke: {
            color: mixColor(visual.ink, COLORS.black, 0.48),
            width: Math.max(0.45, width * 0.0024),
            join: 'round',
          },
          letterSpacing: 0,
        });
        glyph.anchor.set(0.5);
        glyph.position.set(sealX, centerY);
      });
    }

    const visibleItems = presentation.items.slice(0, 4);
    if (visibleItems.length > 0) {
      const areaTop = height * 0.19;
      const areaBottom = height * 0.71;
      const areaHeight = areaBottom - areaTop;
      const compact = presentation.tier === 'thumbnail';
      const tagWidth = width * (
        compact ? 0.105 : presentation.tier === 'standard' ? 0.135 : 0.145
      );
      const maximumTagHeight = width * (
        compact ? 0.105 : presentation.tier === 'standard' ? 0.28 : 0.34
      );
      const gap = Math.max(1.5, width * 0.012);
      const tagHeight = Math.min(
        maximumTagHeight,
        (areaHeight - gap * Math.max(0, visibleItems.length - 1)) / visibleItems.length,
      );
      const groupHeight = tagHeight * visibleItems.length + gap * Math.max(0, visibleItems.length - 1);
      const startY = areaTop + (areaHeight - groupHeight) / 2;
      const tagX = width * 0.945 - tagWidth;

      visibleItems.forEach((item, index) => {
        const tagY = startY + index * (tagHeight + gap);
        const centerX = tagX + tagWidth / 2;
        const accent = colorFromHex(item.accentHex, visual.accent);

        if (compact) {
          const radius = Math.min(tagWidth, tagHeight) / 2;
          this.gameplayFoundation
            .circle(centerX, tagY + tagHeight / 2, radius)
            .fill({ color: mixColor(visual.deep, accent, 0.2), alpha: 0.88 });
          this.gameplayLinework
            .circle(centerX, tagY + tagHeight / 2, radius)
            .stroke({
              color: mixColor(accent, visual.paper, 0.24),
              width: Math.max(0.45, width * 0.0025),
              alpha: 0.92,
            });
        } else {
          const notch = Math.min(tagWidth * 0.18, tagHeight * 0.12);
          const outline = [
            tagX + notch, tagY,
            tagX + tagWidth - notch, tagY,
            tagX + tagWidth, tagY + notch,
            tagX + tagWidth, tagY + tagHeight - notch,
            tagX + tagWidth - notch, tagY + tagHeight,
            tagX + notch, tagY + tagHeight,
            tagX, tagY + tagHeight - notch,
            tagX, tagY + notch,
          ];
          this.gameplayFoundation
            .poly(outline)
            .fill({ color: mixColor(visual.deep, accent, 0.14), alpha: 0.88 });
          this.gameplayFoundation
            .rect(tagX, tagY + notch, Math.max(1, width * 0.006), tagHeight - notch * 2)
            .fill({ color: accent, alpha: 0.72 });
          this.gameplayLinework
            .poly(outline)
            .stroke({
              color: mixColor(accent, visual.paper, 0.22),
              width: Math.max(0.5, width * 0.0026),
              alpha: 0.9,
            });
          this.gameplayLinework
            .moveTo(tagX + tagWidth * 0.2, tagY + tagHeight * 0.47)
            .lineTo(tagX + tagWidth * 0.8, tagY + tagHeight * 0.47)
            .stroke({
              color: visual.ornament,
              width: Math.max(0.35, width * 0.0015),
              alpha: 0.46,
            });
        }

        const mark = nextText();
        if (mark) {
          mark.text = item.mark;
          mark.style = new TextStyle({
            fontFamily: DISPLAY_FONT,
            fontSize: fontSize(width, compact ? 0.04 : 0.052, 5, 17),
            fontWeight: '800',
            fill: mixColor(visual.paper, COLORS.white, 0.16),
            stroke: {
              color: mixColor(visual.ink, COLORS.black, 0.52),
              width: Math.max(0.4, width * 0.0025),
              join: 'round',
            },
            letterSpacing: 0,
          });
          mark.anchor.set(0.5);
          mark.position.set(
            centerX,
            compact ? tagY + tagHeight / 2 : tagY + tagHeight * 0.27,
          );
        }

        if (compact || !item.primary) return;
        const detail = nextText();
        if (!detail) return;
        const detailSize = fontSize(
          width,
          presentation.tier === 'full' ? 0.021 : 0.023,
          5.2,
          8,
        );
        const maximumLines = presentation.tier === 'full'
          ? (visibleItems.length <= 2 ? 4 : 3)
          : 2;
        const parts = presentation.tier === 'full'
          ? [
              ...(visibleItems.length <= 2 ? [item.moduleName] : []),
              item.primary,
              item.relation || item.secondary,
            ]
          : [item.primary];
        const lines: string[] = [];
        for (const part of parts.filter(Boolean)) {
          const remainingLines = maximumLines - lines.length;
          if (remainingLines <= 0) break;
          lines.push(...fitMultiline(part, tagWidth * 0.82, detailSize, remainingLines).split('\n'));
        }
        detail.text = lines.slice(0, maximumLines).join('\n');
        detail.style = new TextStyle({
          fontFamily: FONT_FAMILY,
          fontSize: detailSize,
          fontWeight: '700',
          fill: mixColor(visual.paper, COLORS.white, 0.08),
          stroke: {
            color: mixColor(visual.ink, COLORS.black, 0.56),
            width: Math.max(0.32, width * 0.0017),
            join: 'round',
          },
          align: 'center',
          lineHeight: detailSize * 1.12,
          letterSpacing: 0,
        });
        detail.anchor.set(0.5);
        detail.position.set(centerX, tagY + tagHeight * 0.72);
      });
    }

    const overflowCount = Math.max(
      presentation.overflowCount,
      presentation.items.length - visibleItems.length,
      presentation.rapidSymbols.length - visibleRapidSymbols.length,
    );
    if (overflowCount > 0) {
      const centerX = width * 0.88;
      const centerY = height * 0.742;
      const radius = width * 0.036;
      this.gameplayFoundation
        .circle(centerX, centerY, radius)
        .fill({ color: mixColor(visual.deep, visual.accent, 0.2), alpha: 0.92 });
      this.gameplayLinework
        .circle(centerX, centerY, radius)
        .stroke({
          color: visual.ornament,
          width: Math.max(0.5, width * 0.0024),
          alpha: 0.94,
        });
      const overflow = nextText();
      if (overflow) {
        overflow.text = `+${overflowCount}`;
        overflow.style = new TextStyle({
          fontFamily: FONT_FAMILY,
          fontSize: fontSize(width, 0.026, 4.5, 9),
          fontWeight: '800',
          fill: visual.paper,
          stroke: {
            color: visual.ink,
            width: Math.max(0.35, width * 0.0018),
            join: 'round',
          },
          letterSpacing: 0,
        });
        overflow.anchor.set(0.5);
        overflow.position.set(centerX, centerY);
      }
    }
  }

  private drawFoil(): void {
    const width = this.cardWidth;
    const height = this.cardHeight;
    const visual = this.visualStyle;
    const { accent, accentSoft, ornament, paper, secondary } = visual;
    const rarityFoil = RARITY_FOIL[this.data.rarity];
    const rarityColor = RARITY_COLOR[this.data.rarity];
    const compact = width < 108;
    const spectrum = visual.styled
      ? [ornament, accent, secondary, accentSoft, mixColor(accent, paper, 0.42), mixColor(secondary, paper, 0.3)]
      : [COLORS.gold, COLORS.jade, COLORS.cyan, COLORS.coral, COLORS.violet, accentSoft];

    this.foilSheen.clear();
    for (let index = -4; index < 10; index += 1) {
      const start = index * width * 0.17;
      const bandWidth = width * (index % 2 === 0 ? 0.082 : 0.045);
      this.foilSheen
        .moveTo(start, -height * 0.05)
        .lineTo(start + bandWidth, -height * 0.05)
        .lineTo(start + bandWidth - width * 0.38, height * 1.05)
        .lineTo(start - width * 0.38, height * 1.05)
        .closePath()
        .fill({
          color: spectrum[(index + 12) % spectrum.length],
          alpha: index % 2 === 0 ? 0.07 : 0.038,
        });
    }

    const artX = width * ART_X_RATIO;
    const artY = height * ART_Y_RATIO;
    const artWidth = width * ART_WIDTH_RATIO;
    const artHeight = height * ART_HEIGHT_RATIO;
    const textureScale = width / DEFAULT_CARD_WIDTH;
    const phase = this.foilPhase;

    this.artIridescence.position.set(artX, artY);
    this.artIridescence.width = artWidth;
    this.artIridescence.height = artHeight;
    this.artIridescence.tileScale.set(
      rarityFoil.coarseScale * textureScale,
      rarityFoil.coarseScale * textureScale,
    );
    this.artIridescence.tileRotation = rarityFoil.coarseAngle;
    this.artIridescence.tilePosition.set(phase * width * 0.42, -phase * height * 0.16);
    this.artIridescence.tint = mixColor(COLORS.white, rarityColor, 0.08);

    this.artMicroFoil.position.set(artX, artY);
    this.artMicroFoil.width = artWidth;
    this.artMicroFoil.height = artHeight;
    this.artMicroFoil.tileScale.set(
      rarityFoil.fineScale * textureScale,
      rarityFoil.fineScale * textureScale,
    );
    this.artMicroFoil.tileRotation = rarityFoil.fineAngle;
    this.artMicroFoil.tilePosition.set(-phase * width * 0.65, phase * height * 0.24);
    this.artMicroFoil.tint = mixColor(rarityColor, COLORS.white, 0.62);

    const cardRadius = width * (visual.styled ? cornerRadiusRatio(visual.corner) : 0.066);
    const borderInset = width * 0.046;
    this.borderFoil.position.set(0, 0);
    this.borderFoil.width = width;
    this.borderFoil.height = height;
    this.borderFoil.tileScale.set(textureScale * 0.68, textureScale * 0.68);
    this.borderFoil.tileRotation = -0.18 + rarityFoil.coarseAngle * 0.22;
    this.borderFoil.tilePosition.set(phase * width * 0.3, phase * width * -0.18);
    this.borderFoil.tint = mixColor(COLORS.white, rarityColor, 0.12);
    this.borderFoilMask
      .clear()
      .roundRect(0, 0, width, height, cardRadius)
      .fill(COLORS.white)
      .roundRect(
        borderInset,
        borderInset,
        width - borderInset * 2,
        height - borderInset * 2,
        Math.max(1, cardRadius * 0.62),
      )
      .cut();

    this.artFoil.clear();
    for (let index = -2; index < 10; index += 1) {
      const x = artX + index * artWidth * 0.105;
      const bandWidth = artWidth * (index % 3 === 0 ? 0.12 : 0.065);
      this.artFoil
        .moveTo(x, artY - width * 0.03)
        .lineTo(x + bandWidth, artY - width * 0.03)
        .lineTo(x - artWidth * 0.12 + bandWidth, artY + artHeight + width * 0.03)
        .lineTo(x - artWidth * 0.12, artY + artHeight + width * 0.03)
        .closePath()
        .fill({
          color: spectrum[(index + 8) % spectrum.length],
          alpha: index % 2 === 0 ? 0.15 : 0.085,
        });
    }
    if (!compact) {
      for (let index = 0; index <= 14; index += 1) {
        const x = artX + (artWidth * index) / 14;
        this.artFoil
          .moveTo(x, artY)
          .bezierCurveTo(
            x + width * 0.026,
            artY + artHeight * 0.28,
            x - width * 0.034,
            artY + artHeight * 0.7,
            x + width * 0.014,
            artY + artHeight,
          )
          .stroke({ color: spectrum[index % spectrum.length], width: width * 0.0018, alpha: 0.16 });
      }
    }

    this.surfaceGrain.clear();
    const grainLines = compact ? 18 : 34;
    const grainSpan = width + height * 0.34;
    for (let index = 0; index <= grainLines; index += 1) {
      const x = -height * 0.2 + (grainSpan * index) / grainLines;
      this.surfaceGrain
        .moveTo(x, -height * 0.04)
        .lineTo(x - height * 0.22, height * 1.04)
        .stroke({
          color: index % 5 === 0 ? ornament : index % 3 === 0 ? secondary : paper,
          width: Math.max(0.35, width * 0.0013),
          alpha: index % 5 === 0 ? 0.09 : 0.04,
        });
    }
    if (!compact) {
      for (let index = 0; index < 12; index += 1) {
        const y = height * (0.08 + index * 0.075);
        this.surfaceGrain
          .moveTo(width * 0.04, y)
          .bezierCurveTo(width * 0.3, y - width * 0.02, width * 0.7, y + width * 0.02, width * 0.96, y)
          .stroke({ color: index % 2 === 0 ? accent : secondary, width: width * 0.001, alpha: 0.028 });
      }
    }

    this.framePrism.clear();
    this.framePrism
      .moveTo(width * 0.036, height * 0.17)
      .lineTo(width * 0.036, height * 0.83)
      .stroke({ color: accent, width: width * 0.012, alpha: 0.36 });
    this.framePrism
      .moveTo(width * 0.964, height * 0.17)
      .lineTo(width * 0.964, height * 0.83)
      .stroke({ color: secondary, width: width * 0.01, alpha: 0.34 });
    this.framePrism
      .moveTo(width * 0.06, width * 0.09)
      .lineTo(width * 0.06, width * 0.045)
      .lineTo(width * 0.13, width * 0.045)
      .moveTo(width * 0.87, height - width * 0.045)
      .lineTo(width * 0.94, height - width * 0.045)
      .lineTo(width * 0.94, height - width * 0.09)
      .stroke({ color: ornament, width: width * 0.006, alpha: 0.62 });
    const fretCount = compact ? 4 : 6;
    const fretWidth = width * 0.105;
    const fretStart = (width - fretCount * fretWidth) / 2;
    for (let index = 0; index < fretCount; index += 1) {
      const x = fretStart + index * fretWidth;
      this.framePrism
        .moveTo(x, width * 0.039)
        .lineTo(x + fretWidth * 0.66, width * 0.039)
        .lineTo(x + fretWidth * 0.66, width * 0.057)
        .lineTo(x + fretWidth * 0.38, width * 0.057)
        .lineTo(x + fretWidth * 0.38, width * 0.048)
        .stroke({ color: index % 2 === 0 ? ornament : accent, width: width * 0.0025, alpha: 0.48 });
      this.framePrism
        .moveTo(width - x, height - width * 0.039)
        .lineTo(width - x - fretWidth * 0.66, height - width * 0.039)
        .lineTo(width - x - fretWidth * 0.66, height - width * 0.057)
        .lineTo(width - x - fretWidth * 0.38, height - width * 0.057)
        .stroke({ color: index % 2 === 0 ? secondary : ornament, width: width * 0.0025, alpha: 0.4 });
    }
    const bronzeRivet = width * 0.007;
    this.framePrism
      .circle(width * 0.052, width * 0.052, bronzeRivet)
      .circle(width * 0.948, width * 0.052, bronzeRivet)
      .circle(width * 0.052, height - width * 0.052, bronzeRivet)
      .circle(width * 0.948, height - width * 0.052, bronzeRivet)
      .fill({ color: ornament, alpha: 0.7 });
    if (visual.styled) this.drawStyleFrameMotif(compact);

    this.specularBeam.clear();
    this.specularBeam
      .moveTo(-width * 0.21, -height * 0.08)
      .lineTo(width * 0.18, -height * 0.08)
      .lineTo(width * 0.08, height * 1.08)
      .lineTo(-width * 0.3, height * 1.08)
      .closePath()
      .fill({ color: ornament, alpha: 0.09 });
    this.specularBeam
      .moveTo(-width * 0.08, -height * 0.08)
      .lineTo(width * 0.075, -height * 0.08)
      .lineTo(-width * 0.01, height * 1.08)
      .lineTo(-width * 0.16, height * 1.08)
      .closePath()
      .fill({ color: COLORS.white, alpha: 0.22 });
    this.specularBeam
      .moveTo(width * 0.07, -height * 0.08)
      .lineTo(width * 0.14, -height * 0.08)
      .lineTo(width * 0.035, height * 1.08)
      .lineTo(-width * 0.035, height * 1.08)
      .closePath()
      .fill({ color: secondary, alpha: 0.16 });
    this.specularBeam
      .moveTo(-width * 0.16, -height * 0.08)
      .lineTo(-width * 0.1, -height * 0.08)
      .lineTo(-width * 0.2, height * 1.08)
      .lineTo(-width * 0.26, height * 1.08)
      .closePath()
      .fill({ color: accent, alpha: 0.12 });

    this.localHighlight.width = width * 1.22;
    this.localHighlight.height = width * 1.02;
    this.localHighlight.tint = mixColor(COLORS.white, rarityColor, 0.1);
    this.localHighlight.position.set(this.highlightX, this.highlightY);

    this.borderGlow.clear();
    this.borderGlow
      .roundRect(width * 0.019, width * 0.019, width * 0.962, height - width * 0.038, width * 0.052)
      .stroke({ color: accent, width: width * 0.012, alpha: 0.8 });
    this.borderGlow
      .roundRect(width * 0.035, width * 0.035, width * 0.93, height - width * 0.07, width * 0.042)
      .stroke({ color: ornament, width: width * 0.003, alpha: 0.5 });

    this.edgeGlints.clear();
    const glintLength = width * 0.14;
    const glintInset = width * 0.035;
    this.edgeGlints
      .moveTo(glintInset, width * 0.11)
      .lineTo(glintInset, glintInset)
      .lineTo(glintInset + glintLength, glintInset)
      .stroke({ color: COLORS.white, width: width * 0.006, alpha: 0.84 });
    this.edgeGlints
      .moveTo(width - glintInset - glintLength, height - glintInset)
      .lineTo(width - glintInset, height - glintInset)
      .lineTo(width - glintInset, height - width * 0.11)
      .stroke({ color: accentSoft, width: width * 0.005, alpha: 0.7 });
    this.edgeGlints
      .moveTo(width * 0.74, width * 0.037)
      .lineTo(width * 0.9, width * 0.037)
      .stroke({ color: secondary, width: width * 0.003, alpha: 0.64 });

    this.artFoil.alpha = 0.14 * this.foilIntensity;
    this.artIridescence.alpha = rarityFoil.broadAlpha * this.foilIntensity;
    this.artMicroFoil.alpha = rarityFoil.fineAlpha * this.foilIntensity;
    this.borderFoil.alpha = rarityFoil.borderAlpha * this.foilIntensity;
    this.surfaceGrain.alpha = 0.22 + this.foilIntensity * 0.16;
    this.framePrism.alpha = 0.34 + this.foilIntensity * 0.3;
    this.foilSheen.alpha = 0.13 * this.foilIntensity;
    this.specularBeam.alpha = 0.08 * this.foilIntensity;
    this.borderGlow.alpha = 0.22 + this.foilIntensity * 0.2;
    this.edgeGlints.alpha = 0.3 + this.foilIntensity * 0.3;
    const detailedFoil = width >= 108;
    this.artIridescence.visible = detailedFoil && this.foilIntensity > 0.001;
    this.artMicroFoil.visible = detailedFoil && this.foilIntensity > 0.001;
    this.borderFoil.visible = detailedFoil && this.foilIntensity > 0.001;
    this.artFoil.visible = detailedFoil;
    this.surfaceGrain.visible = detailedFoil;
    this.specularBeam.visible = detailedFoil;
    this.localHighlight.visible = detailedFoil;
  }

  private drawStyleFrameMotif(compact: boolean): void {
    const width = this.cardWidth;
    const height = this.cardHeight;
    const visual = this.visualStyle;
    const graphics = this.framePrism;
    const line = Math.max(0.45, width * 0.0032);
    const top = width * 0.046;
    const bottom = height - top;
    const left = width * 0.044;
    const right = width - left;
    const count = compact ? 2 : 4;

    if (visual.motif === 'cloud') {
      for (let index = 0; index < count; index += 1) {
        const x = width * (0.22 + index * (0.56 / Math.max(1, count - 1)));
        const span = width * 0.11;
        graphics
          .moveTo(x - span, top)
          .bezierCurveTo(x - span * 0.62, top - width * 0.018, x - span * 0.3, top + width * 0.018, x, top)
          .bezierCurveTo(x + span * 0.3, top - width * 0.018, x + span * 0.62, top + width * 0.018, x + span, top)
          .stroke({ color: index % 2 === 0 ? visual.ornament : visual.accentSoft, width: line, alpha: 0.66 });
      }
    } else if (visual.motif === 'ink') {
      for (let index = 0; index < count + 1; index += 1) {
        const y = height * (0.2 + index * (0.6 / Math.max(1, count)));
        graphics
          .moveTo(left, y)
          .bezierCurveTo(left + width * 0.018, y - width * 0.07, left - width * 0.012, y + width * 0.055, left + width * 0.022, y + width * 0.095)
          .stroke({ color: index % 2 === 0 ? visual.accentSoft : visual.ornament, width: line * (index % 2 === 0 ? 1.4 : 0.72), alpha: 0.56 });
      }
      graphics
        .moveTo(width * 0.25, bottom)
        .bezierCurveTo(width * 0.4, bottom - width * 0.026, width * 0.6, bottom + width * 0.018, width * 0.75, bottom - width * 0.008)
        .stroke({ color: visual.accent, width: line * 1.25, alpha: 0.48 });
    } else if (visual.motif === 'flower') {
      const centers = [[width * 0.12, width * 0.12], [width * 0.88, height - width * 0.12]];
      for (const [x, y] of centers) {
        for (let petal = 0; petal < 4; petal += 1) {
          const angle = (petal * Math.PI) / 2;
          graphics.ellipse(
            x + Math.cos(angle) * width * 0.027,
            y + Math.sin(angle) * width * 0.027,
            width * (petal % 2 === 0 ? 0.034 : 0.018),
            width * (petal % 2 === 0 ? 0.018 : 0.034),
          ).stroke({ color: petal % 2 === 0 ? visual.ornament : visual.secondary, width: line, alpha: 0.62 });
        }
        graphics.circle(x, y, width * 0.009).fill({ color: visual.accentSoft, alpha: 0.76 });
      }
    } else if (visual.motif === 'cut') {
      const segments = compact ? 6 : 10;
      for (let index = 0; index <= segments; index += 1) {
        const x = width * 0.18 + (width * 0.64 * index) / segments;
        const y = top + (index % 2 === 0 ? -width * 0.012 : width * 0.012);
        if (index === 0) graphics.moveTo(x, y);
        else graphics.lineTo(x, y);
      }
      graphics.stroke({ color: visual.accentSoft, width: line * 1.35, alpha: 0.68 });
      graphics
        .moveTo(width * 0.18, bottom)
        .lineTo(width * 0.27, bottom - width * 0.024)
        .lineTo(width * 0.36, bottom)
        .moveTo(width * 0.64, bottom)
        .lineTo(width * 0.73, bottom - width * 0.024)
        .lineTo(width * 0.82, bottom)
        .stroke({ color: visual.ornament, width: line, alpha: 0.64 });
    } else if (visual.motif === 'shadow') {
      graphics
        .moveTo(left, height * 0.31)
        .quadraticCurveTo(width * 0.14, height * 0.22, width * 0.2, height * 0.31)
        .moveTo(right, height * 0.69)
        .quadraticCurveTo(width * 0.86, height * 0.78, width * 0.8, height * 0.69)
        .stroke({ color: visual.accentSoft, width: line * 1.2, alpha: 0.7 });
      for (let index = 0; index < (compact ? 3 : 6); index += 1) {
        graphics.circle(width * (0.3 + index * 0.08), top, width * 0.0055).fill({ color: index % 2 === 0 ? visual.ornament : visual.secondary, alpha: 0.68 });
      }
    } else if (visual.motif === 'cave') {
      graphics
        .moveTo(width * 0.15, top)
        .bezierCurveTo(width * 0.3, top + width * 0.04, width * 0.42, top - width * 0.035, width * 0.56, top)
        .bezierCurveTo(width * 0.7, top + width * 0.04, width * 0.76, top - width * 0.025, width * 0.86, top)
        .stroke({ color: visual.ornament, width: line * 1.3, alpha: 0.66 });
      graphics
        .moveTo(width * 0.2, bottom)
        .bezierCurveTo(width * 0.38, bottom - width * 0.04, width * 0.62, bottom + width * 0.04, width * 0.8, bottom)
        .stroke({ color: visual.secondary, width: line, alpha: 0.56 });
    } else if (visual.motif === 'lacquer') {
      const steps = compact ? 3 : 5;
      for (let index = 0; index < steps; index += 1) {
        const x = width * (0.2 + index * (0.6 / Math.max(1, steps - 1)));
        graphics
          .moveTo(x - width * 0.045, top)
          .lineTo(x + width * 0.018, top)
          .lineTo(x + width * 0.018, top + width * 0.018)
          .lineTo(x + width * 0.048, top + width * 0.018)
          .stroke({ color: index % 2 === 0 ? visual.ornament : visual.accent, width: line, alpha: 0.68 });
      }
      graphics.ellipse(width * 0.5, bottom, width * 0.11, width * 0.025).stroke({ color: visual.ornament, width: line * 1.15, alpha: 0.58 });
    } else if (visual.motif === 'porcelain') {
      for (let index = 0; index < count; index += 1) {
        const x = width * (0.18 + index * (0.64 / Math.max(1, count - 1)));
        graphics
          .moveTo(x - width * 0.07, bottom)
          .quadraticCurveTo(x - width * 0.035, bottom - width * 0.028, x, bottom)
          .quadraticCurveTo(x + width * 0.035, bottom + width * 0.028, x + width * 0.07, bottom)
          .stroke({ color: index % 2 === 0 ? visual.secondary : visual.accent, width: line, alpha: 0.7 });
      }
    } else if (visual.motif === 'enamel') {
      const cells = compact ? 4 : 7;
      for (let index = 0; index < cells; index += 1) {
        const x = width * (0.22 + index * (0.56 / Math.max(1, cells - 1)));
        const size = width * 0.022;
        graphics
          .moveTo(x, top - size)
          .lineTo(x + size, top)
          .lineTo(x, top + size)
          .lineTo(x - size, top)
          .closePath()
          .stroke({ color: index % 3 === 0 ? visual.ornament : index % 2 === 0 ? visual.secondary : visual.accent, width: line, alpha: 0.68 });
      }
    } else if (visual.motif === 'print') {
      const marks = compact ? 5 : 9;
      for (let index = 0; index < marks; index += 1) {
        const x = width * (0.16 + index * (0.68 / Math.max(1, marks - 1)));
        graphics
          .moveTo(x - width * 0.025, top - width * 0.009)
          .lineTo(x + width * 0.025, top + width * 0.009)
          .stroke({ color: index % 2 === 0 ? visual.accent : visual.ink, width: line * 1.5, alpha: 0.58 });
      }
    } else if (visual.motif === 'bronze') {
      for (const direction of [-1, 1]) {
        const x = width * 0.5 + direction * width * 0.21;
        graphics
          .moveTo(x, top - width * 0.025)
          .lineTo(x + direction * width * 0.055, top)
          .lineTo(x, top + width * 0.025)
          .lineTo(x - direction * width * 0.035, top)
          .closePath()
          .stroke({ color: visual.ornament, width: line * 1.2, alpha: 0.68 });
        graphics.circle(x, top, width * 0.008).fill({ color: visual.secondary, alpha: 0.72 });
      }
    } else if (visual.motif === 'mountain') {
      const peaks = compact ? 4 : 7;
      graphics.moveTo(width * 0.14, bottom);
      for (let index = 0; index < peaks; index += 1) {
        const x = width * (0.14 + ((index + 0.5) * 0.72) / peaks);
        graphics.lineTo(x, bottom - width * (index % 2 === 0 ? 0.045 : 0.025));
        graphics.lineTo(width * (0.14 + ((index + 1) * 0.72) / peaks), bottom);
      }
      graphics.stroke({ color: visual.accentSoft, width: line, alpha: 0.7 });
    } else if (visual.motif === 'crackle') {
      const branches = compact ? 2 : 4;
      for (let index = 0; index < branches; index += 1) {
        const x = width * (0.18 + index * (0.64 / Math.max(1, branches - 1)));
        graphics
          .moveTo(x, top)
          .lineTo(x + width * 0.018, top + width * 0.02)
          .lineTo(x + width * 0.006, top + width * 0.041)
          .moveTo(x + width * 0.018, top + width * 0.02)
          .lineTo(x + width * 0.041, top + width * 0.028)
          .stroke({ color: index % 2 === 0 ? visual.secondary : visual.ornament, width: line * 0.72, alpha: 0.62 });
      }
    } else if (visual.motif === 'oracle') {
      const nodes = compact ? 4 : 6;
      let previousX = width * 0.2;
      let previousY = top;
      for (let index = 0; index < nodes; index += 1) {
        const x = width * (0.2 + index * (0.6 / Math.max(1, nodes - 1)));
        const y = top + width * (index % 2 === 0 ? -0.012 : 0.016);
        if (index > 0) graphics.moveTo(previousX, previousY).lineTo(x, y).stroke({ color: visual.accentSoft, width: line * 0.7, alpha: 0.54 });
        graphics.circle(x, y, width * 0.006).fill({ color: index % 2 === 0 ? visual.ornament : visual.secondary, alpha: 0.78 });
        previousX = x;
        previousY = y;
      }
    } else if (visual.motif === 'neon') {
      for (const direction of [-1, 1]) {
        const start = width * 0.5 + direction * width * 0.08;
        graphics
          .moveTo(start, top)
          .lineTo(start + direction * width * 0.12, top)
          .lineTo(start + direction * width * 0.12, top + width * 0.025)
          .lineTo(start + direction * width * 0.23, top + width * 0.025)
          .stroke({ color: direction < 0 ? visual.accent : visual.secondary, width: line * 1.35, alpha: 0.76 });
      }
      graphics.circle(width * 0.5, top, width * 0.009).fill({ color: visual.ornament, alpha: 0.88 });
    } else if (visual.motif === 'glass') {
      const panes = compact ? 3 : 5;
      for (let index = 0; index < panes; index += 1) {
        const x = width * (0.2 + index * (0.6 / Math.max(1, panes - 1)));
        graphics
          .moveTo(x - width * 0.035, top + width * 0.025)
          .lineTo(x, top - width * 0.025)
          .lineTo(x + width * 0.035, top + width * 0.025)
          .stroke({ color: index % 2 === 0 ? visual.secondary : visual.ornament, width: line * 1.15, alpha: 0.66 });
      }
    } else if (visual.motif === 'geometry') {
      for (const direction of [-1, 1]) {
        const x = width * 0.5 + direction * width * 0.12;
        graphics
          .moveTo(x, top + width * 0.027)
          .lineTo(x + direction * width * 0.05, top + width * 0.027)
          .lineTo(x + direction * width * 0.05, top)
          .lineTo(x + direction * width * 0.11, top)
          .lineTo(x + direction * width * 0.11, top - width * 0.025)
          .stroke({ color: direction < 0 ? visual.ornament : visual.accentSoft, width: line * 1.2, alpha: 0.72 });
      }
    } else {
      const strokes = compact ? 4 : 7;
      for (let index = 0; index < strokes; index += 1) {
        const x = width * (0.18 + index * (0.64 / Math.max(1, strokes - 1)));
        graphics
          .moveTo(x - width * 0.025, bottom + width * 0.006)
          .quadraticCurveTo(x, bottom - width * 0.025, x + width * 0.035, bottom - width * 0.004)
          .stroke({ color: index % 3 === 0 ? visual.ornament : index % 2 === 0 ? visual.accent : visual.secondary, width: line * 1.8, alpha: 0.48 });
      }
    }
  }

  private drawBack(): void {
    const width = this.cardWidth;
    const height = this.cardHeight;
    const visual = this.visualStyle;
    const radius = width * (visual.styled ? cornerRadiusRatio(visual.corner) : 0.066);
    const { accent, accentSoft, deep, ink, ornament, paper, secondary } = visual;
    const random = makeRandom((this.backDesign.seed ^ hashString(this.backDesign.style)) >>> 0);
    const centerX = width / 2;
    const centerY = height * 0.47;

    this.backFrame
      .clear()
      .roundRect(0, 0, width, height, radius)
      .fill({ color: mixColor(mixColor(deep, ink, 0.68), visual.styled ? accent : COLORS.vermilion, 0.06), alpha: 1 })
      .roundRect(width * 0.012, width * 0.012, width * 0.976, height - width * 0.024, radius * 0.92)
      .stroke({ color: mixColor(accentSoft, paper, 0.42), width: width * 0.018, alpha: 0.94 })
      .roundRect(width * 0.055, width * 0.055, width * 0.89, height - width * 0.11, radius * 0.62)
      .fill({ color: mixColor(deep, ink, 0.38), alpha: 0.98 })
      .stroke({ color: accent, width: width * 0.009, alpha: 0.84 })
      .roundRect(width * 0.083, width * 0.083, width * 0.834, height - width * 0.166, radius * 0.42)
      .stroke({ color: ornament, width: width * 0.004, alpha: 0.48 });

    // The shared medallion sits above foil layers so dark art-style palettes
    // cannot wash the physical back pattern away.
    this.backPatternBase.clear();
    this.backPatternBase
      .circle(centerX, centerY, width * 0.405)
      .fill({ color: mixColor(deep, ink, 0.74), alpha: 0.72 })
      .stroke({ color: mixColor(ornament, paper, 0.18), width: width * 0.008, alpha: 0.86 });
    this.backPatternBase
      .circle(centerX, centerY, width * 0.344)
      .stroke({ color: accentSoft, width: width * 0.005, alpha: 0.7 })
      .circle(centerX, centerY, width * 0.275)
      .stroke({ color: ornament, width: width * 0.0035, alpha: 0.58 });
    for (let petal = 0; petal < 8; petal += 1) {
      const angle = (petal / 8) * Math.PI * 2;
      const innerX = centerX + Math.cos(angle) * width * 0.29;
      const innerY = centerY + Math.sin(angle) * width * 0.29;
      const outerX = centerX + Math.cos(angle) * width * 0.38;
      const outerY = centerY + Math.sin(angle) * width * 0.38;
      const tangentX = Math.cos(angle + Math.PI / 2) * width * 0.028;
      const tangentY = Math.sin(angle + Math.PI / 2) * width * 0.028;
      this.backPatternBase
        .moveTo(innerX - tangentX, innerY - tangentY)
        .quadraticCurveTo(outerX, outerY, innerX + tangentX, innerY + tangentY)
        .stroke({
          color: petal % 2 === 0 ? accent : ornament,
          width: width * 0.004,
          alpha: 0.72,
        });
    }

    this.backPattern.clear();
    if (this.backDesign.style === 'constellation') {
      let previousX = centerX;
      let previousY = centerY;
      for (let index = 0; index < 18; index += 1) {
        const x = width * (0.16 + random() * 0.68);
        const y = height * (0.16 + random() * 0.62);
        const size = width * (0.007 + random() * 0.013);
        if (index > 0 && index % 2 === 0) {
          this.backPattern.moveTo(previousX, previousY).lineTo(x, y).stroke({
            color: accentSoft,
            width: width * 0.003,
            alpha: 0.24,
          });
        }
        this.backPattern.circle(x, y, size).fill({
          color: index % 4 === 0 ? ornament : paper,
          alpha: 0.46 + random() * 0.42,
        });
        previousX = x;
        previousY = y;
      }
    } else if (this.backDesign.style === 'circuit') {
      for (let quadrant = 0; quadrant < 4; quadrant += 1) {
        const directionX = quadrant % 2 === 0 ? 1 : -1;
        const directionY = quadrant < 2 ? 1 : -1;
        const startX = centerX + directionX * width * 0.07;
        const startY = centerY + directionY * width * 0.08;
        this.backPattern
          .moveTo(startX, startY)
          .lineTo(centerX + directionX * width * 0.29, startY)
          .lineTo(centerX + directionX * width * 0.29, centerY + directionY * width * 0.29)
          .lineTo(centerX + directionX * width * 0.16, centerY + directionY * width * 0.29)
          .lineTo(centerX + directionX * width * 0.16, centerY + directionY * width * 0.18)
          .lineTo(centerX + directionX * width * 0.23, centerY + directionY * width * 0.18)
          .stroke({
            color: quadrant % 2 === 0 ? ornament : accentSoft,
            width: width * 0.006,
            alpha: 0.58,
          });
        this.backPattern
          .rect(
            centerX + directionX * width * 0.31 - width * 0.012,
            centerY + directionY * width * 0.31 - width * 0.012,
            width * 0.024,
            width * 0.024,
          )
          .fill({ color: quadrant % 2 === 0 ? mixColor(ornament, ink, 0.28) : accent, alpha: 0.72 });
      }
    } else if (this.backDesign.style === 'sigil') {
      for (let ring = 0; ring < 4; ring += 1) {
        const size = width * (0.17 + ring * 0.085);
        this.backPattern
          .moveTo(centerX, centerY - size)
          .lineTo(centerX + size * 0.78, centerY)
          .lineTo(centerX, centerY + size)
          .lineTo(centerX - size * 0.78, centerY)
          .closePath()
          .stroke({
            color: ring % 2 === 0 ? accentSoft : ornament,
            width: width * (0.009 - ring * 0.0012),
            alpha: 0.7 - ring * 0.1,
          });
      }
    } else {
      for (let ring = 0; ring < 5; ring += 1) {
        this.backPattern.circle(centerX, centerY, width * (0.12 + ring * 0.07)).stroke({
          color: ring % 2 === 0 ? accent : ornament,
          width: width * (0.009 - ring * 0.001),
          alpha: 0.64 - ring * 0.08,
        });
      }
      for (let spoke = 0; spoke < 12; spoke += 1) {
        const angle = (spoke / 12) * Math.PI * 2;
        this.backPattern
          .moveTo(centerX + Math.cos(angle) * width * 0.13, centerY + Math.sin(angle) * width * 0.13)
          .lineTo(centerX + Math.cos(angle) * width * 0.39, centerY + Math.sin(angle) * width * 0.39)
          .stroke({ color: accentSoft, width: width * 0.004, alpha: 0.46 });
      }
    }

    this.backSheen.clear();
    for (let band = -3; band < 8; band += 1) {
      const x = band * width * 0.2;
      this.backSheen
        .moveTo(x, -height * 0.04)
        .lineTo(x + width * 0.075, -height * 0.04)
        .lineTo(x - width * 0.28, height * 1.04)
        .lineTo(x - width * 0.36, height * 1.04)
        .closePath()
        .fill({
          color: band % 4 === 0 ? ornament : band % 3 === 0 ? secondary : band % 2 === 0 ? accentSoft : accent,
          alpha: 0.09,
        });
    }

    this.backGrain.clear();
    const grainCount = width < 108 ? 16 : 30;
    for (let index = 0; index <= grainCount; index += 1) {
      const x = -height * 0.18 + ((width + height * 0.34) * index) / grainCount;
      this.backGrain
        .moveTo(x, -height * 0.03)
        .lineTo(x - height * 0.2, height * 1.03)
        .stroke({
          color: index % 4 === 0 ? ornament : index % 3 === 0 ? accentSoft : paper,
          width: Math.max(0.35, width * 0.0013),
          alpha: index % 4 === 0 ? 0.085 : 0.034,
        });
    }

    this.backBeam.clear();
    this.backBeam
      .moveTo(-width * 0.24, -height * 0.06)
      .lineTo(width * 0.16, -height * 0.06)
      .lineTo(width * 0.04, height * 1.06)
      .lineTo(-width * 0.34, height * 1.06)
      .closePath()
      .fill({ color: ornament, alpha: 0.1 });
    this.backBeam
      .moveTo(-width * 0.07, -height * 0.06)
      .lineTo(width * 0.055, -height * 0.06)
      .lineTo(-width * 0.055, height * 1.06)
      .lineTo(-width * 0.18, height * 1.06)
      .closePath()
      .fill({ color: COLORS.white, alpha: 0.23 });
    this.backBeam
      .moveTo(width * 0.055, -height * 0.06)
      .lineTo(width * 0.13, -height * 0.06)
      .lineTo(width * 0.02, height * 1.06)
      .lineTo(-width * 0.055, height * 1.06)
      .closePath()
      .fill({ color: secondary, alpha: 0.17 });

    this.backHighlight.clear();
    for (let ring = 20; ring >= 1; ring -= 1) {
      const ratio = ring / 20;
      this.backHighlight.circle(0, 0, width * 0.56 * ratio).fill({
        color: COLORS.white,
        alpha: 0.006 + (1 - ratio) * 0.009,
      });
    }
    this.backHighlight.position.set(this.highlightX, this.highlightY);

    this.backPrism.clear();
    this.backPrism
      .moveTo(width * 0.045, width * 0.16)
      .lineTo(width * 0.045, width * 0.045)
      .lineTo(width * 0.2, width * 0.045)
      .stroke({ color: accent, width: width * 0.006, alpha: 0.7 });
    this.backPrism
      .moveTo(width * 0.8, height - width * 0.045)
      .lineTo(width * 0.955, height - width * 0.045)
      .lineTo(width * 0.955, height - width * 0.16)
      .stroke({ color: secondary, width: width * 0.006, alpha: 0.7 });
    this.backPrism
      .moveTo(width * 0.36, width * 0.047)
      .lineTo(width * 0.65, width * 0.047)
      .stroke({ color: ornament, width: width * 0.0035, alpha: 0.62 });
    for (let index = 0; index < 5; index += 1) {
      const x = width * (0.18 + index * 0.13);
      this.backPrism
        .moveTo(x, height - width * 0.05)
        .lineTo(x + width * 0.085, height - width * 0.05)
        .lineTo(x + width * 0.085, height - width * 0.068)
        .lineTo(x + width * 0.052, height - width * 0.068)
        .stroke({ color: index % 2 === 0 ? accent : ornament, width: width * 0.0028, alpha: 0.5 });
    }
    this.backGrain.alpha = 0.2 + this.foilIntensity * 0.16;
    this.backSheen.alpha = 0.15 * this.foilIntensity;
    this.backBeam.alpha = 0.08 * this.foilIntensity;
    this.backPrism.alpha = 0.4 + this.foilIntensity * 0.32;
    const detailedBack = width >= 108;
    this.backGrain.visible = detailedBack;
    this.backBeam.visible = detailedBack;
    this.backHighlight.visible = detailedBack;
    this.backPatternBase.visible = true;
    this.backPatternBase.renderable = true;
    this.backPatternBase.alpha = 1;
    this.backPattern.visible = true;
    this.backPattern.renderable = true;
    this.backPattern.alpha = 1;

    this.backGlyph.text = this.mode.glyph;
    this.backGlyph.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: fontSize(width, 0.25, 18, 76),
      fontWeight: '700',
      fill: paper,
      letterSpacing: 0,
    });
    this.backGlyph.anchor.set(0.5);
    this.backGlyph.position.set(centerX, centerY);
    this.backGlyph.alpha = 0.92;

    this.backLabel.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: fontSize(width, 0.048, 7, 16),
      fontWeight: '600',
      fill: paper,
      letterSpacing: 0,
    });
    setFittedSingleLine(this.backLabel, this.backDesign.label || this.mode.name, width * 0.68);
    this.backLabel.anchor.set(0.5);
    this.backLabel.position.set(centerX, height * 0.83);

    const creatorOnBack = this.data.inscriptionPlacement === 'back';
    const creatorIsSeal = (this.data.inscriptionStyle ?? 'seal') === 'seal';
    const creatorSize = fontSize(width, creatorIsSeal ? 0.029 : 0.036, 6, 11);
    this.backCreatorText.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: creatorSize,
      fontWeight: creatorIsSeal ? '700' : '500',
      fontStyle: creatorIsSeal ? 'normal' : 'italic',
      fill: creatorIsSeal ? ornament : accentSoft,
      letterSpacing: 0,
    });
    setFittedSingleLine(
      this.backCreatorText,
      this.data.inscriptionText?.trim() || this.data.author || '佚名',
      width * 0.46,
    );
    this.backCreatorText.anchor.set(0.5);
    this.backCreatorText.position.set(centerX, height * 0.91);
    this.backCreatorText.alpha = 0.92;
    this.backCreatorText.visible = creatorOnBack;
    this.backCreatorMark.clear();
    this.backCreatorMark.visible = creatorOnBack;
    if (creatorOnBack && creatorIsSeal) {
      const markWidth = Math.max(width * 0.18, this.backCreatorText.width + width * 0.05);
      this.backCreatorMark
        .roundRect(
          centerX - markWidth / 2,
          height * 0.91 - creatorSize * 0.84,
          markWidth,
          creatorSize * 1.68,
          width * 0.01,
        )
        .fill({ color: accent, alpha: 0.16 })
        .stroke({ color: ornament, width: width * 0.005, alpha: 0.76 });
    } else if (creatorOnBack) {
      this.backCreatorMark
        .moveTo(width * 0.27, height * 0.932)
        .bezierCurveTo(
          width * 0.4,
          height * 0.9,
          width * 0.61,
          height * 0.945,
          width * 0.73,
          height * 0.914,
        )
        .stroke({ color: accentSoft, width: width * 0.004, alpha: 0.66 });
    }
  }

  private layoutText(): void {
    const width = this.cardWidth;
    const height = this.cardHeight;
    const visual = this.visualStyle;
    const { accentSoft, ink, ornament, paper } = visual;
    const rarityColor = RARITY_COLOR[this.data.rarity];

    const titleSize = fontSize(width, 0.03, 7, 12);
    this.titleText.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: titleSize,
      fontWeight: '700',
      fill: mixColor(accentSoft, paper, 0.22),
      stroke: { color: mixColor(ink, COLORS.black, 0.36), width: Math.max(0.5, width * 0.0026), join: 'round' },
      letterSpacing: 0,
    });
    setFittedSingleLine(
      this.titleText,
      `${this.mode.english} / ${this.data.title}`,
      width * 0.7,
    );
    this.titleText.position.set(width * 0.071, height * 0.034);
    this.titleText.alpha = 0.92;

    const nameSize = fontSize(width, 0.078, 12, 26);
    this.nameText.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: nameSize,
      fontWeight: '700',
      fill: mixColor(paper, COLORS.white, 0.18),
      stroke: { color: mixColor(ink, COLORS.black, 0.5), width: Math.max(0.85, width * 0.0052), join: 'round' },
      letterSpacing: 0,
    });
    setAdaptiveSingleLine(this.nameText, this.data.name, width * 0.72, nameSize, 0.76);
    this.nameText.position.set(width * 0.069, height * 0.066);

    const costValue = String(this.data.cost);
    const costSize = fitNumericFont(costValue, fontSize(width, 0.046, 7, 16), width * 0.058);
    this.costText.text = costValue;
    this.costText.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: costSize,
      fontWeight: '800',
      fill: mixColor(paper, COLORS.white, 0.16),
      stroke: {
        color: mixColor(COLORS.bronze, COLORS.black, 0.66),
        width: Math.max(0.6, width * 0.004),
        join: 'round',
      },
      letterSpacing: 0,
    });
    this.costText.anchor.set(0.5);
    this.costText.position.set(width * CARD_FACE_LAYOUT.cost.x, height * CARD_FACE_LAYOUT.cost.y);

    const raritySize = fontSize(width, 0.03, 6, 11);
    this.rarityText.text = `◆ ${this.data.rarity}`;
    this.rarityText.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: raritySize,
      fontWeight: '700',
      fill: rarityColor,
      letterSpacing: 0,
    });
    this.rarityText.position.set(width * 0.087, height * 0.779);

    const miniatureCard = width < 120;
    const visibleTermCount = miniatureCard ? 0 : width >= 190 ? 2 : 1;
    const terms = deriveAbilityTerms(this.data.skill, Math.max(1, visibleTermCount));
    const panelX = width * INFO_X_RATIO;
    const panelY = height * INFO_Y_RATIO;
    const panelWidth = width * INFO_WIDTH_RATIO;
    const panelHeight = height * INFO_HEIGHT_RATIO;
    const termAreaTop = panelY + panelHeight * 0.3;
    const termAreaHeight = panelHeight * 0.64;
    const termGap = Math.max(1, width * 0.006);
    const shownTerms = Math.min(visibleTermCount, terms.length);
    const termHeight = shownTerms > 0
      ? (termAreaHeight - termGap * Math.max(0, shownTerms - 1)) / shownTerms
      : 0;
    const termColors = [visual.accent, visual.ornament, visual.secondary];
    this.abilityTermPlates.clear();

    for (let index = 0; index < this.abilityTermTexts.length; index += 1) {
      const label = this.abilityTermTexts[index];
      const term = terms[index];
      const visible = index < shownTerms && Boolean(term);
      label.visible = visible;
      if (!visible || !term) continue;

      const rowY = termAreaTop + index * (termHeight + termGap);
      const rowX = panelX + width * 0.018;
      const rowWidth = panelWidth - width * 0.036;
      const termSize = Math.min(
        fontSize(width, 0.027, 5.5, 10),
        Math.max(5.5, termHeight * 0.62),
      );
      label.style = new TextStyle({
        fontFamily: FONT_FAMILY,
        fontSize: termSize,
        fontWeight: '600',
        fill: mixColor(paper, COLORS.white, 0.1),
        stroke: {
          color: mixColor(ink, COLORS.black, 0.42),
          width: Math.max(0.35, width * 0.0018),
          join: 'round',
        },
        letterSpacing: 0,
      });
      setFittedSingleLine(label, `「${term.keyword}」${term.effect}`, rowWidth - width * 0.026);
      label.anchor.set(0, 0.5);
      label.position.set(rowX + width * 0.018, rowY + termHeight * 0.5);

      const termColor = termColors[index % termColors.length];
      this.abilityTermPlates
        .roundRect(rowX, rowY, rowWidth, termHeight, Math.min(width * 0.012, termHeight * 0.38))
        .fill({ color: mixColor(visual.deep, termColor, 0.16), alpha: 0.5 })
        .stroke({ color: termColor, width: Math.max(0.45, width * 0.0018), alpha: 0.34 });
      this.abilityTermPlates
        .roundRect(
          rowX + width * 0.006,
          rowY + termHeight * 0.18,
          Math.max(1, width * 0.006),
          termHeight * 0.64,
          width * 0.003,
        )
        .fill({ color: termColor, alpha: 0.82 });
    }

    const attackValue = String(this.data.attack);
    const defenseValue = String(this.data.defense);
    const desiredStatSize = fontSize(width, 0.045, 7, 16);
    const attackSize = fitNumericFont(attackValue, desiredStatSize, width * 0.06);
    const defenseSize = fitNumericFont(defenseValue, desiredStatSize, width * 0.06);
    const statLabelSize = fontSize(width, 0.019, 4, 7);
    this.attackText.text = attackValue;
    this.attackText.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: attackSize,
      fontWeight: '800',
      fill: mixColor(paper, COLORS.white, 0.12),
      stroke: {
        color: mixColor(COLORS.cinnabar, COLORS.black, 0.68),
        width: Math.max(0.55, width * 0.0034),
        join: 'round',
      },
      letterSpacing: 0,
    });
    this.attackText.anchor.set(0.5);
    this.attackText.position.set(width * CARD_FACE_LAYOUT.stats.leftX, height * 0.923);

    this.defenseText.text = defenseValue;
    this.defenseText.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: defenseSize,
      fontWeight: '800',
      fill: mixColor(paper, COLORS.white, 0.12),
      stroke: {
        color: mixColor(COLORS.jadeDeep, COLORS.black, 0.68),
        width: Math.max(0.55, width * 0.0034),
        join: 'round',
      },
      letterSpacing: 0,
    });
    this.defenseText.anchor.set(0.5);
    this.defenseText.position.set(width * CARD_FACE_LAYOUT.stats.rightX, height * 0.923);

    this.attackLabel.text = '攻';
    this.attackLabel.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: statLabelSize,
      fontWeight: '700',
      fill: mixColor(COLORS.coral, paper, 0.08),
      letterSpacing: 0,
    });
    this.attackLabel.anchor.set(0.5);
    this.attackLabel.position.set(width * CARD_FACE_LAYOUT.stats.leftX, height * 0.944);

    this.defenseLabel.text = '御';
    this.defenseLabel.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: statLabelSize,
      fontWeight: '700',
      fill: mixColor(COLORS.jade, paper, 0.08),
      letterSpacing: 0,
    });
    this.defenseLabel.anchor.set(0.5);
    this.defenseLabel.position.set(width * CARD_FACE_LAYOUT.stats.rightX, height * 0.944);
    this.attackLabel.visible = !miniatureCard;
    this.defenseLabel.visible = !miniatureCard;

    const authorOnFront = this.data.inscriptionPlacement !== 'back';
    const seal = (this.data.inscriptionStyle ?? 'seal') === 'seal';
    const authorSize = fontSize(width, seal ? 0.028 : 0.035, 6, 11);
    this.authorText.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: authorSize,
      fontWeight: seal ? '700' : '500',
      fontStyle: seal ? 'normal' : 'italic',
      fill: seal ? ornament : accentSoft,
      letterSpacing: 0,
    });
    setFittedSingleLine(
      this.authorText,
      this.data.inscriptionText?.trim() || this.data.author || '佚名',
      width * 0.43,
    );
    this.authorText.anchor.set(0.5);
    this.authorText.position.set(width * 0.5, height * 0.93);
    this.authorText.alpha = 0.9;
    this.authorText.visible = authorOnFront;
    this.authorMark.clear();
    this.authorMark.visible = authorOnFront;
    if (authorOnFront && seal) {
      const markWidth = Math.max(width * 0.16, this.authorText.width + width * 0.045);
      this.authorMark
        .roundRect(
          width * 0.5 - markWidth / 2,
          height * 0.93 - authorSize * 0.82,
          markWidth,
          authorSize * 1.64,
          width * 0.01,
        )
        .fill({ color: visual.accent, alpha: 0.12 })
        .stroke({ color: ornament, width: width * 0.005, alpha: 0.72 });
    } else if (authorOnFront) {
      this.authorMark
        .moveTo(width * 0.28, height * 0.95)
        .bezierCurveTo(width * 0.41, height * 0.925, width * 0.61, height * 0.965, width * 0.72, height * 0.938)
        .stroke({ color: accentSoft, width: width * 0.004, alpha: 0.58 });
    }
  }

  private drawAbilityPopover(): void {
    const width = this.cardWidth;
    const height = this.cardHeight;
    const visual = this.visualStyle;
    const globalCenter = this.parent
      ? this.getGlobalPosition()
      : { x: width / 2, y: height / 2 };
    const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
    const layout = resolveCardAbilityPopoverLayout({
      cardWidth: width,
      cardHeight: height,
      globalCenterX: globalCenter.x,
      globalCenterY: globalCenter.y,
      viewportWidth,
      viewportHeight,
      preferredPlacement: this.abilityPopoverPlacement,
    });
    const panelWidth = layout.width;
    const panelHeight = layout.height;
    const padding = 14;
    const arrowCenter = clamp(width / 2 - layout.x, 22, panelWidth - 22);
    const gameplayPresentation = buildCardGameplayPresentation(
      this.data,
      this.gameplayModules,
      'full',
    );

    this.abilityPopover.position.set(layout.x, layout.y);
    this.abilityPopoverShadow
      .clear()
      .roundRect(3, 4, panelWidth, panelHeight, 7)
      .fill({ color: COLORS.black, alpha: 0.58 });
    this.abilityPopoverPanel
      .clear()
      .roundRect(0, 0, panelWidth, panelHeight, 7)
      .fill({ color: mixColor(visual.deep, visual.ink, 0.72), alpha: 0.98 })
      .stroke({ color: mixColor(visual.ornament, visual.paper, 0.12), width: 1.4, alpha: 0.9 });
    this.abilityPopoverPanel
      .roundRect(6, 6, 5, panelHeight - 12, 2)
      .fill({ color: visual.accent, alpha: 0.84 });
    this.abilityPopoverPanel
      .moveTo(padding, 30)
      .lineTo(panelWidth - padding, 30)
      .stroke({ color: visual.ornament, width: 0.8, alpha: 0.42 });
    this.abilityPopoverPanel
      .moveTo(panelWidth - 72, 11)
      .bezierCurveTo(panelWidth - 55, 3, panelWidth - 43, 19, panelWidth - 26, 11)
      .stroke({ color: visual.accentSoft, width: 1, alpha: 0.46 });
    if (layout.placement === 'below') {
      this.abilityPopoverPanel
        .poly([arrowCenter - 8, 0, arrowCenter, -8, arrowCenter + 8, 0])
        .fill({ color: mixColor(visual.deep, visual.ink, 0.72), alpha: 0.98 })
        .stroke({ color: visual.ornament, width: 1, alpha: 0.72 });
    } else {
      this.abilityPopoverPanel
        .poly([arrowCenter - 8, panelHeight, arrowCenter, panelHeight + 8, arrowCenter + 8, panelHeight])
        .fill({ color: mixColor(visual.deep, visual.ink, 0.72), alpha: 0.98 })
        .stroke({ color: visual.ornament, width: 1, alpha: 0.72 });
    }

    const titleSize = clamp(panelWidth * 0.043, 12, 15);
    this.abilityPopoverTitle.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: titleSize,
      fontWeight: '700',
      fill: mixColor(visual.paper, COLORS.white, 0.1),
      stroke: { color: COLORS.black, width: 1.2, join: 'round' },
      letterSpacing: 0,
    });
    setFittedSingleLine(
      this.abilityPopoverTitle,
      `${this.data.name} · ${gameplayPresentation.items.length ? '玩法与能力' : '完整能力'}`,
      panelWidth - padding * 2,
    );
    this.abilityPopoverTitle.position.set(padding, 8);

    const terms = deriveAbilityTerms(this.data.skill, 3);
    const abilityTermSummary = terms.length
      ? terms.map((term) => `【${term.keyword}】${term.effect}`).join(' · ')
      : '【常驻】依照玩法说明执行';
    const gameplaySummary = gameplayPresentation.items
      .slice(0, 2)
      .map((item) => `【${item.moduleGlyph}·${item.primary || item.mark}】${item.relation ?? item.description}`)
      .join(' · ');
    const termSize = clamp(panelWidth * 0.032, 9, 11);
    this.abilityPopoverTerms.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: termSize,
      lineHeight: termSize * 1.24,
      fontWeight: '700',
      fill: mixColor(visual.ornament, visual.paper, 0.18),
      letterSpacing: 0,
      wordWrap: false,
    });
    this.abilityPopoverTerms.text = gameplaySummary
      ? [gameplaySummary, abilityTermSummary]
          .map((line) => fitMultiline(line, panelWidth - padding * 2, termSize, 1))
          .join('\n')
      : fitMultiline(abilityTermSummary, panelWidth - padding * 2, termSize, 2);
    this.abilityPopoverTerms.position.set(padding, 37);

    const skillY = 40 + this.abilityPopoverTerms.height;
    const availableSkillHeight = Math.max(22, panelHeight - skillY - 10);
    const fittedSkill = fitCompleteMultiline(
      this.data.skill,
      panelWidth - padding * 2,
      clamp(panelWidth * 0.036, 10, 12.5),
      7.5,
      availableSkillHeight,
    );
    this.abilityPopoverSkill.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: fittedSkill.size,
      lineHeight: fittedSkill.size * 1.28,
      fontWeight: '500',
      fill: visual.paper,
      stroke: { color: COLORS.black, width: 0.65, join: 'round' },
      letterSpacing: 0,
      wordWrap: false,
    });
    this.abilityPopoverSkill.text = fittedSkill.text;
    this.abilityPopoverSkill.position.set(padding, skillY);
  }

  private showAbilityPopover(pinned = false): void {
    if (!this.abilityPopoverEnabled || this.flipped || this.flipTarget > 0.5) return;
    this.drawAbilityPopover();
    this.abilityPopoverPinned = pinned;
    this.abilityPopoverTarget = 1;
    this.abilityPopover.visible = true;
    if (this.motionProfile === 'static' || this.reducedMotion) this.abilityPopoverAmount = 1;
    this.applyAbilityPopoverVisual();
  }

  private hideAbilityPopover(immediate = false): void {
    this.cancelLongPress();
    this.abilityPopoverPinned = false;
    this.abilityPopoverTarget = 0;
    if (immediate || this.motionProfile === 'static' || this.reducedMotion) {
      this.abilityPopoverAmount = 0;
    }
    this.applyAbilityPopoverVisual();
  }

  private applyAbilityPopoverVisual(): void {
    this.abilityPopover.alpha = clamp(this.abilityPopoverAmount, 0, 1);
    this.abilityPopover.visible = this.abilityPopoverTarget > 0 || this.abilityPopoverAmount > 0.01;
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(this.longPressTimer);
    }
    this.longPressTimer = undefined;
    this.longPressPointerId = -1;
  }

  private async loadArtwork(url: string): Promise<void> {
    const request = ++this.artworkRequest;
    this.loadedTexture = null;
    this.artworkAlphaTarget = 0;
    this.artSprite.alpha = 0;
    this.artSprite.texture = Texture.EMPTY;

    if (!url.trim()) return;

    try {
      const texture = await loadLocalTexture(resolveRuntimeArtworkUrl(url));
      if (this.disposed || request !== this.artworkRequest) return;
      if (!texture || texture.width <= 0 || texture.height <= 0) return;

      this.loadedTexture = texture;
      this.artSprite.texture = texture;
      this.artworkAlphaTarget = 1;
      this.artSprite.alpha = this.motionProfile === 'static' ? 1 : 0;
      this.fitArtwork();
      if (this.motionProfile === 'static') this.applyStaticVisualState();
    } catch {
      // The procedural art remains visible, including for CORS and network failures.
      if (request === this.artworkRequest) {
        this.loadedTexture = null;
        this.artworkAlphaTarget = 0;
        this.artSprite.texture = Texture.EMPTY;
      }
    }
  }

  private fitArtwork(): void {
    const texture = this.loadedTexture;
    if (!texture || texture.width <= 0 || texture.height <= 0) return;

    const width = this.cardWidth;
    const height = this.cardHeight;
    const artWidth = width * ART_WIDTH_RATIO;
    const artHeight = height * ART_HEIGHT_RATIO;
    const { scale } = computeArtworkCoverLayout(
      artWidth,
      artHeight,
      texture.width,
      texture.height,
    );

    this.artSprite.anchor.set(0.5);
    this.artSprite.position.set(width * 0.5, height * (ART_Y_RATIO + ART_HEIGHT_RATIO / 2));
    this.artSprite.scale.set(scale);
  }

  private handlePointerEnter = (event: FederatedPointerEvent): void => {
    if (event.pointerType === 'mouse') this.showAbilityPopover(false);
    if (!this.interactiveTilt) return;
    this.hoverTarget = 1;
    this.highlightTarget = 1;
    this.updatePointerTarget(event);
  };

  private handlePointerMove = (event: FederatedPointerEvent): void => {
    if (this.longPressTimer !== undefined && event.pointerId === this.longPressPointerId) {
      const distance = Math.hypot(
        event.global.x - this.longPressStartX,
        event.global.y - this.longPressStartY,
      );
      if (distance > Math.max(8, this.cardWidth * 0.035)) this.cancelLongPress();
    }
    if (this.interactiveTilt) this.updatePointerTarget(event);
  };

  private handlePointerDown = (event: FederatedPointerEvent): void => {
    if (event.pointerType !== 'mouse' && this.abilityPopoverPinned) {
      this.hideAbilityPopover(true);
    } else if (
      event.pointerType !== 'mouse' &&
      this.abilityPopoverEnabled &&
      !this.flipped &&
      typeof window !== 'undefined'
    ) {
      this.cancelLongPress();
      this.longPressPointerId = event.pointerId;
      this.longPressStartX = event.global.x;
      this.longPressStartY = event.global.y;
      this.longPressTimer = window.setTimeout(() => {
        this.longPressTimer = undefined;
        this.longPressPointerId = -1;
        this.suppressNextTap = true;
        this.showAbilityPopover(true);
      }, CARD_ABILITY_LONG_PRESS_MS);
    }
    if (this.interactiveTilt) {
      this.hoverTarget = 1;
      this.highlightTarget = 1;
      this.updatePointerTarget(event);
    }
  };

  private handlePointerUp = (event: FederatedPointerEvent): void => {
    this.cancelLongPress();
    if (event.pointerType !== 'mouse') this.resetInteraction();
  };

  private handlePointerTap = (): void => {
    if (this.suppressNextTap) {
      this.suppressNextTap = false;
      return;
    }
    if (this.flipOnTap) this.toggleFlipped();
  };

  private handlePointerLeave = (event?: FederatedPointerEvent): void => {
    this.cancelLongPress();
    if (event?.pointerType === 'mouse' || !this.abilityPopoverPinned) {
      this.hideAbilityPopover();
    }
    this.resetInteraction();
  };

  private handlePointerCancel = (): void => {
    this.suppressNextTap = false;
    this.hideAbilityPopover(true);
    this.resetInteraction();
  };

  private updatePointerTarget(event: FederatedPointerEvent): void {
    const point = this.surface.toLocal(event.global);
    const normalizedX = clamp((point.x / this.cardWidth - 0.5) * 2, -1, 1);
    const normalizedY = clamp((point.y / this.cardHeight - 0.5) * 2, -1, 1);
    this.pointerMotionScale = this.reducedMotion ? 0.18 : event.pointerType === 'touch' ? 0.72 : 1;

    this.pointerX = normalizedX;
    this.pointerY = normalizedY;
    this.targetSkewX = -normalizedY * 0.066 * this.pointerMotionScale;
    this.targetSkewY = normalizedX * 0.092 * this.pointerMotionScale;
    this.targetRotation = normalizedX * 0.022 * this.pointerMotionScale;
    this.highlightTargetX = clamp(point.x, 0, this.cardWidth);
    this.highlightTargetY = clamp(point.y, 0, this.cardHeight);
  }

  private resetInteraction(): void {
    this.hoverTarget = 0;
    this.highlightTarget = 0;
    this.targetSkewX = 0;
    this.targetSkewY = 0;
    this.targetRotation = 0;
    this.pointerX = 0;
    this.pointerY = 0;
    this.pointerMotionScale = 1;
    this.highlightTargetX = this.cardWidth / 2;
    this.highlightTargetY = this.cardHeight / 2;
  }

  private applyFlipVisualState(): void {
    const flipAngle = this.flipAmount * Math.PI;
    const flipCosine = Math.cos(flipAngle);
    const showingBack = flipCosine < 0;
    this.surface.visible = !showingBack;
    this.backSurface.visible = showingBack;
    this.flipLayer.scale.set(Math.max(0.025, Math.abs(flipCosine)), 1);
    this.flipLayer.skew.set(0, 0);
  }

  private applyStaticVisualState(): void {
    const width = this.cardWidth;
    const height = this.cardHeight;
    const rarityFoil = RARITY_FOIL[this.data.rarity];
    const phase = this.foilPhase;
    this.currentSkewX = 0;
    this.currentSkewY = 0;
    this.currentRotation = 0;
    this.hoverAmount = 0;
    this.highlightAlpha = 0;
    this.highlightX = width / 2;
    this.highlightY = height / 2;
    this.tiltLayer.skew.set(0, 0);
    this.tiltLayer.rotation = 0;
    this.tiltLayer.scale.set(1);

    this.flipAmount = this.flipTarget;
    this.applyFlipVisualState();

    this.shadow.position.set(width * 0.018, width * 0.034);
    this.shadow.alpha = 0.8;
    this.hoverAura.alpha = 0;
    this.artSprite.position.set(width * 0.5, height * (ART_Y_RATIO + ART_HEIGHT_RATIO / 2));
    this.artSprite.alpha = this.artworkAlphaTarget;
    this.artIridescence.tilePosition.set(phase * width * 0.42, -phase * height * 0.16);
    this.artIridescence.alpha = rarityFoil.broadAlpha * this.foilIntensity * 0.72;
    this.artMicroFoil.tilePosition.set(-phase * width * 0.65, phase * height * 0.24);
    this.artMicroFoil.alpha = rarityFoil.fineAlpha * this.foilIntensity * 0.68;
    this.artFoil.position.set(0, 0);
    this.artFoil.alpha = this.foilIntensity * 0.12;
    this.surfaceGrain.position.set(0, 0);
    this.surfaceGrain.alpha = 0.13 + this.foilIntensity * 0.11;
    this.framePrism.position.set(0, 0);
    this.framePrism.alpha = 0.26 + this.foilIntensity * 0.27;
    this.borderFoil.tilePosition.set(phase * width * 0.3, phase * width * -0.18);
    this.borderFoil.alpha = rarityFoil.borderAlpha * this.foilIntensity * 0.78;
    this.localHighlight.alpha = 0;
    this.localHighlight.rotation = 0;
    this.specularBeam.alpha = 0;
    this.foilSheen.x = 0;
    this.foilSheen.alpha = this.foilIntensity * 0.1;
    this.borderGlow.alpha = 0.14 + this.foilIntensity * 0.18;
    this.edgeGlints.alpha = 0.28 + this.foilIntensity * 0.24;
    this.edgeGlints.position.set(0, 0);

    this.backPattern.position.set(0, 0);
    this.backGrain.position.set(0, 0);
    this.backGrain.alpha = 0.13 + this.foilIntensity * 0.11;
    this.backHighlight.alpha = 0;
    this.backBeam.alpha = 0;
    this.backSheen.x = 0;
    this.backSheen.alpha = this.foilIntensity * 0.11;
    this.backPrism.position.set(0, 0);
    this.backPrism.alpha = 0.34 + this.foilIntensity * 0.25;
    this.abilityPopoverAmount = this.abilityPopoverTarget;
    this.applyAbilityPopoverVisual();
  }

  private updateFrame = (ticker: Ticker): void => {
    if (this.motionProfile !== 'full' || this.globalDisplayStatus !== 7 || this.groupAlpha <= 0) return;
    const rarityFoil = RARITY_FOIL[this.data.rarity];
    const incomingDelta = Math.min(50, ticker.deltaMS);
    const throttledFrameMs = this.reducedMotion ? 50 : this.coarsePointer ? 1000 / 30 : 0;
    if (throttledFrameMs > 0) {
      this.frameAccumulator += incomingDelta;
      if (this.frameAccumulator < throttledFrameMs) return;
    }
    const deltaMs = throttledFrameMs > 0 ? Math.min(50, this.frameAccumulator) : incomingDelta;
    this.frameAccumulator = 0;
    const motion = 1 - Math.pow(0.0015, deltaMs / 1000);
    const lightMotion = 1 - Math.pow(0.0002, deltaMs / 1000);
    this.elapsed += deltaMs / 1000;

    this.currentSkewX += (this.targetSkewX - this.currentSkewX) * motion;
    this.currentSkewY += (this.targetSkewY - this.currentSkewY) * motion;
    this.currentRotation += (this.targetRotation - this.currentRotation) * motion;
    this.flipAmount += (this.flipTarget - this.flipAmount) * motion;
    this.hoverAmount += (this.hoverTarget - this.hoverAmount) * motion;
    this.abilityPopoverAmount += (this.abilityPopoverTarget - this.abilityPopoverAmount) * motion;
    this.highlightAlpha += (this.highlightTarget - this.highlightAlpha) * lightMotion;
    this.highlightX += (this.highlightTargetX - this.highlightX) * lightMotion;
    this.highlightY += (this.highlightTargetY - this.highlightY) * lightMotion;

    const allowIdleMotion = !this.reducedMotion && !this.coarsePointer;
    const idleSweep = allowIdleMotion
      ? Math.sin(this.elapsed * 0.48 + this.breathPhase) * rarityFoil.idleDrift
      : 0;
    const breathe = allowIdleMotion ? Math.sin(this.elapsed * 1.42 + this.breathPhase) : 0;
    const breatheScale = 1 + breathe * (0.0015 + this.foilIntensity * 0.0008);
    const hoverScale = 1 + this.hoverAmount * (this.reducedMotion ? 0.006 : 0.022);
    const depthScaleX = 1 - Math.abs(this.currentSkewY) * 0.38;
    const depthScaleY = 1 - Math.abs(this.currentSkewX) * 0.24;
    this.tiltLayer.skew.set(this.currentSkewX, this.currentSkewY);
    this.tiltLayer.rotation = this.currentRotation;
    this.tiltLayer.scale.set(
      breatheScale * hoverScale * depthScaleX,
      breatheScale * hoverScale * depthScaleY,
    );

    const flipAngle = this.flipAmount * Math.PI;
    const flipCosine = Math.cos(flipAngle);
    const flipDepth = Math.sin(flipAngle);
    this.surface.visible = flipCosine >= 0;
    this.backSurface.visible = flipCosine < 0;
    this.flipLayer.scale.set(Math.max(0.025, Math.abs(flipCosine)), 1 - Math.abs(flipDepth) * 0.055);
    this.flipLayer.skew.set(0, flipDepth * (flipCosine >= 0 ? 0.025 : -0.025));

    this.shadow.position.set(
      this.cardWidth * (0.018 - this.pointerX * this.hoverAmount * 0.012),
      this.cardWidth * (0.034 - this.pointerY * this.hoverAmount * 0.01),
    );
    this.shadow.alpha = 0.8 + this.hoverAmount * 0.18;
    this.hoverAura.alpha = this.hoverAmount * (0.38 + this.foilIntensity * 0.46);

    const activeX = this.pointerX * this.hoverAmount;
    const activeY = this.pointerY * this.hoverAmount;
    const pointerDistance = Math.min(1, Math.hypot(activeX, activeY));
    const interactionQuality = this.reducedMotion ? 0.24 : this.coarsePointer ? 0.62 : 1;
    const artBaseX = this.cardWidth * 0.5;
    const artBaseY = this.cardHeight * (ART_Y_RATIO + ART_HEIGHT_RATIO / 2);
    this.artSprite.position.set(
      artBaseX - activeX * this.cardWidth * 0.012,
      artBaseY - activeY * this.cardHeight * 0.006,
    );
    this.artIridescence.tilePosition.set(
      this.foilPhase * this.cardWidth * 0.42 +
        activeX * this.cardWidth * 0.31 * rarityFoil.parallax * interactionQuality +
        idleSweep * this.cardWidth * 0.035 * (1 - this.hoverAmount),
      -this.foilPhase * this.cardHeight * 0.16 +
        activeY * this.cardHeight * 0.095 * rarityFoil.parallax * interactionQuality,
    );
    this.artIridescence.tileRotation = rarityFoil.coarseAngle + activeX * 0.06 * interactionQuality;
    this.artIridescence.alpha = clamp(
      rarityFoil.broadAlpha * this.foilIntensity * (0.72 + this.hoverAmount * 1.18),
      0,
      0.68,
    );
    this.artMicroFoil.tilePosition.set(
      -this.foilPhase * this.cardWidth * 0.65 -
        activeX * this.cardWidth * 0.48 * rarityFoil.parallax * interactionQuality -
        idleSweep * this.cardWidth * 0.024 * (1 - this.hoverAmount),
      this.foilPhase * this.cardHeight * 0.24 +
        activeY * this.cardHeight * 0.21 * rarityFoil.parallax * interactionQuality,
    );
    this.artMicroFoil.tileRotation = rarityFoil.fineAngle - activeY * 0.09 * interactionQuality;
    this.artMicroFoil.alpha = clamp(
      rarityFoil.fineAlpha * this.foilIntensity * (0.64 + this.hoverAmount * 1.42),
      0,
      0.58,
    );
    this.artFoil.position.set(
      activeX * this.cardWidth * 0.062 + idleSweep * this.cardWidth * 0.02 * (1 - this.hoverAmount),
      activeY * this.cardWidth * 0.012,
    );
    this.artFoil.alpha =
      this.foilIntensity *
      (0.08 + rarityFoil.glareAlpha * 0.05 + this.hoverAmount * (0.18 + rarityFoil.glareAlpha * 0.42));

    this.surfaceGrain.position.set(
      -activeX * this.cardWidth * 0.012,
      -activeY * this.cardWidth * 0.008,
    );
    this.surfaceGrain.alpha = 0.13 + this.foilIntensity * 0.11 + this.hoverAmount * 0.15;
    this.framePrism.position.set(
      activeX * this.cardWidth * 0.005,
      activeY * this.cardWidth * 0.003,
    );
    this.framePrism.alpha = 0.26 + this.foilIntensity * 0.27 + this.hoverAmount * 0.3;
    this.borderFoil.tilePosition.set(
      this.foilPhase * this.cardWidth * 0.3 -
        activeX * this.cardWidth * 0.36 * rarityFoil.parallax * interactionQuality,
      -this.foilPhase * this.cardWidth * 0.18 -
        activeY * this.cardHeight * 0.075 * rarityFoil.parallax * interactionQuality,
    );
    this.borderFoil.tileRotation =
      -0.18 + rarityFoil.coarseAngle * 0.22 - activeX * 0.08 * interactionQuality;
    this.borderFoil.alpha = clamp(
      rarityFoil.borderAlpha * this.foilIntensity * (0.7 + this.hoverAmount * 0.72),
      0,
      0.72,
    );

    this.localHighlight.position.set(this.highlightX, this.highlightY);
    this.localHighlight.width = this.cardWidth * (1.12 + Math.abs(activeX) * 0.16);
    this.localHighlight.height = this.cardWidth * (0.9 + Math.abs(activeY) * 0.12);
    this.localHighlight.rotation = Math.atan2(activeY, activeX || 0.0001) * 0.08;
    this.localHighlight.alpha = clamp(
      this.highlightAlpha *
        rarityFoil.glareAlpha *
        (0.16 + this.foilIntensity * 0.28 + pointerDistance * 0.16) *
        interactionQuality,
      0,
      0.52,
    );
    this.specularBeam.position.set(
      this.highlightX + idleSweep * this.cardWidth * 0.1 * (1 - this.hoverAmount),
      0,
    );
    this.specularBeam.skew.set(activeY * 0.035, 0);
    this.specularBeam.alpha =
      this.foilIntensity *
      rarityFoil.glareAlpha *
      (0.018 + this.hoverAmount * (0.22 + pointerDistance * 0.18));
    this.foilSheen.x =
      activeX * this.cardWidth * 0.08 + idleSweep * this.cardWidth * 0.08 * (1 - this.hoverAmount);
    this.foilSheen.alpha =
      this.foilIntensity *
      rarityFoil.glareAlpha *
      (0.06 + this.hoverAmount * (0.2 + pointerDistance * 0.08));
    this.borderGlow.alpha =
      0.12 + this.foilIntensity * 0.16 + this.hoverAmount * (0.12 + pointerDistance * 0.22);
    this.edgeGlints.position.set(activeX * this.cardWidth * 0.006, activeY * this.cardWidth * 0.004);
    this.edgeGlints.alpha =
      0.24 + this.foilIntensity * 0.2 + this.hoverAmount * (0.18 + pointerDistance * 0.2);

    this.backPattern.position.set(activeX * this.cardWidth * 0.008, activeY * this.cardWidth * 0.005);
    this.backGrain.position.set(-activeX * this.cardWidth * 0.012, -activeY * this.cardWidth * 0.008);
    this.backGrain.alpha = 0.13 + this.foilIntensity * 0.11 + this.hoverAmount * 0.15;
    this.backHighlight.position.set(this.highlightX, this.highlightY);
    this.backHighlight.alpha = this.highlightAlpha * (0.5 + this.foilIntensity * 0.5);
    this.backBeam.position.set(
      this.highlightX + idleSweep * this.cardWidth * 0.1 * (1 - this.hoverAmount),
      0,
    );
    this.backBeam.skew.set(activeY * 0.035, 0);
    this.backBeam.alpha = this.foilIntensity * (0.06 + this.hoverAmount * 0.72);
    this.backSheen.x =
      activeX * this.cardWidth * 0.085 + idleSweep * this.cardWidth * 0.09 * (1 - this.hoverAmount);
    this.backSheen.alpha = this.foilIntensity * (0.11 + this.hoverAmount * 0.42);
    this.backPrism.position.set(-activeX * this.cardWidth * 0.004, -activeY * this.cardWidth * 0.003);
    this.backPrism.alpha = 0.34 + this.foilIntensity * 0.25 + this.hoverAmount * 0.28;
    this.applyAbilityPopoverVisual();

    this.artSprite.alpha += (this.artworkAlphaTarget - this.artSprite.alpha) * motion;
  };

  public override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.disposed) return;
    this.disposed = true;
    this.artworkRequest += 1;
    this.cancelLongPress();

    if (this.tickerAttached) {
      Ticker.shared.remove(this.updateFrame);
      this.tickerAttached = false;
    }
    this.off('pointerenter', this.handlePointerEnter);
    this.off('pointermove', this.handlePointerMove);
    this.off('pointerleave', this.handlePointerLeave);
    this.off('pointerdown', this.handlePointerDown);
    this.off('pointerup', this.handlePointerUp);
    this.off('pointerupoutside', this.handlePointerCancel);
    this.off('pointercancel', this.handlePointerCancel);
    this.off('pointertap', this.handlePointerTap);

    this.loadedTexture = null;
    this.artSprite.texture = Texture.EMPTY;
    super.destroy(options ?? { children: true });
  }
}

export default CardView;
