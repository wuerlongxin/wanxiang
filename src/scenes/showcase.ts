import Matter from 'matter-js';
import {
  Container,
  Graphics,
  Rectangle,
  Text,
  TextStyle,
  Texture,
  Ticker,
  TilingSprite,
  type FederatedPointerEvent,
} from 'pixi.js';
import { CardView } from '../card-view';
import { TopBar } from '../chrome';
import { MODE_BY_ID } from '../data';
import { describeDeckComposition } from '../deck-composition';
import { CARD_RATIO, COLORS, DISPLAY_FONT, FONT_FAMILY } from '../theme';
import type { CardData, DeckData, Viewport } from '../types';
import { CanvasButton } from '../ui';
import { clamp, getReducedMotion } from '../utils';
import { attachInteractionHint } from '../interaction-hints';
import { loadLocalTexture } from '../services/local-texture';
import { audioEngine } from '../services/audio';

const { Bodies, Body, Composite, Engine, Sleeping } = Matter;
const TABLE_TEXTURE = '/assets/ui/textures/silk-brocade.jpg';
const FIXED_STEP_MS = 1000 / 60;

type CollectorGrade = 'N' | 'R' | 'SR' | 'SSR';
type Arrangement = 'fan' | 'gallery';

interface ShowcaseSceneOptions {
  deck: DeckData;
  onHome: () => void;
  onStudio: () => void;
  onRules: () => void;
  onLibrary: () => void;
  onExchange: () => void;
  onBattle: () => void;
}

interface DragState {
  piece: ShowcasePiece;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  lastX: number;
  lastY: number;
  lastAt: number;
  velocityX: number;
  velocityY: number;
}

interface DustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  radius: number;
}

const GRADE_BY_RARITY: Record<CardData['rarity'], CollectorGrade> = {
  '普通': 'N',
  '稀有': 'R',
  '史诗': 'SR',
  '传说': 'SSR',
};

const GRADE_COLOR: Record<CollectorGrade, number> = {
  N: COLORS.paperMuted,
  R: COLORS.jade,
  SR: COLORS.violet,
  SSR: COLORS.gold,
};

const FOIL_BY_GRADE: Record<CollectorGrade, number> = {
  N: 0.28,
  R: 0.56,
  SR: 0.8,
  SSR: 1,
};

function fitTextWidth(text: Text, value: string, maximumWidth: number): void {
  text.text = value;
  if (text.width <= maximumWidth) return;
  const characters = Array.from(value);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    text.text = `${characters.slice(0, midpoint).join('')}…`;
    if (text.width <= maximumWidth) low = midpoint;
    else high = midpoint - 1;
  }
  text.text = `${characters.slice(0, low).join('')}…`;
}

class ShowcasePiece extends Container {
  readonly card: CardView;
  readonly grade: CollectorGrade;
  body: Matter.Body;
  private readonly selection = new Graphics();
  private readonly gradePlate = new Graphics();
  private readonly gradeText: Text;
  private readonly ssrOrnament = new Graphics();
  private cardWidth: number;
  private cardHeight: number;
  private selected = false;
  private detailedMotion: boolean;

  constructor(cardData: CardData, deck: DeckData, width: number, detailedMotion: boolean) {
    super();
    this.grade = GRADE_BY_RARITY[cardData.rarity];
    this.cardWidth = width;
    this.cardHeight = width * CARD_RATIO;
    this.detailedMotion = detailedMotion;
    this.body = Bodies.rectangle(0, 0, width * 0.92, this.cardHeight * 0.94);
    this.card = new CardView(cardData, width)
      .setArtStyle(deck.artStyleId)
      .setGameplayContext(deck.ruleKit?.modules)
      .setBackDesign(deck.cardBack, deck.name)
      .setFoilIntensity(FOIL_BY_GRADE[this.grade])
      .setInteractiveTilt(true)
      .setMotionProfile(detailedMotion ? 'full' : 'static');
    this.card.cursor = 'grab';
    this.card.setFlipOnTap(true);
    this.gradeText = new Text({
      text: this.grade,
      style: new TextStyle({
        fontFamily: FONT_FAMILY,
        fontSize: this.grade === 'SSR' ? 11 : 10,
        fontWeight: '800',
        fill: this.grade === 'SSR' ? COLORS.ink : COLORS.paper,
        letterSpacing: 0,
      }),
    });
    this.gradeText.anchor.set(0.5);
    this.sortableChildren = true;
    this.selection.zIndex = 0;
    this.card.zIndex = 10;
    this.ssrOrnament.zIndex = 18;
    this.gradePlate.zIndex = 20;
    this.gradeText.zIndex = 21;
    this.addChild(this.selection, this.card, this.ssrOrnament, this.gradePlate, this.gradeText);
    this.setSize(width);
  }

