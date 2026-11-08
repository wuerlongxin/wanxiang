import { Container, Graphics, Text, TextStyle, Texture, TilingSprite } from 'pixi.js';
import { COLORS, DISPLAY_FONT, FONT_FAMILY } from './theme';
import type { SceneId, Viewport } from './types';
import { CanvasButton, type ButtonVariant, type IconName } from './ui';
import { attachInteractionHint } from './interaction-hints';
import { loadLocalTexture } from './services/local-texture';
import { audioEngine, type AudioPreferences } from './services/audio';

export interface TopBarAction {
  label: string;
  icon: IconName | string;
  onPress: () => void;
  variant?: ButtonVariant;
  accent?: number;
  tooltip?: string;
}

export interface TopBarOptions {
  current: SceneId;
  onHome: () => void;
  onNavigate: (scene: Exclude<SceneId, 'lobby'>) => void;
  action?: TopBarAction;
  onExport?: () => void;
}

const MATERIAL_PATH = '/assets/ui/textures/lacquer-gilt.jpg';

export class TopBar extends Container {
  private readonly background = new Graphics();
  private readonly material = new TilingSprite({ texture: Texture.EMPTY, width: 1, height: 1 });
  private readonly ornament = new Graphics();
  private readonly logoMark = new Graphics();
  private readonly logoGlyph = new Text({
    text: '万',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 20,
      fontWeight: '700',
      fill: COLORS.ink,
      letterSpacing: 0,
    }),
  });
  private readonly brand = new Text({
    text: '万象卡域',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 20,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly brandEnglish = new Text({
    text: 'WANXIANG DECK',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '600',
      fill: COLORS.paperFaint,
      letterSpacing: 0,
    }),
  });
  private readonly homeHit = new Graphics();
  private readonly homeIndicator = new Graphics();
  private readonly homeHover = new Graphics();
  private readonly studioButton: CanvasButton;
  private readonly rulesButton: CanvasButton;
  private readonly libraryButton: CanvasButton;
  private readonly exchangeButton: CanvasButton;
  private readonly battleButton: CanvasButton;
  private readonly effectsButton: CanvasButton;
  private readonly musicButton: CanvasButton;
  private readonly actionButton: CanvasButton;
  private readonly hasAction: boolean;
  private readonly actionLabel: string;
  private current: SceneId;
  private disposed = false;
  private homeHovered = false;
  private readonly detachHomeHint: () => void;
  private readonly unsubscribeAudio: () => void;

  constructor(options: TopBarOptions) {
    super();
    this.current = options.current;
    const action = options.action ?? (options.onExport
      ? {
          label: '印刷导出',
          icon: 'download' as const,
          onPress: options.onExport,
          variant: 'secondary' as const,
          accent: COLORS.gold,
          tooltip: '导出印刷版套牌与玩法说明书',
        }
      : undefined);
    this.hasAction = Boolean(action);
    this.actionLabel = action?.label ?? '';

    const navigate = (scene: Exclude<SceneId, 'lobby'>): void => {
      if (this.current !== scene) options.onNavigate(scene);
    };
    this.studioButton = new CanvasButton({
      label: '设计台',
      icon: 'wand-sparkles',
      tooltip: '卡牌设计台',
      variant: 'ghost',
      selected: this.current === 'studio',
      onPress: () => navigate('studio'),
    });
    this.rulesButton = new CanvasButton({
      label: '玩法工坊',
      icon: 'layers',
      tooltip: '玩法积木与说明书',
      variant: 'ghost',
      selected: this.current === 'rules',
      onPress: () => navigate('rules'),
    });
    this.libraryButton = new CanvasButton({
      label: '作品库',
      icon: 'library',
      tooltip: '本地作品与历史版本',
      variant: 'ghost',
      selected: this.current === 'library',
      onPress: () => navigate('library'),
    });
    this.exchangeButton = new CanvasButton({
      label: '交换站',
      icon: 'network',
      tooltip: '去中心化卡牌交换',
      variant: 'ghost',
      selected: this.current === 'exchange',
      onPress: () => navigate('exchange'),
    });
    this.battleButton = new CanvasButton({
      label: '对战',
      icon: 'swords',
      tooltip: '选择对手，开始对战',
      variant: 'ghost',
      selected: this.current === 'battle',
      onPress: () => navigate('battle'),
    });
    const audioPreferences = audioEngine.getPreferences();
    this.effectsButton = new CanvasButton({
      label: audioPreferences.effectsEnabled
        ? '操作音效：已开启，点击关闭'
        : '操作音效：已关闭，点击开启',
      icon: audioPreferences.effectsEnabled ? 'volume-2' : 'volume-x',
      iconOnly: true,
      variant: 'ghost',
      accent: COLORS.jade,
      selected: audioPreferences.effectsEnabled,
      onPress: () => audioEngine.toggleEffects(true),
    });
    this.musicButton = new CanvasButton({
      label: audioPreferences.musicEnabled
        ? '背景雅乐：已开启，点击关闭'
        : '背景雅乐：已关闭，点击开启',
      icon: audioPreferences.musicEnabled ? 'music-2' : 'music',
      iconOnly: true,
      variant: 'ghost',
      accent: COLORS.gold,
      selected: audioPreferences.musicEnabled,
      onPress: () => audioEngine.toggleMusic(true),
    });
    this.actionButton = new CanvasButton({
      label: this.actionLabel,
      icon: action?.icon ?? 'download',
      tooltip: action?.tooltip,
      variant: action?.variant ?? 'secondary',
      accent: action?.accent ?? COLORS.gold,
      onPress: () => action?.onPress(),
    });
    this.actionButton.visible = this.hasAction;

    this.logoGlyph.anchor.set(0.5);
    this.homeHit.eventMode = 'static';
    this.homeHit.cursor = 'pointer';
    this.homeHit.on('pointertap', () => {
      if (this.current !== 'lobby') options.onHome();
    });
    this.homeHit.on('pointerover', () => {
      this.homeHovered = true;
      this.homeHover.alpha = 1;
      this.logoMark.alpha = 1;
    });
    this.homeHit.on('pointerout', () => {
      this.homeHovered = false;
      this.homeHover.alpha = 0;
      this.logoMark.alpha = 0.96;
    });
    this.detachHomeHint = attachInteractionHint(
      this.homeHit,
      () => this.current === 'lobby' ? '当前：交互大厅' : '返回交互大厅',
    );
    this.material.alpha = 0.13;
    this.material.tileScale.set(0.22);
    this.material.eventMode = 'none';
    void loadLocalTexture(MATERIAL_PATH).then((texture) => {
      if (!this.disposed && !texture.destroyed) this.material.texture = texture;
    }).catch(() => undefined);
    this.addChild(
      this.background,
      this.material,
      this.ornament,
      this.homeHit,
      this.logoMark,
      this.logoGlyph,
      this.brand,
      this.brandEnglish,
      this.homeIndicator,
      this.homeHover,
      this.studioButton,
      this.rulesButton,
      this.libraryButton,
      this.exchangeButton,
      this.battleButton,
      this.effectsButton,
      this.musicButton,
      this.actionButton,
    );
    this.unsubscribeAudio = audioEngine.subscribe(this.updateAudioControls);
  }

  setCurrent(value: SceneId): void {
    this.current = value;
    this.studioButton.setSelected(value === 'studio');
    this.rulesButton.setSelected(value === 'rules');
    this.libraryButton.setSelected(value === 'library');
    this.exchangeButton.setSelected(value === 'exchange');
    this.battleButton.setSelected(value === 'battle');
  }

  layout(viewport: Viewport): void {
    const { width, phone } = viewport;
    const height = viewport.profile.navigationHeight;
    const side = viewport.safeLeft;
    const iconLayout = phone || width < (this.hasAction ? 1040 : 900);
    this.background
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: COLORS.ink, alpha: 0.96 })
      .rect(0, height - 3, width, 1)
      .fill({ color: COLORS.bronze, alpha: 0.42 })
      .rect(0, height - 2, width, 2)
      .fill({ color: COLORS.gold, alpha: 0.22 });
    this.material.width = width;
    this.material.height = height - 2;
    this.material.tilePosition.x = -width * 0.08;

    this.ornament.clear();
    const fret = phone ? 28 : 40;
    for (let x = 0; x < width; x += fret) {
      this.ornament
        .moveTo(x, height - 8)
        .lineTo(x + fret * 0.52, height - 8)
        .lineTo(x + fret * 0.52, height - 12)
        .lineTo(x + fret * 0.78, height - 12)
        .stroke({ color: COLORS.gold, width: 0.7, alpha: 0.16 });
    }

    const markSize = phone ? 30 : 34;
    const homeSelected = this.current === 'lobby';
    this.logoMark
      .clear()
      .roundRect(side, (height - markSize) / 2, markSize, markSize, 5)
      .fill(homeSelected ? COLORS.cinnabar : COLORS.gold)
      .stroke({ color: homeSelected ? COLORS.gold : COLORS.paper, width: homeSelected ? 1.5 : 1, alpha: 0.72 })
      .roundRect(side + 4, (height - markSize) / 2 + 4, markSize - 8, markSize - 8, 3)
      .stroke({ color: homeSelected ? COLORS.gold : COLORS.cinnabar, width: 0.7, alpha: 0.56 });
    this.logoGlyph.style.fontSize = phone ? 17 : 20;
    this.logoGlyph.style.fill = homeSelected ? COLORS.paper : COLORS.ink;
    this.logoGlyph.position.set(side + markSize / 2, height / 2 - 1);
    this.brand.style.fontSize = 20;
    this.brand.position.set(side + markSize + 10, 14);
    this.brandEnglish.position.set(side + markSize + 11, 38);
    this.brand.visible = !phone && (!iconLayout || width >= 700);
    this.brandEnglish.visible = !phone && (!iconLayout || width >= 760);
    const brandHitWidth = this.brand.visible ? 188 : markSize;
    this.homeHit
      .clear()
      .rect(side, 0, brandHitWidth, height)
      .fill({ color: COLORS.white, alpha: 0.001 });
    this.homeHit.cursor = homeSelected ? 'default' : 'pointer';
    this.homeHover
      .clear()
      .roundRect(side - 3, (height - markSize) / 2 - 3, markSize + 6, markSize + 6, 7)
      .stroke({ color: COLORS.gold, width: 1.2, alpha: 0.72 });
    this.homeHover.alpha = this.homeHovered ? 1 : 0;
    this.homeIndicator
      .clear()
      .moveTo(side + 5, height - 2)
      .lineTo(side + markSize - 5, height - 2)
      .stroke({ color: COLORS.gold, width: 2, alpha: homeSelected ? 0.94 : 0 });

    const navButtons = [
      this.studioButton,
      this.rulesButton,
      this.libraryButton,
      this.exchangeButton,
      this.battleButton,
    ];
    const audioButtons = [this.effectsButton, this.musicButton];
    this.actionButton.visible = this.hasAction;

    if (iconLayout) {
      const buttons = this.hasAction
        ? [...navButtons, ...audioButtons, this.actionButton]
        : [...navButtons, ...audioButtons];
      const gap = phone ? (width < 360 ? 1 : 3) : 6;
      const reservedLeft = side + markSize + 2;
      const availableWidth = Math.max(1, width - side - reservedLeft);
      const fittedSize = Math.floor((availableWidth - gap * (buttons.length - 1)) / buttons.length);
      const buttonSize = phone ? Math.max(32, Math.min(40, fittedSize)) : 42;
      const navWidth = buttons.length * buttonSize + (buttons.length - 1) * gap;
      const navX = width - side - navWidth;
      navButtons.forEach((button) => {
        button.setIconOnly(true);
        button.setLabel('');
        button.setSize(buttonSize, buttonSize);
      });
      if (this.hasAction) {
        this.actionButton.setIconOnly(true);
        this.actionButton.setLabel('');
        this.actionButton.setSize(buttonSize, buttonSize);
      }
      audioButtons.forEach((button) => {
        button.setIconOnly(true);
        button.setSize(buttonSize, buttonSize);
      });
      buttons.forEach((button, index) => {
        button.position.set(navX + index * (buttonSize + gap), (height - buttonSize) / 2);
      });
      return;
    }

    const labels = ['设计台', '玩法工坊', '作品库', '交换站', '对战'];
    const widths = [92, 110, 96, 96, 84];
    navButtons.forEach((button, index) => {
      button.setIconOnly(false);
      button.setLabel(labels[index]);
      button.setSize(widths[index], 40);
    });
    const gap = 6;
    const navWidth = widths.reduce((sum, value) => sum + value, 0) + gap * (widths.length - 1);
    const audioGap = 10;
    const audioButtonSize = 40;
    const audioWidth = audioButtonSize * audioButtons.length + gap * (audioButtons.length - 1);
    const navigationGroupWidth = navWidth + audioGap + audioWidth;
    const actionWidth = this.hasAction ? Math.max(116, Math.min(138, 50 + this.actionLabel.length * 15)) : 0;
    const actionX = width - side - actionWidth;
    const brandRight = side + 194;
    const navMaxX = this.hasAction
      ? actionX - 16 - navigationGroupWidth
      : width - side - navigationGroupWidth;
    const centeredX = (width - navigationGroupWidth) / 2;
    const navX = Math.max(brandRight, Math.min(centeredX, navMaxX));
    let cursorX = navX;
    navButtons.forEach((button, index) => {
      button.position.set(cursorX, 12);
      cursorX += widths[index] + gap;
    });
    cursorX += audioGap - gap;
    audioButtons.forEach((button) => {
      button.setIconOnly(true);
      button.setSize(audioButtonSize, audioButtonSize);
      button.position.set(cursorX, 12);
      cursorX += audioButtonSize + gap;
    });
    if (this.hasAction) {
      this.actionButton.setIconOnly(false);
      this.actionButton.setLabel(this.actionLabel);
      this.actionButton.setSize(actionWidth, 40);
      this.actionButton.position.set(actionX, 12);
    }
  }

  private updateAudioControls = (preferences: AudioPreferences): void => {
    this.effectsButton.setSelected(preferences.effectsEnabled);
    this.effectsButton.setIcon(preferences.effectsEnabled ? 'volume-2' : 'volume-x');
    this.effectsButton.setLabel(
      preferences.effectsEnabled
        ? '操作音效：已开启，点击关闭'
        : '操作音效：已关闭，点击开启',
    );
    this.musicButton.setSelected(preferences.musicEnabled);
    this.musicButton.setIcon(preferences.musicEnabled ? 'music-2' : 'music');
    this.musicButton.setLabel(
      preferences.musicEnabled
        ? '背景雅乐：已开启，点击关闭'
        : '背景雅乐：已关闭，点击开启',
    );
  };

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.disposed = true;
    this.material.texture = Texture.EMPTY;
    this.detachHomeHint();
    this.unsubscribeAudio();
    super.destroy(options ?? { children: true });
  }
}
