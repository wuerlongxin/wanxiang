import { Container, Graphics, Rectangle, Text, TextStyle, Ticker } from 'pixi.js';
import { gsap } from 'gsap';
import { CardView } from '../card-view';
import { TopBar } from '../chrome';
import { createStarterCard, GAME_MODES } from '../data';
import { planDeckComposition } from '../deck-composition';
import { COLORS, DISPLAY_FONT, FONT_FAMILY } from '../theme';
import type { GameMode, Viewport } from '../types';
import { CanvasButton, IconSprite } from '../ui';
import { getReducedMotion, randomRange } from '../utils';
import { openProjectRepository } from '../services/external-links';
import { getLobbyCoreLayout, getLobbyRepositoryLayout } from './lobby-repository-layout';
import { attachInteractionHint } from '../interaction-hints';

interface TrailParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  radius: number;
  color: number;
}

interface LobbySceneOptions {
  onChoose: (mode: GameMode) => void;
  onStudio: () => void;
  onRules: () => void;
  onLibrary: () => void;
  onExchange: () => void;
  onBattle: () => void;
}

class CoreForgeCard extends Container {
  private readonly aura = new Graphics();
  private readonly card = new Graphics();
  private readonly inner = new Graphics();
  private readonly core = new Graphics();
  private readonly glyph = new Text({
    text: '万象',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 34,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
      align: 'center',
    }),
  });
  private readonly english = new Text({
    text: '铸界枢印  ·  FORGE SEAL',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      fill: COLORS.gold,
      letterSpacing: 0,
    }),
  });
  private elapsed = 0;
  private cardWidth = 176;
  private cardHeight = 246;

  constructor() {
    super();
    this.eventMode = 'none';
    this.glyph.anchor.set(0.5);
    this.english.anchor.set(0.5);
    this.addChild(this.aura, this.card, this.inner, this.core, this.glyph, this.english);
    Ticker.shared.add(this.tick);
    this.setSize(this.cardWidth);
  }

  setSize(width: number): void {
    this.cardWidth = width;
    this.cardHeight = width * (88 / 63);
    this.pivot.set(width / 2, this.cardHeight / 2);
    const radius = width * 0.08;
    const centerX = width / 2;
    const centerY = this.cardHeight * 0.47;
    this.aura
      .clear()
      .circle(centerX, centerY, width * 0.76)
      .stroke({ color: COLORS.gold, width: 1.2, alpha: 0.2 })
      .circle(centerX, centerY, width * 0.62)
      .stroke({ color: COLORS.bronze, width: 1, alpha: 0.24 })
      .circle(centerX, centerY, width * 0.5)
      .stroke({ color: COLORS.cinnabar, width: 0.8, alpha: 0.16 });
    for (let spoke = 0; spoke < 12; spoke += 1) {
      const angle = (spoke / 12) * Math.PI * 2;
      this.aura
        .moveTo(centerX + Math.cos(angle) * width * 0.61, centerY + Math.sin(angle) * width * 0.61)
        .lineTo(centerX + Math.cos(angle) * width * 0.73, centerY + Math.sin(angle) * width * 0.73)
        .stroke({ color: spoke % 3 ? COLORS.bronze : COLORS.gold, width: 1, alpha: 0.3 });
    }
    this.aura.pivot.set(centerX, centerY);
    this.aura.position.set(centerX, centerY);
    this.card
      .clear()
      .roundRect(0, 0, width, this.cardHeight, radius)
      .fill({ color: 0x2b1515, alpha: 0.99 })
      .stroke({ color: COLORS.bronze, width: width * 0.025, alpha: 0.98 })
      .roundRect(width * 0.045, width * 0.045, width * 0.91, this.cardHeight - width * 0.09, radius * 0.65)
      .stroke({ color: COLORS.gold, width: width * 0.012, alpha: 0.95 })
      .roundRect(width * 0.078, width * 0.078, width * 0.844, this.cardHeight - width * 0.156, radius * 0.42)
      .stroke({ color: COLORS.cinnabar, width: width * 0.006, alpha: 0.7 });
    this.inner
      .clear()
      .ellipse(centerX, centerY, width * 0.31, width * 0.44)
      .stroke({ color: COLORS.gold, width: width * 0.006, alpha: 0.52 })
      .ellipse(centerX, centerY, width * 0.44, width * 0.19)
      .stroke({ color: COLORS.jade, width: width * 0.006, alpha: 0.52 });
    for (const [x, y, sx, sy] of [
      [width * 0.16, this.cardHeight * 0.19, 1, 1],
      [width * 0.84, this.cardHeight * 0.19, -1, 1],
      [width * 0.16, this.cardHeight * 0.75, 1, -1],
      [width * 0.84, this.cardHeight * 0.75, -1, -1],
    ] as const) {
      this.inner
        .moveTo(x, y)
        .quadraticCurveTo(x + sx * width * 0.08, y - sy * width * 0.07, x + sx * width * 0.15, y)
        .quadraticCurveTo(x + sx * width * 0.09, y + sy * width * 0.08, x + sx * width * 0.03, y + sy * width * 0.035)
        .stroke({ color: COLORS.gold, width: width * 0.006, alpha: 0.52 });
    }
    this.core
      .clear()
      .circle(0, 0, width * 0.23)
      .fill({ color: COLORS.bronze, alpha: 0.16 })
      .stroke({ color: COLORS.gold, width: width * 0.012, alpha: 0.86 })
      .circle(0, 0, width * 0.18)
      .stroke({ color: COLORS.cinnabar, width: width * 0.007, alpha: 0.8 })
      .ellipse(0, 0, width * 0.18, width * 0.075)
      .stroke({ color: COLORS.jade, width: width * 0.006, alpha: 0.82 });
    for (let mark = 0; mark < 8; mark += 1) {
      const angle = (mark / 8) * Math.PI * 2;
      const innerRadius = width * 0.195;
      const outerRadius = width * (mark % 2 ? 0.218 : 0.228);
      this.core
        .moveTo(Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius)
        .lineTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius)
        .stroke({ color: mark % 2 ? COLORS.bronze : COLORS.gold, width: width * 0.008, alpha: 0.9 });
    }
    this.core.position.set(centerX, centerY);
    this.glyph.style.fontSize = Math.max(18, width * 0.19);
    this.glyph.position.set(centerX, centerY + width * 0.01);
    this.english.style.fontSize = Math.max(6, width * 0.05);
    this.english.position.set(centerX, this.cardHeight * 0.89);
  }

  private tick = (ticker: Ticker): void => {
    this.elapsed += Math.min(50, ticker.deltaMS) / 1000;
    const pulse = 1 + Math.sin(this.elapsed * 1.3) * 0.018;
    this.aura.scale.set(pulse);
    this.aura.alpha = 0.76 + Math.sin(this.elapsed * 1.8) * 0.18;
    this.core.rotation = this.elapsed * 0.045;
  };

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    Ticker.shared.remove(this.tick);
    super.destroy(options ?? { children: true });
  }
}