  setSize(width: number): void {
    this.cardWidth = width;
    this.cardHeight = width * CARD_RATIO;
    this.card.setSize(width);
    const color = GRADE_COLOR[this.grade];
    const badgeWidth = this.grade === 'SSR' ? 42 : 32;
    const badgeHeight = 22;
    const badgeX = -width / 2 + 8;
    const badgeY = -this.cardHeight / 2 + 8;
    this.selection
      .clear()
      .roundRect(-width / 2 - 5, -this.cardHeight / 2 - 5, width + 10, this.cardHeight + 10, width * 0.08)
      .stroke({ color, width: 2, alpha: this.selected ? 0.82 : 0 });
    this.gradePlate
      .clear()
      .moveTo(badgeX + 5, badgeY)
      .lineTo(badgeX + badgeWidth - 5, badgeY)
      .lineTo(badgeX + badgeWidth, badgeY + 5)
      .lineTo(badgeX + badgeWidth, badgeY + badgeHeight - 5)
      .lineTo(badgeX + badgeWidth - 5, badgeY + badgeHeight)
      .lineTo(badgeX + 5, badgeY + badgeHeight)
      .lineTo(badgeX, badgeY + badgeHeight - 5)
      .lineTo(badgeX, badgeY + 5)
      .closePath()
      .fill({ color, alpha: this.grade === 'SSR' ? 0.96 : 0.76 })
      .stroke({ color: COLORS.paper, width: 0.8, alpha: 0.68 });
    this.gradeText.style.fontSize = this.grade === 'SSR' ? Math.max(9, width * 0.067) : Math.max(8, width * 0.06);
    this.gradeText.position.set(badgeX + badgeWidth / 2, badgeY + badgeHeight / 2 + 0.5);
    this.ssrOrnament.clear();
    if (this.grade === 'SSR') {
      this.ssrOrnament
        .roundRect(-width / 2 - 8, -this.cardHeight / 2 - 8, width + 16, this.cardHeight + 16, width * 0.09)
        .stroke({ color: COLORS.gold, width: 1, alpha: 0.42 })
        .roundRect(-width / 2 - 13, -this.cardHeight / 2 - 13, width + 26, this.cardHeight + 26, width * 0.1)
        .stroke({ color: COLORS.violet, width: 0.8, alpha: 0.24 });
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        const radiusX = width * 0.62;
        const radiusY = this.cardHeight * 0.59;
        const x = Math.cos(angle) * radiusX;
        const y = Math.sin(angle) * radiusY;
        this.ssrOrnament
          .moveTo(x - 3, y)
          .lineTo(x + 3, y)
          .moveTo(x, y - 3)
          .lineTo(x, y + 3)
          .stroke({ color: index % 2 ? COLORS.violet : COLORS.gold, width: 1, alpha: 0.72 });
      }
    }
    this.hitArea = new Rectangle(-width / 2, -this.cardHeight / 2, width, this.cardHeight);
  }

  setSelected(selected: boolean, allowDetailedMotion: boolean): void {
    this.selected = selected;
    this.card.setAbilityPopoverEnabled(selected);
    const color = GRADE_COLOR[this.grade];
    this.selection.alpha = selected ? 1 : 0;
    this.selection.clear()
      .roundRect(
        -this.cardWidth / 2 - 5,
        -this.cardHeight / 2 - 5,
        this.cardWidth + 10,
        this.cardHeight + 10,
        this.cardWidth * 0.08,
      )
      .stroke({ color, width: 2, alpha: 0.84 });
    const shouldAnimate = allowDetailedMotion || selected;
    if (shouldAnimate !== this.detailedMotion) {
      this.detailedMotion = shouldAnimate;
      this.card.setMotionProfile(shouldAnimate ? 'full' : 'static');
    }
  }

  updateVisual(elapsed: number): void {
    const selectedScale = this.selected ? 1.035 : 1;
    this.scale.set(selectedScale);
    if (this.grade !== 'SSR') return;
    const pulse = (Math.sin(elapsed * 2.2 + this.body.id * 0.17) + 1) / 2;
    this.ssrOrnament.alpha = 0.48 + pulse * 0.42;
    this.ssrOrnament.scale.set(0.985 + pulse * 0.025);
  }
}

export class DeckShowcaseScene extends Container {
  private readonly deck: DeckData;
  private readonly chrome: TopBar;
  private readonly engine = Engine.create({ enableSleeping: true });
  private readonly tableBackground = new Graphics();
  private readonly tableMaterial = new TilingSprite({ texture: Texture.EMPTY, width: 1, height: 1 });
  private readonly tableOrnament = new Graphics();
  private readonly pointerLight = new Graphics();
  private readonly cardsLayer = new Container();
  private readonly dustLayer = new Graphics();
  private readonly toolbar = new Container();
  private readonly toolbarBackground = new Graphics();
  private readonly title = new Text({
    text: '牌组展览',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 30,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly kicker = new Text({
    text: 'DECK EXHIBITION  /  PHYSICS TABLE',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      fill: COLORS.gold,
      letterSpacing: 0,
    }),
  });
  private readonly deckName = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 18,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly collectionMeta = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '700',
      fill: COLORS.paperMuted,
      letterSpacing: 0,
    }),
  });
  private readonly fanButton: CanvasButton;
  private readonly galleryButton: CanvasButton;
  private readonly scatterButton: CanvasButton;
  private readonly flipButton: CanvasButton;
  private readonly focusButton: CanvasButton;
  private pieces: ShowcasePiece[] = [];
  private selectedPiece?: ShowcasePiece;
  private drag?: DragState;
  private dust: DustParticle[] = [];
  private viewport?: Viewport;
  private tableRect = new Rectangle();
  private cardWidth = 140;
  private accumulator = 0;
  private elapsed = 0;
  private dustAccumulator = 0;
  private arrangement: Arrangement = 'fan';
  private disposed = false;

  constructor(options: ShowcaseSceneOptions) {
    super();
    this.deck = options.deck;
    this.engine.gravity.x = 0;
    this.engine.gravity.y = 0;
    this.engine.gravity.scale = 0;
    this.sortableChildren = true;
    this.cardsLayer.sortableChildren = true;
    this.chrome = new TopBar({
      current: 'library',
      onHome: options.onHome,
      onNavigate: (scene) => {
        if (scene === 'studio') options.onStudio();
        if (scene === 'rules') options.onRules();
        if (scene === 'exchange') options.onExchange();
        if (scene === 'battle') options.onBattle();
      },
      action: {
        label: '返回作品库',
        icon: 'arrow-left',
        variant: 'secondary',
        accent: COLORS.gold,
        tooltip: '退出展览并返回作品库',
        onPress: options.onLibrary,
      },
    });
    this.fanButton = new CanvasButton({
      label: '扇形展陈',
      icon: 'layers',
      variant: 'secondary',
      accent: COLORS.gold,
      tooltip: '将牌组整理为扇形展陈',
      onPress: () => this.arrange('fan'),
    });
    this.galleryButton = new CanvasButton({
      label: '整齐陈列',
      icon: 'layout-grid',
      variant: 'secondary',
      accent: COLORS.jade,
      tooltip: '将牌组整理为整齐陈列',
      onPress: () => this.arrange('gallery'),
    });
    this.scatterButton = new CanvasButton({
      label: '散落桌面',
      icon: 'sparkles',
      variant: 'secondary',
      accent: COLORS.coral,
      tooltip: '让卡牌以物理效果散落桌面',
      onPress: () => this.scatter(),
    });
    this.flipButton = new CanvasButton({
      label: '全部翻面',
      icon: 'rotate-3d',
      variant: 'secondary',
      accent: COLORS.cyan,
      tooltip: '翻转全部卡牌的正面与卡背',
      onPress: () => this.flipAll(),
    });
    this.focusButton = new CanvasButton({
      label: 'SSR 鉴赏',
      icon: 'eye',
      variant: 'primary',
      accent: COLORS.gold,
      tooltip: '聚焦展示本套牌最高稀有度卡牌',
      onPress: () => this.focusRarest(),
    });
    this.toolbar.addChild(
      this.toolbarBackground,
      this.fanButton,
      this.galleryButton,
      this.scatterButton,
      this.flipButton,
      this.focusButton,
    );
    const ssrCount = this.deck.cards.filter((card) => GRADE_BY_RARITY[card.rarity] === 'SSR').length;
    const compositionState = describeDeckComposition(this.deck);
    this.deckName.text = this.deck.name;
    this.collectionMeta.text = `${compositionState.summary} · ${ssrCount} 张 SSR · ${MODE_BY_ID[this.deck.modeId].name}`;
    this.tableMaterial.alpha = 0.13;
    this.tableMaterial.tileScale.set(0.2);
    this.tableMaterial.eventMode = 'none';
    void loadLocalTexture(TABLE_TEXTURE).then((texture) => {
      if (!this.disposed && !texture.destroyed) this.tableMaterial.texture = texture;
    }).catch(() => undefined);
    this.tableBackground.zIndex = 0;
    this.tableMaterial.zIndex = 1;
    this.tableOrnament.zIndex = 2;
    this.pointerLight.zIndex = 3;
    this.cardsLayer.zIndex = 10;
    this.dustLayer.zIndex = 20;
    this.title.zIndex = 30;
    this.kicker.zIndex = 30;
    this.deckName.zIndex = 30;
    this.collectionMeta.zIndex = 30;
    this.toolbar.zIndex = 40;
    this.chrome.zIndex = 50;
    this.addChild(
      this.tableBackground,
      this.tableMaterial,
      this.tableOrnament,
      this.pointerLight,
      this.cardsLayer,
      this.dustLayer,
      this.title,
      this.kicker,
      this.deckName,
      this.collectionMeta,
      this.toolbar,
      this.chrome,
    );
    this.eventMode = 'static';
    this.on('pointermove', this.handlePointerMove);
    this.on('pointerup', this.releaseDrag);
    this.on('pointerupoutside', this.releaseDrag);
    this.on('pointercancel', this.releaseDrag);
    Ticker.shared.add(this.tick);
  }

  layout(viewport: Viewport): void {
    this.viewport = viewport;
    const { width, height, phone } = viewport;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.chrome.layout(viewport);
    const side = Math.max(viewport.safeLeft, phone ? 12 : 24);
    const headerTop = phone ? 64 : 76;
    const toolbarHeight = phone ? 58 : 66;
    const tableTop = phone ? 116 : 130;
    const tableBottom = height - toolbarHeight - (phone ? 8 : 12);
    const tableWidth = Math.max(1, width - side * 2);
    const tableHeight = Math.max(1, tableBottom - tableTop);
    this.tableRect = new Rectangle(side, tableTop, tableWidth, tableHeight);

    this.title.style.fontSize = phone ? 21 : 30;
    this.title.position.set(side, headerTop);
    this.kicker.visible = !phone;
    this.kicker.position.set(side + 1, headerTop + 38);
    this.deckName.anchor.set(1, 0);
    this.deckName.style.fontSize = phone ? 13 : 18;
    this.deckName.position.set(width - side, headerTop + (phone ? 1 : 0));
    fitTextWidth(this.deckName, this.deck.name, phone ? width * 0.48 : Math.min(360, width * 0.38));
    this.collectionMeta.anchor.set(1, 0);
    this.collectionMeta.style.fontSize = phone ? 8 : 10;
    this.collectionMeta.position.set(width - side, headerTop + (phone ? 27 : 30));

    this.drawTable();
    this.layoutToolbar(width, height, side, toolbarHeight, phone);
    this.rebuildPhysics();
  }

  private drawTable(): void {
    const { x, y, width, height } = this.tableRect;
    this.tableBackground
      .clear()
      .roundRect(x, y, width, height, 6)
      .fill({ color: 0x17191a, alpha: 0.9 })
      .stroke({ color: COLORS.gold, width: 1.2, alpha: 0.46 })
      .roundRect(x + 5, y + 5, width - 10, height - 10, 4)
      .stroke({ color: COLORS.cinnabar, width: 0.7, alpha: 0.35 });
    this.tableMaterial.position.set(x + 1, y + 1);
    this.tableMaterial.width = Math.max(1, width - 2);
    this.tableMaterial.height = Math.max(1, height - 2);
    this.tableOrnament.clear();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    this.tableOrnament
      .circle(centerX, centerY, Math.min(width, height) * 0.23)
      .stroke({ color: COLORS.gold, width: 0.8, alpha: 0.12 })
      .circle(centerX, centerY, Math.min(width, height) * 0.34)
      .stroke({ color: COLORS.jade, width: 0.7, alpha: 0.08 });
    const corner = 24;
    for (const [cx, cy, sx, sy] of [
      [x + 12, y + 12, 1, 1],
      [x + width - 12, y + 12, -1, 1],
      [x + 12, y + height - 12, 1, -1],
      [x + width - 12, y + height - 12, -1, -1],
    ] as const) {
      this.tableOrnament
        .moveTo(cx, cy + sy * corner)
        .lineTo(cx, cy)
        .lineTo(cx + sx * corner, cy)
        .stroke({ color: COLORS.gold, width: 1, alpha: 0.36 });
    }
  }

  private layoutToolbar(width: number, height: number, side: number, toolbarHeight: number, phone: boolean): void {
    const barY = height - toolbarHeight;
    this.toolbar.position.set(0, barY);
    this.toolbarBackground
      .clear()
      .rect(0, 0, width, toolbarHeight)
      .fill({ color: COLORS.ink, alpha: 0.94 })
      .moveTo(side, 0)
      .lineTo(width - side, 0)
      .stroke({ color: COLORS.gold, width: 1, alpha: 0.38 });
    const buttons = [
      this.fanButton,
      this.galleryButton,
      this.scatterButton,
      this.flipButton,
      this.focusButton,
    ];
    const gap = phone ? 5 : 8;
    if (phone) {
      const buttonSize = width >= 360 ? 44 : 40;
      const total = buttonSize * buttons.length + gap * (buttons.length - 1);
      let x = (width - total) / 2;
      buttons.forEach((button) => {
        button.setIconOnly(true);
        button.setLabel('');
        button.setSize(buttonSize, buttonSize);
        button.position.set(x, (toolbarHeight - buttonSize) / 2);
        x += buttonSize + gap;
      });
      return;
    }
    const labels = ['扇形展陈', '整齐陈列', '散落桌面', '全部翻面', 'SSR 鉴赏'];
    const buttonWidth = Math.min(126, (width - side * 2 - gap * 4) / 5);
    const total = buttonWidth * buttons.length + gap * 4;
    let x = (width - total) / 2;
    buttons.forEach((button, index) => {
      button.setIconOnly(false);
      button.setLabel(labels[index]);
      button.setSize(buttonWidth, 42);
      button.position.set(x, 12);
      x += buttonWidth + gap;
    });
  }

  private rebuildPhysics(): void {
    this.drag = undefined;
    Composite.clear(this.engine.world, false, true);
    this.cardsLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.pieces = [];
    const { x, y, width, height } = this.tableRect;
    const count = Math.max(1, this.deck.cards.length);
    const heightRatio = count > 10 ? 0.42 : 0.58;
    const byHeight = (height * heightRatio) / CARD_RATIO;
    const byWidth = (width / Math.min(7, count)) * 1.3;
    this.cardWidth = clamp(Math.min(166, byHeight, byWidth), 88, 166);
    const detailedMotion = count <= 8 && this.viewport?.renderDensity !== 'economy';
    this.deck.cards.forEach((cardData, index) => {
      const piece = new ShowcasePiece(cardData, this.deck, this.cardWidth, detailedMotion);
      piece.zIndex = index;
      piece.eventMode = 'static';
      piece.cursor = 'grab';
      piece.on('pointerdown', (event: FederatedPointerEvent) => this.beginDrag(piece, event));
      piece.on('pointertap', () => this.selectPiece(piece));
      attachInteractionHint(piece, () => `拖动《${cardData.name}》，点击可选中或翻面`);
      this.pieces.push(piece);
      this.cardsLayer.addChild(piece);
    });
    const thickness = 80;
    const boundaries = [
      Bodies.rectangle(x + width / 2, y - thickness / 2, width + thickness * 2, thickness, { isStatic: true }),
      Bodies.rectangle(x + width / 2, y + height + thickness / 2, width + thickness * 2, thickness, { isStatic: true }),
      Bodies.rectangle(x - thickness / 2, y + height / 2, thickness, height + thickness * 2, { isStatic: true }),
      Bodies.rectangle(x + width + thickness / 2, y + height / 2, thickness, height + thickness * 2, { isStatic: true }),
    ];
    Composite.add(this.engine.world, boundaries);
    this.pieces.forEach((piece) => {
      piece.body = Bodies.rectangle(x + width / 2, y + height / 2, this.cardWidth * 0.92, this.cardWidth * CARD_RATIO * 0.94, {
        chamfer: { radius: Math.max(5, this.cardWidth * 0.055) },
        restitution: 0.52,
        friction: 0.08,
        frictionAir: 0.035,
        density: 0.0012,
        sleepThreshold: 80,
      });
      Composite.add(this.engine.world, piece.body);
    });
    this.arrange(this.arrangement, true);
    this.selectPiece(this.pieces.find((piece) => piece.grade === 'SSR') ?? this.pieces[0]);
  }

  private arrange(arrangement: Arrangement, immediate = false): void {
    this.arrangement = arrangement;
    if (!this.pieces.length) return;
    const { x, y, width, height } = this.tableRect;
    if (arrangement === 'fan') {
      const centerX = x + width / 2;
      const centerY = y + height * 0.55;
      const maxSpan = Math.max(0, width - this.cardWidth * 1.12);
      const step = this.pieces.length > 1
        ? Math.min(this.cardWidth * 0.72, maxSpan / (this.pieces.length - 1))
        : 0;
      const span = step * (this.pieces.length - 1);
      const rotationStep = Math.min(0.095, 0.48 / Math.max(1, this.pieces.length - 1));
      this.pieces.forEach((piece, index) => {
        const offset = index - (this.pieces.length - 1) / 2;
        const targetX = centerX - span / 2 + step * index;
        const targetY = centerY + Math.abs(offset) * Math.min(6, this.cardWidth * 0.035);
        Body.setPosition(piece.body, { x: targetX, y: targetY });
        Body.setAngle(piece.body, offset * rotationStep);
        Body.setVelocity(piece.body, { x: 0, y: 0 });
        Body.setAngularVelocity(piece.body, 0);
        Sleeping.set(piece.body, immediate);
        piece.zIndex = index;
      });
    } else {
      const gapX = Math.max(18, this.cardWidth * 0.44);
      const gapY = Math.max(22, this.cardWidth * CARD_RATIO * 0.38);
      const columns = Math.max(1, Math.min(this.pieces.length, Math.floor((width - 24) / gapX)));
      const rows = Math.ceil(this.pieces.length / columns);
      const usedWidth = (columns - 1) * gapX;
      const usedHeight = (rows - 1) * gapY;
      this.pieces.forEach((piece, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const targetX = x + width / 2 - usedWidth / 2 + column * gapX;
        const targetY = y + height / 2 - usedHeight / 2 + row * gapY;
        Body.setPosition(piece.body, { x: targetX, y: targetY });
        Body.setAngle(piece.body, 0);
        Body.setVelocity(piece.body, { x: 0, y: 0 });
        Body.setAngularVelocity(piece.body, 0);
        Sleeping.set(piece.body, immediate);
        piece.zIndex = index;
      });
    }
    this.cardsLayer.sortChildren();
  }

  private scatter(): void {
    if (!this.pieces.length) return;
    const { x, y, width, height } = this.tableRect;
    const halfWidth = this.cardWidth * 0.52;
    const halfHeight = this.cardWidth * CARD_RATIO * 0.52;
    this.pieces.forEach((piece, index) => {
      const angle = (index / this.pieces.length) * Math.PI * 2 + Math.random() * 0.45;
      const radiusX = Math.max(0, width * (0.2 + Math.random() * 0.2) - halfWidth);
      const radiusY = Math.max(0, height * (0.16 + Math.random() * 0.2) - halfHeight);
      Sleeping.set(piece.body, false);
      Body.setPosition(piece.body, {
        x: clamp(x + width / 2 + Math.cos(angle) * radiusX, x + halfWidth, x + width - halfWidth),
        y: clamp(y + height / 2 + Math.sin(angle) * radiusY, y + halfHeight, y + height - halfHeight),
      });
      Body.setAngle(piece.body, (Math.random() - 0.5) * 0.5);
      Body.setVelocity(piece.body, {
        x: (Math.random() - 0.5) * 7,
        y: (Math.random() - 0.5) * 7,
      });
      Body.setAngularVelocity(piece.body, (Math.random() - 0.5) * 0.08);
    });
  }

  private flipAll(): void {
    const shouldFlip = this.pieces.filter((piece) => piece.card.isFlipped()).length < this.pieces.length / 2;
    this.pieces.forEach((piece) => piece.card.setFlipped(shouldFlip));
  }

  private focusRarest(): void {
    const piece = this.pieces.find((candidate) => candidate.grade === 'SSR')
      ?? this.pieces.find((candidate) => candidate.grade === 'SR')
      ?? this.pieces[0];
    if (!piece) return;
    const { x, y, width, height } = this.tableRect;
    Sleeping.set(piece.body, false);
    Body.setPosition(piece.body, { x: x + width / 2, y: y + height / 2 });
    Body.setAngle(piece.body, 0);
    Body.setVelocity(piece.body, { x: 0, y: 0 });
    Body.setAngularVelocity(piece.body, 0);
    this.selectPiece(piece);
    piece.card.setFlipped(false);
  }

  private selectPiece(piece?: ShowcasePiece): void {
    if (!piece) return;
    this.selectedPiece = piece;
    const detailedMotion = this.pieces.length <= 8 && this.viewport?.renderDensity !== 'economy';
    this.pieces.forEach((candidate) => candidate.setSelected(candidate === piece, detailedMotion));
    piece.zIndex = Math.max(100, ...this.pieces.map((candidate) => candidate.zIndex + 1));
    this.cardsLayer.sortChildren();
  }

  private beginDrag(piece: ShowcasePiece, event: FederatedPointerEvent): void {
    const point = event.global;
    const now = performance.now();
    Sleeping.set(piece.body, false);
    Body.setStatic(piece.body, true);
    piece.cursor = 'grabbing';
    piece.card.cursor = 'grabbing';
    this.selectPiece(piece);
    audioEngine.play('card-pick');
    this.drag = {
      piece,
      pointerId: event.pointerId,
      offsetX: piece.body.position.x - point.x,
      offsetY: piece.body.position.y - point.y,
      lastX: point.x,
      lastY: point.y,
      lastAt: now,
      velocityX: 0,
      velocityY: 0,
    };
  }

  private handlePointerMove = (event: FederatedPointerEvent): void => {
    const point = event.global;
    this.pointerLight.position.set(point.x, point.y);
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const delta = Math.max(4, now - this.drag.lastAt);
    this.drag.velocityX = ((point.x - this.drag.lastX) / delta) * FIXED_STEP_MS;
    this.drag.velocityY = ((point.y - this.drag.lastY) / delta) * FIXED_STEP_MS;
    this.drag.lastX = point.x;
    this.drag.lastY = point.y;
    this.drag.lastAt = now;
    const halfWidth = this.cardWidth * 0.46;
    const halfHeight = this.cardWidth * CARD_RATIO * 0.47;
    Body.setPosition(this.drag.piece.body, {
      x: clamp(
        point.x + this.drag.offsetX,
        this.tableRect.x + halfWidth,
        this.tableRect.x + this.tableRect.width - halfWidth,
      ),
      y: clamp(
        point.y + this.drag.offsetY,
        this.tableRect.y + halfHeight,
        this.tableRect.y + this.tableRect.height - halfHeight,
      ),
    });
  };

  private releaseDrag = (event: FederatedPointerEvent): void => {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const { piece, velocityX, velocityY } = this.drag;
    Body.setStatic(piece.body, false);
    Body.setVelocity(piece.body, {
      x: clamp(velocityX, -18, 18),
      y: clamp(velocityY, -18, 18),
    });
    Body.setAngularVelocity(piece.body, clamp(velocityX * 0.004, -0.08, 0.08));
    piece.cursor = 'grab';
    piece.card.cursor = 'grab';
    this.drag = undefined;
    audioEngine.play('card-drop');
  };

  private updateDust(deltaSeconds: number): void {
    if (getReducedMotion()) {
      this.dust = [];
      this.dustLayer.clear();
      return;
    }
    this.dustAccumulator += deltaSeconds;
    const ssrPieces = this.pieces.filter((piece) => piece.grade === 'SSR');
    const spawnInterval = this.viewport?.phone ? 0.18 : 0.11;
    if (ssrPieces.length && this.dustAccumulator >= spawnInterval) {
      this.dustAccumulator %= spawnInterval;
      const piece = ssrPieces[Math.floor(Math.random() * ssrPieces.length)];
      const angle = Math.random() * Math.PI * 2;
      this.dust.push({
        x: piece.body.position.x + Math.cos(angle) * this.cardWidth * 0.58,
        y: piece.body.position.y + Math.sin(angle) * this.cardWidth * CARD_RATIO * 0.55,
        vx: Math.cos(angle) * (8 + Math.random() * 16),
        vy: -10 - Math.random() * 18,
        life: 0.8,
        maxLife: 0.8,
        color: Math.random() > 0.35 ? COLORS.gold : COLORS.violet,
        radius: 1 + Math.random() * 2,
      });
    }
    this.dustLayer.clear();
    this.dust = this.dust.filter((particle) => {
      particle.life -= deltaSeconds;
      if (particle.life <= 0) return false;
      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      const ratio = particle.life / particle.maxLife;
      this.dustLayer.circle(particle.x, particle.y, particle.radius * (0.5 + ratio * 0.5)).fill({
        color: particle.color,
        alpha: ratio * 0.7,
      });
      return true;
    }).slice(-48);
  }

  private tick = (ticker: Ticker): void => {
    if (document.hidden || this.disposed || !this.viewport) return;
    const deltaMs = Math.min(50, ticker.deltaMS);
    const deltaSeconds = deltaMs / 1000;
    this.elapsed += deltaSeconds;
    this.accumulator = Math.min(FIXED_STEP_MS * 3, this.accumulator + deltaMs);
    while (this.accumulator >= FIXED_STEP_MS) {
      Engine.update(this.engine, FIXED_STEP_MS);
      this.accumulator -= FIXED_STEP_MS;
    }
    this.pieces.forEach((piece) => {
      piece.position.set(piece.body.position.x, piece.body.position.y);
      piece.rotation = piece.body.angle;
      piece.updateVisual(this.elapsed);
    });
    const lightPulse = (Math.sin(this.elapsed * 1.2) + 1) / 2;
    this.pointerLight
      .clear()
      .circle(0, 0, this.viewport.phone ? 74 : 116)
      .fill({ color: COLORS.gold, alpha: 0.012 + lightPulse * 0.012 });
    this.updateDust(deltaSeconds);
  };

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.disposed = true;
    Ticker.shared.remove(this.tick);
    Composite.clear(this.engine.world, false, true);
    Engine.clear(this.engine);
    this.tableMaterial.texture = Texture.EMPTY;
    super.destroy(options ?? { children: true });
  }
}