class RepositoryCopyrightPlaque extends Container {
  private readonly glow = new Graphics();
  private readonly frame = new Graphics();
  private readonly ornament = new Graphics();
  private readonly sheen = new Graphics();
  private readonly sheenMask = new Graphics();
  private readonly iconPlate = new Graphics();
  private readonly icon = new IconSprite('github', 18, COLORS.gold);
  private readonly copyright = new Text({
    text: '© 万象卡域 · MIT',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly repository = new Text({
    text: 'github.com/wuerlongxin/artificer-deck',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '500',
      fill: COLORS.paperMuted,
      letterSpacing: 0,
    }),
  });
  private controlWidth = 248;
  private controlHeight = 60;
  private elapsed = 0;
  private hovered = false;

  constructor(onPress: () => void) {
    super();
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.sheen.mask = this.sheenMask;
    this.addChild(
      this.glow,
      this.frame,
      this.ornament,
      this.sheen,
      this.sheenMask,
      this.iconPlate,
      this.icon,
      this.copyright,
      this.repository,
    );
    this.on('pointertap', onPress);
    this.on('pointerover', () => {
      this.hovered = true;
    });
    this.on('pointerout', () => {
      this.hovered = false;
    });
    attachInteractionHint(this, () => '打开 GitHub 仓库与 MIT 许可');
    this.layoutPlaque(this.controlWidth, this.controlHeight, false);
    Ticker.shared.add(this.tick);
  }

  layoutPlaque(width: number, height: number, stacked: boolean): void {
    this.controlWidth = width;
    this.controlHeight = height;
    const notch = Math.max(3, Math.min(7, height * 0.13));
    const traceFrame = (graphics: Graphics, inset = 0): Graphics => graphics
      .moveTo(inset + notch, inset)
      .lineTo(width - inset - notch, inset)
      .lineTo(width - inset, inset + notch)
      .lineTo(width - inset, height - inset - notch)
      .lineTo(width - inset - notch, height - inset)
      .lineTo(inset + notch, height - inset)
      .lineTo(inset, height - inset - notch)
      .lineTo(inset, inset + notch)
      .closePath();

    this.glow
      .clear()
      .roundRect(-3, -3, width + 6, height + 6, 8)
      .stroke({ color: COLORS.gold, width: 2, alpha: 0.14 });
    this.frame.clear();
    traceFrame(this.frame)
      .fill({ color: 0x160e13, alpha: 0.94 })
      .stroke({ color: COLORS.bronze, width: 1.1, alpha: 0.88 });
    traceFrame(this.frame, 3)
      .stroke({ color: COLORS.gold, width: 0.65, alpha: 0.46 });

    this.ornament
      .clear()
      .moveTo(notch + 8, 4)
      .lineTo(width * 0.45, 4)
      .stroke({ color: COLORS.jade, width: 0.8, alpha: 0.5 })
      .moveTo(width * 0.55, height - 4)
      .lineTo(width - notch - 8, height - 4)
      .stroke({ color: COLORS.gold, width: 0.8, alpha: 0.42 });
    for (const [x, y] of [[notch + 3, height - notch - 3], [width - notch - 3, notch + 3]] as const) {
      this.ornament
        .circle(x, y, 1.8)
        .fill({ color: COLORS.cinnabar, alpha: 0.9 })
        .circle(x, y, 4)
        .stroke({ color: COLORS.gold, width: 0.6, alpha: 0.4 });
    }

    this.sheen
      .clear()
      .moveTo(-height * 0.5, 0)
      .lineTo(-height * 0.2, 0)
      .lineTo(height * 0.34, height)
      .lineTo(0, height)
      .closePath()
      .fill({ color: COLORS.paper, alpha: 0.12 });
    this.sheenMask.clear();
    traceFrame(this.sheenMask).fill({ color: COLORS.white });

    if (stacked) {
      const iconSize = Math.max(14, Math.min(18, width * 0.2));
      this.iconPlate
        .clear()
        .roundRect(6, 7, iconSize + 8, iconSize + 8, 4)
        .fill({ color: 0x173233, alpha: 0.78 })
        .stroke({ color: COLORS.jade, width: 0.8, alpha: 0.72 });
      this.icon.setSize(iconSize);
      this.icon.position.set(10, 11);
      this.copyright.text = '© 万象卡域\n· MIT';
      this.copyright.style.fontSize = Math.max(6.5, Math.min(7.5, width * 0.075));
      this.copyright.style.lineHeight = 9;
      this.copyright.position.set(iconSize + 18, 7);
      this.repository.text = 'github.com/\nwuerlongxin/\nartificer-deck';
      this.repository.style.fontSize = Math.max(6.2, Math.min(7.2, width * 0.07));
      this.repository.style.lineHeight = 9;
      this.repository.position.set(8, 35);
    } else {
      const plateSize = Math.max(28, Math.min(40, height - 16));
      this.iconPlate
        .clear()
        .roundRect(8, (height - plateSize) / 2, plateSize, plateSize, 5)
        .fill({ color: 0x173233, alpha: 0.78 })
        .stroke({ color: COLORS.jade, width: 1, alpha: 0.72 })
        .circle(8 + plateSize / 2, height / 2, plateSize * 0.34)
        .stroke({ color: COLORS.gold, width: 0.7, alpha: 0.44 });
      const iconSize = Math.max(15, Math.min(19, plateSize * 0.48));
      this.icon.setSize(iconSize);
      this.icon.position.set(8 + (plateSize - iconSize) / 2, (height - iconSize) / 2);
      const textX = plateSize + 18;
      const compact = width < 200 || height < 52;
      this.copyright.text = '© 万象卡域 · MIT';
      this.copyright.style.fontSize = compact ? 8 : 10;
      this.copyright.style.lineHeight = compact ? 10 : 12;
      this.copyright.position.set(textX, compact ? 7 : 10);
      this.repository.text = 'github.com/wuerlongxin/artificer-deck';
      this.repository.style.fontSize = compact ? 7 : 9;
      this.repository.style.lineHeight = compact ? 9 : 11;
      this.repository.position.set(textX, compact ? 23 : 32);
    }
    this.hitArea = new Rectangle(0, 0, width, height);
  }

  private tick = (ticker: Ticker): void => {
    this.elapsed += Math.min(50, ticker.deltaMS) / 1000;
    const pulse = (Math.sin(this.elapsed * 1.7) + 1) / 2;
    this.glow.alpha = (this.hovered ? 0.72 : 0.3) + pulse * 0.2;
    if (!getReducedMotion()) {
      this.sheen.x = (this.elapsed * 34) % (this.controlWidth + this.controlHeight);
    }
  };

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    Ticker.shared.remove(this.tick);
    super.destroy(options ?? { children: true });
  }
}

export class LobbyScene extends Container {
  private readonly world = new Container();
  private readonly headerRule = new Graphics();
  private readonly brand = new Text({
    text: '交互大厅',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 34,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly english = new Text({
    text: 'LOBBY  /  WANXIANG DECK',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '700',
      fill: COLORS.paperFaint,
      letterSpacing: 0,
    }),
  });
  private readonly chapter = new Text({
    text: '五域共铸',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 24,
      fontWeight: '600',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly chapterIndex = new Text({
    text: 'CHAPTER  I',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '700',
      fill: COLORS.gold,
      letterSpacing: 0,
    }),
  });
  private readonly modeLabelBand = new Graphics();
  private readonly modeLabels = new Container();
  private readonly cardsLayer = new Container();
  private readonly effectsLayer = new Container();
  private readonly trail = new Graphics();
  private readonly flash = new Graphics();
  private readonly coreCard = new CoreForgeCard();
  private readonly chrome: TopBar;
  private readonly battleButton: CanvasButton;
  private readonly battleHint = new Text({
    text: '三档对手 · 用当前套牌出战',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 11,
      fontWeight: '600',
      fill: COLORS.paperFaint,
      letterSpacing: 0,
    }),
  });
  private readonly repositoryPlaque: RepositoryCopyrightPlaque;
  private readonly cards: CardView[] = [];
  private readonly onChoose: (mode: GameMode) => void;
  private viewport: Viewport | null = null;
  private particles: TrailParticle[] = [];
  private locked = false;
  private activeTimeline?: gsap.core.Timeline;

  constructor(options: LobbySceneOptions) {
    super();
    this.onChoose = options.onChoose;
    this.battleButton = new CanvasButton({
      label: '开始对战',
      icon: 'swords',
      variant: 'primary',
      accent: COLORS.cinnabar,
      onPress: () => options.onBattle(),
    });
    this.sortableChildren = true;
    this.world.sortableChildren = true;
    this.cardsLayer.sortableChildren = true;
    this.cardsLayer.zIndex = 10;
    this.modeLabelBand.zIndex = 30;
    this.modeLabels.zIndex = 31;
    this.chrome = new TopBar({
      current: 'lobby',
      onHome: () => undefined,
      onNavigate: (scene) => {
        if (scene === 'studio') options.onStudio();
        if (scene === 'rules') options.onRules();
        if (scene === 'library') options.onLibrary();
        if (scene === 'exchange') options.onExchange();
        if (scene === 'battle') options.onBattle();
      },
    });
    this.repositoryPlaque = new RepositoryCopyrightPlaque(() => {
      void openProjectRepository().catch(() => undefined);
    });
    this.repositoryPlaque.zIndex = 34;

    this.world.addChild(
      this.headerRule,
      this.brand,
      this.english,
      this.chapter,
      this.chapterIndex,
      this.repositoryPlaque,
      this.battleButton,
      this.battleHint,
      this.cardsLayer,
      this.modeLabelBand,
      this.modeLabels,
    );
    this.cardsLayer.addChild(this.coreCard);
    this.effectsLayer.addChild(this.trail);
    this.world.zIndex = 0;
    this.effectsLayer.zIndex = 40;
    this.chrome.zIndex = 80;
    this.flash.zIndex = 100;
    this.addChild(this.world, this.effectsLayer, this.chrome, this.flash);

    GAME_MODES.forEach((mode, index) => {
      const card = new CardView(createStarterCard(mode.id), mode, 180);
      card.zIndex = index;
      card.setFoilIntensity(index === 2 ? 0.9 : 0.62);
      card.on('pointertap', () => this.startFusion(index));
      attachInteractionHint(card, () => `进入${mode.name}卡牌设计台`);
      this.cards.push(card);
      this.cardsLayer.addChild(card);

      const label = new Text({
        text: `${mode.index}  ${mode.name}\n盒装 ${planDeckComposition(mode.id).totalCards} 张`,
        style: new TextStyle({
          fontFamily: FONT_FAMILY,
          fontSize: 10,
          fontWeight: '600',
          fill: index === 2 ? COLORS.paper : COLORS.paperFaint,
          letterSpacing: 0,
          align: 'center',
          lineHeight: 13,
        }),
      });
      label.anchor.set(0.5);
      this.modeLabels.addChild(label);
    });
    Ticker.shared.add(this.updateTrail);
  }

  layout(viewport: Viewport): void {
    this.viewport = viewport;
    const { width, height, phone } = viewport;
    const side = phone ? 18 : 42;
    this.chrome.layout(viewport);
    this.hitArea = { contains: (x: number, y: number) => x >= 0 && y >= 0 && x <= width && y <= height };
    this.flash.clear().rect(0, 0, width, height).fill(COLORS.paper).alpha = 0;

    this.brand.style.fontSize = phone ? 27 : 34;
    this.brand.position.set(side, phone ? 70 : 78);
    this.english.style.fontSize = phone ? 8 : 10;
    this.english.position.set(side + 2, phone ? 106 : 119);
    this.battleButton.setSize(phone ? 148 : 168, phone ? 40 : 44);
    this.battleButton.position.set(side, phone ? 140 : 152);
    this.battleHint.position.set(side + 2, phone ? 186 : 204);
    this.headerRule
      .clear()
      .moveTo(phone ? side + 174 : side + 224, phone ? 87 : 94)
      .lineTo(phone ? width - side : width - side - 142, phone ? 87 : 94)
      .stroke({ color: COLORS.gold, width: 1, alpha: 0.46 });

    this.chapter.style.fontSize = phone ? 18 : 24;
    this.chapter.anchor.set(phone ? 0 : 1, 0);
    this.chapter.position.set(phone ? side : width - side, phone ? 128 : 82);
    this.chapterIndex.anchor.set(phone ? 0 : 1, 0);
    this.chapterIndex.position.set(phone ? side : width - side, phone ? 154 : 113);

    const repositoryLayout = getLobbyRepositoryLayout(viewport);
    this.repositoryPlaque.layoutPlaque(
      repositoryLayout.width,
      repositoryLayout.height,
      repositoryLayout.stacked,
    );
    this.repositoryPlaque.position.set(repositoryLayout.x, repositoryLayout.y);

    const cardWidth = phone
      ? Math.min(116, width * 0.28)
      : Math.min(204, Math.max(154, width * 0.135), height * 0.255);
    const cardHeight = cardWidth * (88 / 63);
    const centerX = width / 2;
    const showModeLabels = !phone;
    const bandTop = height - 55;
    const labelY = height - 35;
    const maxSpread = phone ? width * 0.19 : Math.min(176, width * 0.125);
    const rotations = phone ? [-0.16, -0.08, 0, 0.08, 0.16] : [-0.2, -0.1, 0, 0.1, 0.2];
    const cardOffsets = rotations.map((_, index) => {
      const offset = Math.abs(index - 2);
      return Math.pow(offset, 1.45) * (phone ? 10 : showModeLabels ? 7 : 18);
    });
    const fanBottomExtent = Math.max(
      ...rotations.map((rotation, index) => {
        const projectedHalfHeight =
          Math.abs(Math.cos(rotation)) * cardHeight * 0.5 + Math.abs(Math.sin(rotation)) * cardWidth * 0.5;
        return cardOffsets[index] + projectedHalfHeight * 1.04;
      }),
    );
    const fanY = phone
      ? height - cardHeight * 0.48 - 34
      : showModeLabels
        ? Math.min(height * 0.64, bandTop - 22 - fanBottomExtent)
        : Math.min(height - cardHeight * 0.42 - 24, height * 0.73);

    this.cards.forEach((card, index) => {
      const offset = index - 2;
      card.setSize(cardWidth);
      card.position.set(
        centerX + offset * maxSpread,
        fanY + cardOffsets[index],
      );
      card.rotation = rotations[index];
      card.scale.set(1);
      card.alpha = 1;
      card.visible = true;
      card.zIndex = index === 2 ? 7 : 5 - Math.abs(offset);
    });

    const coreLayout = getLobbyCoreLayout(viewport);
    this.coreCard.setSize(coreLayout.width);
    this.coreCard.position.set(
      coreLayout.x + coreLayout.width / 2,
      coreLayout.y + coreLayout.height / 2,
    );
    this.coreCard.zIndex = 20;

    this.modeLabels.visible = showModeLabels;
    this.modeLabelBand.visible = showModeLabels;
    if (this.modeLabels.visible) {
      this.modeLabelBand
        .clear()
        .rect(side, bandTop, width - side * 2, 40)
        .fill({ color: COLORS.ink, alpha: 0.78 })
        .moveTo(side, bandTop)
        .lineTo(width - side, bandTop)
        .stroke({ color: COLORS.gold, width: 1, alpha: 0.42 });
      const slotWidth = (width - side * 2) / 5;
      for (let index = 1; index < 5; index += 1) {
        const x = side + slotWidth * index;
        this.modeLabelBand
          .moveTo(x, bandTop + 8)
          .lineTo(x, bandTop + 32)
          .stroke({ color: COLORS.bronze, width: 0.7, alpha: 0.28 });
      }
      this.modeLabels.position.set(0, 0);
      this.modeLabels.children.forEach((child, index) => {
        child.position.set(side + slotWidth * (index + 0.5), labelY);
      });
    } else {
      this.modeLabelBand.clear();
    }
  }

  private startFusion(index: number): void {
    if (this.locked || !this.viewport) return;
    this.locked = true;
    const mode = GAME_MODES[index];
    const card = this.cards[index];
    const reduced = getReducedMotion();
    this.cards.forEach((item) => item.setInteractiveTilt(false));
    card.zIndex = 100;

    const otherCards = this.cards.filter((_, cardIndex) => cardIndex !== index);
    const duration = reduced ? 0.16 : 0.52;
    const startX = card.x;
    const startY = card.y;
    let previousX = startX;
    let previousY = startY;

    this.activeTimeline = gsap.timeline({
      onComplete: () => this.onChoose(mode),
    });
    this.activeTimeline
      .to(otherCards, {
        alpha: 0.12,
        y: (itemIndex: number, target: CardView) => target.y + 34,
        duration: reduced ? 0.1 : 0.28,
        ease: 'power2.out',
      }, 0)
      .to(card, {
        x: this.coreCard.x,
        y: this.coreCard.y,
        rotation: 0,
        duration,
        ease: 'power3.in',
        onUpdate: () => {
          const dx = card.x - previousX;
          const dy = card.y - previousY;
          const speed = Math.hypot(dx, dy);
          if (speed > 1 && !reduced) {
            for (let particle = 0; particle < Math.min(5, 1 + Math.round(speed / 5)); particle += 1) {
              this.particles.push({
                x: card.x + randomRange(-10, 10),
                y: card.y + randomRange(-10, 10),
                vx: -dx * randomRange(0.3, 0.8) + randomRange(-14, 14),
                vy: -dy * randomRange(0.3, 0.8) + randomRange(-14, 14),
                life: 0.48,
                maxLife: 0.48,
                radius: randomRange(1.4, 4.2),
                color: Math.random() > 0.35 ? mode.accent : mode.accentSoft,
              });
            }
          }
          previousX = card.x;
          previousY = card.y;
        },
      }, 0.04)
      .to(card.scale, { x: 0.72, y: 0.72, duration, ease: 'power2.in' }, 0.04)
      .call(() => this.impact(mode), undefined, 0.04 + duration)
      .to(card, { alpha: 0, duration: reduced ? 0.06 : 0.12 }, 0.04 + duration)
      .to(this.coreCard.scale, {
        x: reduced ? 1.04 : 1.22,
        y: reduced ? 1.04 : 1.22,
        duration: reduced ? 0.08 : 0.2,
        ease: 'back.out(2.4)',
      }, 0.05 + duration)
      .call(() => this.prepareZoom(), undefined, 0.15 + duration)
      .to(this.world.scale, {
        x: reduced ? 1.08 : 1.72,
        y: reduced ? 1.08 : 1.72,
        duration: reduced ? 0.12 : 0.46,
        ease: 'power3.inOut',
      }, 0.19 + duration)
      .to(this.flash, {
        alpha: 1,
        duration: reduced ? 0.08 : 0.28,
        ease: 'power2.in',
      }, 0.32 + duration);
  }

  private impact(mode: GameMode): void {
    for (let index = 0; index < 3; index += 1) {
      const ring = new Graphics()
        .circle(0, 0, 34 + index * 12)
        .stroke({ color: index === 1 ? mode.accentSoft : mode.accent, width: 3 - index * 0.5, alpha: 0.9 });
      ring.position.set(this.coreCard.x, this.coreCard.y);
      ring.scale.set(0.55);
      this.effectsLayer.addChild(ring);
      gsap.to(ring.scale, {
        x: 3.4 + index * 0.7,
        y: 3.4 + index * 0.7,
        duration: 0.42 + index * 0.06,
        ease: 'power2.out',
      });
      gsap.to(ring, {
        alpha: 0,
        duration: 0.42 + index * 0.06,
        ease: 'power2.out',
        onComplete: () => ring.destroy(),
      });
    }
    for (let burst = 0; burst < 46; burst += 1) {
      const angle = randomRange(0, Math.PI * 2);
      const speed = randomRange(36, 170);
      this.particles.push({
        x: this.coreCard.x,
        y: this.coreCard.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randomRange(0.35, 0.72),
        maxLife: 0.72,
        radius: randomRange(1.2, 4.8),
        color: burst % 4 === 0 ? COLORS.paper : burst % 3 === 0 ? mode.accentSoft : mode.accent,
      });
    }
  }

  private prepareZoom(): void {
    this.world.pivot.set(this.coreCard.x, this.coreCard.y);
    this.world.position.set(this.coreCard.x, this.coreCard.y);
  }

  private updateTrail = (ticker: Ticker): void => {
    const delta = Math.min(50, ticker.deltaMS) / 1000;
    this.trail.clear();
    this.particles = this.particles.filter((particle) => {
      particle.life -= delta;
      if (particle.life <= 0) return false;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= Math.pow(0.07, delta);
      particle.vy *= Math.pow(0.07, delta);
      const ratio = particle.life / particle.maxLife;
      this.trail.circle(particle.x, particle.y, particle.radius * (0.45 + ratio * 0.55)).fill({
        color: particle.color,
        alpha: Math.min(1, ratio * 1.4),
      });
      return true;
    });
  };

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.activeTimeline?.kill();
    Ticker.shared.remove(this.updateTrail);
    super.destroy(options ?? { children: true });
  }
}
