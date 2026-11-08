import { Container, Graphics, Rectangle, Text, TextStyle, Ticker } from 'pixi.js';
import { CardView } from '../card-view';
import {
  ART_STYLE_PRESETS,
  artStylesForCategory,
  getArtStyleUiTheme,
  resolveArtStyle,
  type ArtStyleCategory,
  type ArtStyleId,
  type ArtStylePreset,
} from '../art-styles';
import { TopBar } from '../chrome';
import { createCardBack, MODE_BY_ID, THEME_PRESETS } from '../data';
import { attachInteractionHint } from '../interaction-hints';
import { renderDeckRules } from '../rules';
import {
  describeDeckComposition,
  resolveDeckComposition,
} from '../deck-composition';
import {
  ApiError,
  generateDeck as requestGeneratedDeck,
  regenerateCardArtwork as requestRegeneratedArtwork,
  type DeckGenerationProgress,
} from '../services/api';
import { dispatchAudioCue } from '../services/audio';
import { applyAuthorToEntireDeck } from '../services/deck-authorship';
import { describeRevision } from '../services/deck-identity';
import {
  resolveDeckCreationMode,
} from '../services/content-policy';
import { COLORS, DISPLAY_FONT, FONT_FAMILY } from '../theme';
import type {
  CardData,
  DeckData,
  DeckRevisionReason,
  Viewport,
} from '../types';
import {
  CanvasButton,
  CanvasInput,
  CanvasSlider,
  IconSprite,
  SegmentedControl,
  ToastLayer,
  Toggle,
} from '../ui';
import { announce } from '../utils';
import {
  getStudioLowHeightLandscapeLayout,
  isStudioLowHeightLandscape,
} from './studio-layout';
import {
  orderedCurrentStreamedCards,
  reconcileGeneratedCards,
} from './studio-card-stream';

type EditorTab = 'stats' | 'skill' | 'style' | 'mark';
type InscriptionStyle = NonNullable<CardData['inscriptionStyle']>;
type InscriptionPlacement = NonNullable<CardData['inscriptionPlacement']>;

class ArtStyleSample extends Container {
  private readonly background = new Graphics();
  private readonly card = new Graphics();
  private readonly artwork = new Graphics();
  private readonly sheen = new Graphics();
  private readonly artMask = new Graphics();
  private readonly swatches = new Graphics();
  private readonly nameText = new Text({ text: '' });
  private readonly taglineText = new Text({ text: '' });
  private readonly descriptionText = new Text({ text: '' });
  private readonly sampleText = new Text({ text: '样卡  /  SAMPLE' });
  private preset: ArtStylePreset = resolveArtStyle(undefined);
  private sampleWidth = 248;
  private sampleHeight = 110;
  private hovered = false;

  constructor() {
    super();
    this.sheen.blendMode = 'add';
    this.sheen.mask = this.artMask;
    this.addChild(
      this.background,
      this.card,
      this.artwork,
      this.sheen,
      this.artMask,
      this.nameText,
      this.taglineText,
      this.descriptionText,
      this.sampleText,
      this.swatches,
    );
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerover', () => {
      this.hovered = true;
      this.draw();
    });
    this.on('pointerout', () => {
      this.hovered = false;
      this.draw();
    });
    this.draw();
  }

  setStyle(preset: ArtStylePreset): void {
    this.preset = preset;
    this.draw();
  }

  override setSize(width: number, height = this.sampleHeight): void {
    this.sampleWidth = Math.max(180, width);
    this.sampleHeight = Math.max(60, height);
    this.draw();
  }

  animate(time: number): void {
    const cardX = 10;
    const cardHeight = this.sampleHeight - 18;
    const compact = this.sampleHeight < 82;
    const cardWidth = Math.min(62, cardHeight * (63 / 88));
    const artX = cardX + (compact ? 4 : 6);
    const artWidth = cardWidth - (compact ? 8 : 12);
    const cycle = (time * 0.045) % (artWidth + 28);
    this.sheen.x = artX - 20 + cycle;
    this.sheen.alpha = 0.18 + Math.sin(time / 520) * 0.07;
  }

  private draw(): void {
    const { palette } = this.preset;
    const uiTheme = getArtStyleUiTheme(this.preset.id);
    const width = this.sampleWidth;
    const height = this.sampleHeight;
    const cardX = 10;
    const cardY = 9;
    const cardHeight = height - 18;
    const compact = height < 82;
    const cardWidth = Math.min(62, cardHeight * (63 / 88));
    const artX = cardX + (compact ? 4 : 6);
    const artY = cardY + (compact ? 5 : 17);
    const artWidth = cardWidth - (compact ? 8 : 12);
    const artHeight = compact ? cardHeight - 10 : Math.max(38, cardHeight * 0.55);
    const textX = cardX + cardWidth + 14;
    const textWidth = Math.max(82, width - textX - 10);

    this.background
      .clear()
      .roundRect(0, 0, width, height, 7)
      .fill({ color: uiTheme.panel, alpha: this.hovered ? 0.98 : 0.86 })
      .stroke({
        color: this.hovered ? uiTheme.ornament : uiTheme.accent,
        width: this.hovered ? 1.6 : 1,
        alpha: this.hovered ? 0.92 : 0.56,
      });
    if (uiTheme.corner === 'cloud' || uiTheme.corner === 'ruyi') {
      this.background
        .circle(9, 9, 5)
        .stroke({ color: uiTheme.ornament, width: 1, alpha: 0.46 })
        .circle(width - 9, height - 9, 5)
        .stroke({ color: uiTheme.ornament, width: 1, alpha: 0.46 });
    } else {
      this.background
        .moveTo(4, 17)
        .lineTo(4, 4)
        .lineTo(17, 4)
        .stroke({ color: uiTheme.ornament, width: 1.2, alpha: 0.58 })
        .moveTo(width - 17, height - 4)
        .lineTo(width - 4, height - 4)
        .lineTo(width - 4, height - 17)
        .stroke({ color: uiTheme.ornament, width: 1.2, alpha: 0.58 });
    }
    this.card
      .clear()
      .roundRect(cardX, cardY, cardWidth, cardHeight, 4)
      .fill({ color: palette.paper })
      .stroke({ color: palette.accent, width: 1.5 })
      .roundRect(cardX + 3, cardY + 3, cardWidth - 6, cardHeight - 6, 3)
      .stroke({ color: palette.primary, width: 1 });
    if (!compact) {
      this.card
        .rect(cardX + 7, cardY + cardHeight - 19, cardWidth - 14, 11)
        .fill({ color: palette.ink, alpha: 0.88 })
        .circle(cardX + cardWidth / 2, cardY + 9, 4)
        .fill({ color: palette.primary });
    }

    this.artwork.clear().roundRect(artX, artY, artWidth, artHeight, 2).fill({ color: palette.secondary });
    const motifIndex = Math.max(0, ART_STYLE_PRESETS.findIndex((style) => style.id === this.preset.id));
    for (let index = 0; index < 5; index += 1) {
      const px = artX + 6 + ((motifIndex * 11 + index * 17) % Math.max(8, artWidth - 12));
      const py = artY + 7 + ((motifIndex * 7 + index * 13) % Math.max(8, artHeight - 14));
      const radius = 2 + ((motifIndex + index) % 4);
      this.artwork.circle(px, py, radius).fill({
        color: index % 2 === 0 ? palette.accent : palette.paper,
        alpha: 0.24 + index * 0.07,
      });
    }
    const centerX = artX + artWidth * 0.52;
    const centerY = artY + artHeight * 0.48;
    this.artwork
      .circle(centerX, centerY - 8, Math.max(4, artWidth * 0.1))
      .fill({ color: palette.paper, alpha: 0.95 })
      .poly([
        centerX,
        centerY - 3,
        centerX - artWidth * 0.18,
        centerY + artHeight * 0.34,
        centerX + artWidth * 0.2,
        centerY + artHeight * 0.34,
      ])
      .fill({ color: palette.primary, alpha: 0.95 });
    if (['cut', 'glass', 'geometry', 'oracle'].includes(this.preset.motif)) {
      this.artwork
        .poly([
          artX + 5,
          artY + artHeight - 8,
          artX + artWidth * 0.3,
          artY + 8,
          artX + artWidth * 0.54,
          artY + artHeight - 7,
        ])
        .stroke({ color: palette.accent, width: 1.5, alpha: 0.8 });
    } else if (['ink', 'mountain', 'cloud', 'porcelain'].includes(this.preset.motif)) {
      this.artwork
        .moveTo(artX + 3, artY + artHeight * 0.72)
        .bezierCurveTo(
          artX + artWidth * 0.22,
          artY + artHeight * 0.46,
          artX + artWidth * 0.48,
          artY + artHeight * 0.92,
          artX + artWidth - 3,
          artY + artHeight * 0.58,
        )
        .stroke({ color: palette.paper, width: 1.5, alpha: 0.7 });
    } else {
      for (let line = 0; line < 3; line += 1) {
        this.artwork
          .moveTo(artX + 4, artY + 8 + line * 10)
          .lineTo(artX + artWidth - 4, artY + 4 + line * 12)
          .stroke({ color: palette.accent, width: 1, alpha: 0.45 });
      }
    }

    this.artMask.clear().roundRect(artX, artY, artWidth, artHeight, 2).fill(0xffffff);
    this.sheen
      .clear()
      .rect(0, artY - 8, 11, artHeight + 16)
      .fill({ color: palette.paper, alpha: 0.7 });
    this.sheen.rotation = -0.18;

    this.nameText.text = this.preset.name;
    this.nameText.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 17,
      fontWeight: '700',
      fill: palette.paper,
      letterSpacing: 0,
    });
    this.nameText.position.set(textX, compact ? 7 : 13);
    this.taglineText.text = this.preset.tagline;
    this.taglineText.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '600',
      fill: palette.accent,
      letterSpacing: 0,
      wordWrap: true,
      wordWrapWidth: textWidth,
    });
    this.taglineText.position.set(textX, compact ? 30 : 37);
    this.descriptionText.text = this.preset.description;
    this.descriptionText.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '400',
      fill: palette.paper,
      letterSpacing: 0,
      lineHeight: 13,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: textWidth,
    });
    this.descriptionText.alpha = 0.78;
    this.descriptionText.position.set(textX, 55);
    this.descriptionText.visible = !compact;
    this.sampleText.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 8,
      fontWeight: '700',
      fill: palette.paper,
      letterSpacing: 0,
    });
    this.sampleText.alpha = 0.48;
    this.sampleText.position.set(textX, height - 17);
    this.sampleText.visible = !compact;
    this.swatches.clear();
    [palette.primary, palette.secondary, palette.accent, palette.paper].forEach((color, index) => {
      this.swatches.circle(width - 10 - index * 11, height - 12, 3.5).fill({ color });
    });
    this.hitArea = new Rectangle(0, 0, width, height);
  }
}

function fitTextHeight(text: Text, value: string, maxHeight: number): void {
  const source = value.trim();
  text.text = source;
  if (!source || text.height <= maxHeight) return;

  const characters = Array.from(source);
  text.text = '…';
  if (text.height > maxHeight) {
    text.text = '';
    return;
  }

  let low = 0;
  let high = characters.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, midpoint).join('').trimEnd()}…`;
    text.text = candidate;
    if (text.height <= maxHeight) low = midpoint;
    else high = midpoint - 1;
  }
  text.text = `${characters.slice(0, low).join('').trimEnd()}…`;
}

function fitSingleLineWidth(
  text: Text,
  value: string,
  maxWidth: number,
  preferredSize: number,
  minimumSize: number,
): void {
  text.style.fontSize = preferredSize;
  text.text = value;
  if (text.width <= maxWidth) return;
  text.style.fontSize = Math.max(minimumSize, preferredSize * maxWidth / text.width);
}

interface StudioSceneOptions {
  deck: DeckData;
  onHome: () => void;
  onLibrary: () => void;
  onRules: () => void;
  onExchange: () => void;
  onBattle: () => void;
  onDeckChange: (deck: DeckData) => DeckData;
  onDeckRevision: (deck: DeckData, reason: DeckRevisionReason) => DeckData;
  onDeckCheckpoint: () => void;
  onContentPolicy: (deck: DeckData) => void;
  onExport: (deck: DeckData) => void;
}

export class StudioScene extends Container {
  private deck: DeckData;
  private selectedIndex = 0;
  private readonly onDeckChange: (deck: DeckData) => DeckData;
  private readonly onDeckRevision: (deck: DeckData, reason: DeckRevisionReason) => DeckData;
  private readonly onDeckCheckpoint: () => void;
  private readonly onContentPolicy: (deck: DeckData) => void;
  private readonly onExport: (deck: DeckData) => void;
  private readonly chrome: TopBar;
  private readonly leftBand = new Graphics();
  private readonly rightBand = new Graphics();
  private readonly workspaceLines = new Graphics();
  private readonly previewHalo = new Graphics();
  private readonly editor = new Container();
  private readonly detailPanel = new Container();
  private readonly deckStrip = new Container();
  private readonly deckStripBg = new Graphics();
  private readonly stripPreviousButton: CanvasButton;
  private readonly stripNextButton: CanvasButton;
  private readonly deckStripLabel = new Text({
    text: '套牌  /  DECK',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '700',
      fill: COLORS.paperFaint,
      letterSpacing: 0,
    }),
  });
  private readonly editorTitle = new Text({
    text: '铸卡台',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 24,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly editorKicker = new Text({
    text: 'WANXIANG DECK FORGE',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      fill: COLORS.jade,
      letterSpacing: 0,
    }),
  });
  private readonly themeInput: CanvasInput;
  private readonly contentPolicyButton: CanvasButton;
  private readonly generateButton: CanvasButton;
  private readonly presetControl: SegmentedControl<string>;
  private readonly tabControl: SegmentedControl<EditorTab>;
  private readonly attackSlider: CanvasSlider;
  private readonly defenseSlider: CanvasSlider;
  private readonly foilToggle: Toggle;
  private readonly skillInput: CanvasInput;
  private readonly authorInput: CanvasInput;
  private readonly applyAuthorToDeckButton: CanvasButton;
  private readonly inscriptionStyleControl: SegmentedControl<InscriptionStyle>;
  private readonly inscriptionPlacementControl: SegmentedControl<InscriptionPlacement>;
  private readonly cardBackButton: CanvasButton;
  private readonly styleCategoryControl: SegmentedControl<ArtStyleCategory>;
  private readonly stylePreviousButton: CanvasButton;
  private readonly styleNextButton: CanvasButton;
  private readonly styleSelectButton: CanvasButton;
  private readonly regenerateArtworkButton: CanvasButton;
  private readonly styleSample = new ArtStyleSample();
  private readonly infoKicker = new Text({
    text: 'WORLD & RULES',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      fill: COLORS.gold,
      letterSpacing: 0,
    }),
  });
  private readonly deckNameText = new Text({ text: '' });
  private readonly deckThemeText = new Text({ text: '' });
  private readonly storyText = new Text({ text: '' });
  private readonly rulesText = new Text({ text: '' });
  private readonly metaText = new Text({ text: '' });
  private readonly exchangeButton: CanvasButton;
  private readonly previewTag = new Container();
  private readonly previewTagBg = new Graphics();
  private readonly previewTagIcon = new IconSprite('rotate-3d', 15, COLORS.jade);
  private readonly previewTagText = new Text({
    text: '翻到卡背',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      fill: COLORS.jade,
      letterSpacing: 0,
    }),
  });
  private readonly loading = new Container();
  private readonly loadingBg = new Graphics();
  private readonly loadingRing = new Graphics();
  private readonly loadingIcon = new IconSprite('sparkles', 22, COLORS.gold);
  private readonly loadingCardProgress = new Graphics();
  private readonly loadingText = new Text({
    text: '正在炼制套牌',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 13,
      fontWeight: '600',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly toast: ToastLayer;
  private previewCard: CardView;
  private stripCards: CardView[] = [];
  private stripCardIndices: number[] = [];
  private stripCapacity = 4;
  private editorTab: EditorTab = 'stats';
  private generating = false;
  private disposed = false;
  private operationVersion = 0;
  private deckGenerationProgress: DeckGenerationProgress | null = null;
  private loadingGeometry: { x: number; y: number; width: number } | null = null;
  private compositionNoticeShown = false;
  private acceptsDeferredActions = true;
  private viewport: Viewport | null = null;

  constructor(options: StudioSceneOptions) {
    super();
    this.deck = options.deck;
    this.selectedIndex = 0;
    this.onDeckChange = options.onDeckChange;
    this.onDeckRevision = options.onDeckRevision;
    this.onDeckCheckpoint = options.onDeckCheckpoint;
    this.onContentPolicy = options.onContentPolicy;
    this.onExport = options.onExport;
    this.sortableChildren = true;

    this.chrome = new TopBar({
      current: 'studio',
      onHome: options.onHome,
      onNavigate: (scene) => {
        if (scene === 'library') options.onLibrary();
        if (scene === 'rules') options.onRules();
        if (scene === 'exchange') options.onExchange();
        if (scene === 'battle') options.onBattle();
      },
      onExport: () => this.onExport(this.deck),
    });
    this.themeInput = new CanvasInput({
      label: '套装主题',
      value: this.deck.theme,
      placeholder: '输入一个独特世界，例如：赛博西游',
      icon: 'sparkles',
      maxLength: 120,
      onSubmit: () => void this.generate(),
    });
    this.contentPolicyButton = new CanvasButton({
      label: '原创模式',
      icon: 'shield-check',
      tooltip: '设置原创或个人同人研习模式',
      variant: 'secondary',
      accent: COLORS.jade,
      onPress: () => this.openContentPolicy(),
    });
    this.generateButton = new CanvasButton({
      label: this.generateButtonLabel(false),
      icon: 'wand-sparkles',
      variant: 'primary',
      accent: MODE_BY_ID[this.deck.modeId].accent,
      onPress: () => void this.generate(),
    });
    this.presetControl = new SegmentedControl({
      items: THEME_PRESETS.slice(0, 3).map((preset) => ({ value: preset, label: preset })),
      value: THEME_PRESETS[0],
      onChange: (value) => this.themeInput.setValue(value),
    });
    this.tabControl = new SegmentedControl<EditorTab>({
      items: [
        { value: 'stats', label: '属性', icon: 'sliders-horizontal' },
        { value: 'skill', label: '技能', icon: 'swords' },
        { value: 'style', label: '风格', icon: 'image' },
        { value: 'mark', label: '铭文', icon: 'stamp' },
      ],
      value: this.editorTab,
      accent: MODE_BY_ID[this.deck.modeId].accent,
      onChange: (value) => {
        if (value !== 'skill') this.skillInput.blur();
        if (value !== 'mark') this.authorInput.blur();
        this.editorTab = value;
        this.updateEditorVisibility();
      },
    });
    this.attackSlider = new CanvasSlider({
      min: 0,
      max: 99,
      step: 1,
      value: this.currentCard.attack,
      label: '攻击力',
      accent: COLORS.coral,
      onInput: (value) => this.updateCurrentCard({ attack: value }),
    });
    this.defenseSlider = new CanvasSlider({
      min: 0,
      max: 99,
      step: 1,
      value: this.currentCard.defense,
      label: '防御力',
      accent: COLORS.cyan,
      onInput: (value) => this.updateCurrentCard({ defense: value }),
    });
    this.foilToggle = new Toggle({
      label: '全息镭射',
      value: true,
      accent: MODE_BY_ID[this.deck.modeId].accent,
      onChange: (value) => this.previewCard?.setFoilIntensity(value ? 0.95 : 0.18),
    });
    this.skillInput = new CanvasInput({
      label: '特殊技能',
      value: this.currentCard.skill,
      multiline: true,
      maxLength: 160,
      accent: MODE_BY_ID[this.deck.modeId].accent,
      onInput: (value) => this.updateCurrentCard({ skill: value }),
    });
    this.authorInput = new CanvasInput({
      label: '作者铭文',
      value: this.currentCard.author,
      placeholder: '刻下你的署名',
      icon: 'pen-line',
      maxLength: 24,
      accent: COLORS.gold,
      onInput: (value) => {
        const previousAuthor = this.currentCard.author;
        const previousInscription = this.currentCard.inscriptionText?.trim();
        const author = value.trim() || '佚名';
        this.updateCurrentCard({
          author,
          ...(!previousInscription || previousInscription === previousAuthor
            ? { inscriptionText: author }
            : {}),
        });
      },
    });
    this.applyAuthorToDeckButton = new CanvasButton({
      label: '全套署名',
      icon: 'badge-check',
      tooltip: '将当前署名同步到整套卡牌、艺术铭文和创作者铭牌',
      variant: 'secondary',
      accent: COLORS.gold,
      onPress: () => this.applyAuthorToDeck(),
    });
    this.inscriptionStyleControl = new SegmentedControl<InscriptionStyle>({
      items: [
        { value: 'seal', label: '篆印', icon: 'stamp' },
        { value: 'signature', label: '手签', icon: 'pen-line' },
      ],
      value: this.currentCard.inscriptionStyle ?? 'seal',
      accent: COLORS.gold,
      onChange: (value) => this.updateCurrentCard({ inscriptionStyle: value }),
    });
    this.inscriptionPlacementControl = new SegmentedControl<InscriptionPlacement>({
      items: [
        { value: 'front', label: '卡面', icon: 'eye' },
        { value: 'back', label: '卡背', icon: 'layers' },
      ],
      value: this.currentCard.inscriptionPlacement ?? 'front',
      accent: MODE_BY_ID[this.deck.modeId].accent,
      onChange: (value) => {
        this.updateCurrentCard({ inscriptionPlacement: value });
        this.previewCard?.setFlipped(value === 'back');
      },
    });
    this.cardBackButton = new CanvasButton({
      label: '统一卡背',
      icon: 'layers',
      variant: 'secondary',
      tooltip: '重新生成并应用整套卡牌共用的卡背纹理',
      onPress: () => this.regenerateCardBack(),
    });
    const initialStyle = resolveArtStyle(this.deck.artStyleId);
    this.styleCategoryControl = new SegmentedControl<ArtStyleCategory>({
      items: [
        { value: 'eastern', label: '东方美学', icon: 'sparkles' },
        { value: 'global', label: '世界绘艺', icon: 'image' },
      ],
      value: initialStyle.category,
      accent: initialStyle.palette.accent,
      onChange: (category) => {
        const first = artStylesForCategory(category)[0];
        if (first) this.selectArtStyle(first.id);
      },
    });
    this.stylePreviousButton = new CanvasButton({
      label: '',
      icon: 'arrow-left',
      iconOnly: true,
      tooltip: '上一种美术风格',
      onPress: () => this.cycleArtStyle(-1),
    });
    this.styleNextButton = new CanvasButton({
      label: '',
      icon: 'arrow-right',
      iconOnly: true,
      tooltip: '下一种美术风格',
      onPress: () => this.cycleArtStyle(1),
    });
    this.styleSelectButton = new CanvasButton({
      label: initialStyle.name,
      icon: 'sparkles',
      variant: 'secondary',
      accent: initialStyle.palette.accent,
      onPress: () => this.cycleArtStyle(1),
    });
    this.regenerateArtworkButton = new CanvasButton({
      label: '重绘此卡',
      icon: 'refresh-cw',
      variant: 'secondary',
      accent: initialStyle.palette.accent,
      tooltip: '仅重绘当前卡牌插画，并自动保留为新版本',
      onPress: () => void this.regenerateCurrentArtwork(),
    });
    this.styleSample.setStyle(initialStyle);
    this.styleSample.on('pointertap', () => this.cycleArtStyle(1));
    attachInteractionHint(
      this.styleSample,
      () => `点击切换美术风格，当前为${this.currentArtStyle.name}`,
    );
    this.exchangeButton = new CanvasButton({
      label: '前往交换站',
      icon: 'network',
      variant: 'primary',
      accent: COLORS.gold,
      onPress: () => options.onExchange(),
    });
    this.stripPreviousButton = new CanvasButton({
      label: '',
      icon: 'arrow-left',
      iconOnly: true,
      tooltip: '上一张卡牌',
      onPress: () => this.selectCard(this.selectedIndex - 1),
    });
    this.stripNextButton = new CanvasButton({
      label: '',
      icon: 'arrow-right',
      iconOnly: true,
      tooltip: '下一张卡牌',
      onPress: () => this.selectCard(this.selectedIndex + 1),
    });

    this.previewCard = new CardView(this.currentCard, 312)
      .setArtStyle(this.currentArtStyle.id)
      .setGameplayContext(this.deck.ruleKit?.modules)
      .setFoilIntensity(0.95)
      .setBackDesign(this.deck.cardBack, this.deck.name)
      .setAbilityPopoverEnabled(true)
      .setFlipOnTap(true);
    attachInteractionHint(
      this.previewCard,
      () => this.previewCard.isFlipped()
        ? '点击翻到卡面'
        : '点击翻到卡背，悬停查看完整能力',
    );
    this.previewCard.on('flipchange', (flipped: boolean) => this.updatePreviewFlipLabel(flipped));
    this.previewTag.eventMode = 'static';
    this.previewTag.cursor = 'pointer';
    this.previewTag.alpha = 0.9;
    this.previewTag.on('pointerover', () => {
      this.previewTag.alpha = 1;
    });
    this.previewTag.on('pointerout', () => {
      this.previewTag.alpha = 0.9;
    });
    this.previewTag.on('pointertap', () => this.previewCard.toggleFlipped());
    attachInteractionHint(
      this.previewTag,
      () => this.previewCard.isFlipped() ? '翻到卡牌正面' : '翻到统一卡背',
    );
    this.previewTag.addChild(this.previewTagBg, this.previewTagIcon, this.previewTagText);
    this.loading.addChild(
      this.loadingBg,
      this.loadingRing,
      this.loadingIcon,
      this.loadingText,
      this.loadingCardProgress,
    );
    this.loadingCardProgress.visible = false;
    this.loading.visible = false;
    this.editor.addChild(
      this.editorTitle,
      this.editorKicker,
      this.contentPolicyButton,
      this.themeInput,
      this.generateButton,
      this.presetControl,
      this.tabControl,
      this.attackSlider,
      this.defenseSlider,
      this.foilToggle,
      this.skillInput,
      this.authorInput,
      this.applyAuthorToDeckButton,
      this.inscriptionStyleControl,
      this.inscriptionPlacementControl,
      this.cardBackButton,
      this.styleCategoryControl,
      this.styleSample,
      this.stylePreviousButton,
      this.styleSelectButton,
      this.styleNextButton,
    );
    this.detailPanel.addChild(
      this.infoKicker,
      this.deckNameText,
      this.deckThemeText,
      this.storyText,
      this.rulesText,
      this.metaText,
      this.exchangeButton,
    );
    this.deckStrip.addChild(
      this.deckStripBg,
      this.deckStripLabel,
      this.stripPreviousButton,
      this.stripNextButton,
    );

    this.toast = new ToastLayer();
    this.addChild(
      this.leftBand,
      this.rightBand,
      this.workspaceLines,
      this.previewHalo,
      this.editor,
      this.detailPanel,
      this.deckStrip,
      this.previewCard,
      this.regenerateArtworkButton,
      this.previewTag,
      this.loading,
      this.chrome,
      this.toast,
    );

    this.rebuildStrip();
    this.syncArtStyleControls();
    this.updateInfo();
    this.updateEditorVisibility();
    Ticker.shared.add(this.tick);
  }

  private get currentCard(): CardData {
    return this.deck.cards[Math.min(this.selectedIndex, this.deck.cards.length - 1)];
  }

  private get currentArtStyle(): ReturnType<typeof resolveArtStyle> {
    return resolveArtStyle(this.deck.artStyleId);
  }

  private get composition(): NonNullable<DeckData['composition']> {
    return resolveDeckComposition(this.deck);
  }

  layout(viewport: Viewport): void {
    this.viewport = viewport;
    const { width, height, phone } = viewport;
    this.chrome.layout(viewport);
    this.toast.setSize(width, height);
    this.workspaceLines.clear();
    this.previewHalo.clear();

    if (isStudioLowHeightLandscape(viewport)) this.layoutLowHeightLandscape(viewport);
    else if (phone) this.layoutPhone(viewport);
    else this.layoutDesktop(viewport);
    this.updateEditorVisibility();
    this.showCompositionNoticeOnce();
  }

  private layoutDesktop(viewport: Viewport): void {
    const { width, height } = viewport;
    const top = 64;
    const bottom = height < 760 ? 92 : 108;
    const left = width < 1180 ? 280 : 304;
    const right = width < 1180 ? 292 : 326;
    const centerWidth = width - left - right;
    const centerHeight = height - top - bottom;
    const artUi = getArtStyleUiTheme(this.deck.artStyleId);

    this.leftBand
      .clear()
      .rect(0, top, left, height - top)
      .fill({ color: artUi.panel, alpha: 0.93 })
      .moveTo(left, top)
      .lineTo(left, height)
      .stroke({ color: COLORS.line, width: 1 });
    this.rightBand
      .clear()
      .rect(width - right, top, right, height - top)
      .fill({ color: artUi.panel, alpha: 0.9 })
      .moveTo(width - right, top)
      .lineTo(width - right, height)
      .stroke({ color: COLORS.line, width: 1 });
    this.workspaceLines
      .moveTo(left + centerWidth / 2, top + 24)
      .lineTo(left + centerWidth / 2, height - bottom - 24)
      .stroke({ color: COLORS.paper, width: 0.7, alpha: 0.04 });

    this.editor.visible = true;
    this.editor.position.set(16, top + 18);
    this.editorTitle.visible = true;
    this.editorKicker.visible = true;
    this.editorTitle.style.fontSize = 24;
    this.editorTitle.position.set(0, 0);
    this.editorKicker.position.set(1, 31);
    const controlWidth = left - 32;
    this.contentPolicyButton.setIconOnly(false);
    this.contentPolicyButton.position.set(controlWidth - 116, 2);
    this.contentPolicyButton.setSize(116, 32);
    this.themeInput.position.set(0, 58);
    this.themeInput.setSize(controlWidth, 64);
    this.presetControl.visible = height >= 760;
    this.presetControl.position.set(0, 132);
    this.presetControl.setSize(controlWidth, 34);
    const generateY = this.presetControl.visible ? 178 : 136;
    this.generateButton.position.set(0, generateY);
    this.generateButton.setLabel(this.generateButtonLabel(false));
    this.generateButton.setSize(controlWidth, 44);
    this.tabControl.position.set(0, generateY + 58);
    this.tabControl.setSize(controlWidth, 38);
    const fieldY = generateY + 112;
    this.attackSlider.position.set(0, fieldY);
    this.attackSlider.setSize(controlWidth, 44);
    this.defenseSlider.position.set(0, fieldY + 57);
    this.defenseSlider.setSize(controlWidth, 44);
    this.foilToggle.position.set(0, fieldY + 118);
    this.foilToggle.setSize(controlWidth, 40);
    this.skillInput.position.set(0, fieldY);
    this.skillInput.setSize(controlWidth, Math.min(126, height - fieldY - top - bottom - 36));
    this.authorInput.position.set(0, fieldY);
    this.authorInput.setSize(controlWidth, 58);
    this.inscriptionStyleControl.position.set(0, fieldY + 68);
    this.inscriptionStyleControl.setSize(controlWidth, 34);
    this.inscriptionPlacementControl.position.set(0, fieldY + 108);
    this.inscriptionPlacementControl.setSize(controlWidth, 34);
    const markActionWidth = (controlWidth - 8) / 2;
    this.applyAuthorToDeckButton.position.set(0, fieldY + 148);
    this.applyAuthorToDeckButton.setSize(markActionWidth, 40);
    this.cardBackButton.position.set(markActionWidth + 8, fieldY + 148);
    this.cardBackButton.setSize(markActionWidth, 40);
    this.styleCategoryControl.position.set(0, fieldY);
    this.styleCategoryControl.setSize(controlWidth, 34);
    this.styleSample.position.set(0, fieldY + 42);
    this.styleSample.setSize(controlWidth, 112);
    this.stylePreviousButton.position.set(0, fieldY + 162);
    this.stylePreviousButton.setSize(38, 38);
    this.styleSelectButton.position.set(46, fieldY + 162);
    this.styleSelectButton.setSize(controlWidth - 92, 38);
    this.styleNextButton.position.set(controlWidth - 38, fieldY + 162);
    this.styleNextButton.setSize(38, 38);

    const previewWidth = Math.min(332, Math.max(226, centerWidth * 0.43), centerHeight / (88 / 63) - 46);
    const previewX = left + centerWidth / 2;
    const previewY = top + centerHeight / 2 - 4;
    this.previewCard.setSize(previewWidth);
    this.previewCard.position.set(previewX, previewY);
    this.previewCard.visible = true;
    this.previewHalo
      .circle(previewX, previewY, previewWidth * 0.78)
      .stroke({ color: artUi.accent, width: 1, alpha: 0.18 })
      .circle(previewX, previewY, previewWidth * 0.62)
      .stroke({ color: COLORS.gold, width: 0.8, alpha: 0.1 });
    const previewActionY = previewY - previewWidth * (88 / 63) * 0.5 - 34;
    this.regenerateArtworkButton.setLabel('重绘此卡');
    this.regenerateArtworkButton.setSize(Math.min(116, previewWidth * 0.48), 28);
    this.regenerateArtworkButton.position.set(previewX - previewWidth * 0.5, previewActionY - 1);
    this.layoutPreviewTag(previewX + previewWidth * 0.5 - 90, previewActionY);

    this.detailPanel.visible = true;
    this.detailPanel.position.set(width - right + 22, top + 23);
    const textWidth = right - 44;
    this.layoutDetailPanel(textWidth, height - top - bottom - 30);

    this.deckStrip.visible = true;
    this.deckStrip.position.set(left, height - bottom);
    this.layoutDeckStrip(centerWidth, bottom, false);
    this.layoutLoading(previewX, previewY, Math.min(270, previewWidth * 0.88));
  }

  private layoutLowHeightLandscape(viewport: Viewport): void {
    const geometry = getStudioLowHeightLandscapeLayout(viewport);
    const artUi = getArtStyleUiTheme(this.deck.artStyleId);
    const { editorPanel, editorContent, previewCard, deckStrip } = geometry;

    this.leftBand
      .clear()
      .roundRect(editorPanel.x, editorPanel.y, editorPanel.width, editorPanel.height, 6)
      .fill({ color: artUi.panel, alpha: 0.97 })
      .stroke({ color: COLORS.line, width: 1 });
    this.rightBand.clear();
    this.workspaceLines
      .moveTo(geometry.previewColumn.right + viewport.profile.gap / 2, geometry.content.y + 8)
      .lineTo(geometry.previewColumn.right + viewport.profile.gap / 2, geometry.content.bottom - 8)
      .stroke({ color: artUi.accent, width: 1, alpha: 0.18 });

    this.detailPanel.visible = false;
    this.editor.visible = true;
    this.editor.position.set(editorContent.x, editorContent.y);
    this.editorTitle.visible = false;
    this.editorKicker.visible = false;
    const localX = (x: number): number => x - editorContent.x;
    const localY = (y: number): number => y - editorContent.y;
    const controlWidth = editorContent.width;

    this.contentPolicyButton.setIconOnly(true);
    this.contentPolicyButton.position.set(
      localX(geometry.contentPolicyButton.x),
      localY(geometry.contentPolicyButton.y),
    );
    this.contentPolicyButton.setSize(
      geometry.contentPolicyButton.width,
      geometry.contentPolicyButton.height,
    );
    this.themeInput.position.set(localX(geometry.themeInput.x), localY(geometry.themeInput.y));
    this.themeInput.setSize(geometry.themeInput.width, geometry.themeInput.height);
    this.generateButton.position.set(
      localX(geometry.generateButton.x),
      localY(geometry.generateButton.y),
    );
    this.generateButton.setLabel(this.generateButtonLabel(true));
    this.generateButton.setSize(geometry.generateButton.width, geometry.generateButton.height);
    this.presetControl.visible = false;
    this.tabControl.position.set(localX(geometry.tabs.x), localY(geometry.tabs.y));
    this.tabControl.setSize(geometry.tabs.width, geometry.tabs.height);

    const fieldY = localY(geometry.fields.y);
    const fieldHeight = Math.min(38, Math.max(32, geometry.fields.height * 0.25));
    this.attackSlider.position.set(0, fieldY);
    this.attackSlider.setSize(controlWidth, fieldHeight);
    this.defenseSlider.position.set(0, fieldY + fieldHeight + 8);
    this.defenseSlider.setSize(controlWidth, fieldHeight);
    this.foilToggle.position.set(0, fieldY + (fieldHeight + 8) * 2);
    this.foilToggle.setSize(controlWidth, Math.min(36, fieldHeight));
    this.skillInput.position.set(0, fieldY);
    this.skillInput.setSize(controlWidth, Math.min(108, geometry.fields.height));

    this.authorInput.position.set(
      localX(geometry.markAuthor.x),
      localY(geometry.markAuthor.y),
    );
    this.authorInput.setSize(geometry.markAuthor.width, geometry.markAuthor.height);
    this.inscriptionStyleControl.position.set(
      localX(geometry.markStyle.x),
      localY(geometry.markStyle.y),
    );
    this.inscriptionStyleControl.setSize(geometry.markStyle.width, geometry.markStyle.height);
    this.inscriptionPlacementControl.position.set(
      localX(geometry.markPlacement.x),
      localY(geometry.markPlacement.y),
    );
    this.inscriptionPlacementControl.setSize(
      geometry.markPlacement.width,
      geometry.markPlacement.height,
    );
    const compactMarkActionWidth = (geometry.markCardBackButton.width - 6) / 2;
    this.applyAuthorToDeckButton.position.set(
      localX(geometry.markCardBackButton.x),
      localY(geometry.markCardBackButton.y),
    );
    this.applyAuthorToDeckButton.setSize(
      compactMarkActionWidth,
      geometry.markCardBackButton.height,
    );
    this.cardBackButton.position.set(
      localX(geometry.markCardBackButton.x) + compactMarkActionWidth + 6,
      localY(geometry.markCardBackButton.y),
    );
    this.cardBackButton.setSize(
      compactMarkActionWidth,
      geometry.markCardBackButton.height,
    );

    this.styleCategoryControl.position.set(0, fieldY);
    this.styleCategoryControl.setSize(controlWidth, 32);
    const styleSelectorY = editorContent.height - 32;
    const styleSampleY = fieldY + 38;
    const styleSampleHeight = Math.max(60, styleSelectorY - styleSampleY - 6);
    this.styleSample.position.set(0, styleSampleY);
    this.styleSample.setSize(controlWidth, styleSampleHeight);
    this.stylePreviousButton.position.set(0, styleSelectorY);
    this.stylePreviousButton.setSize(32, 32);
    this.styleSelectButton.position.set(38, styleSelectorY);
    this.styleSelectButton.setSize(controlWidth - 76, 32);
    this.styleNextButton.position.set(controlWidth - 32, styleSelectorY);
    this.styleNextButton.setSize(32, 32);

    const previewX = previewCard.x + previewCard.width / 2;
    const previewY = previewCard.y + previewCard.height / 2;
    this.previewCard.setSize(previewCard.width);
    this.previewCard.position.set(previewX, previewY);
    this.previewCard.visible = true;
    this.previewHalo
      .circle(previewX, previewY, previewCard.width * 0.76)
      .stroke({ color: artUi.accent, width: 1, alpha: 0.2 })
      .circle(previewX, previewY, previewCard.width * 0.6)
      .stroke({ color: COLORS.gold, width: 0.8, alpha: 0.1 });
    this.regenerateArtworkButton.setLabel('重绘卡面');
    this.regenerateArtworkButton.setSize(
      geometry.regenerateButton.width,
      geometry.regenerateButton.height,
    );
    this.regenerateArtworkButton.position.set(
      geometry.regenerateButton.x,
      geometry.regenerateButton.y,
    );
    this.layoutPreviewTag(geometry.previewTag.x, geometry.previewTag.y);

    this.deckStrip.visible = true;
    this.deckStrip.position.set(deckStrip.x, deckStrip.y);
    this.layoutDeckStrip(deckStrip.width, deckStrip.height, true);
    this.layoutLoading(previewX, previewY, Math.min(230, geometry.previewColumn.width - 32));
  }

  private layoutPhone(viewport: Viewport): void {
    const { width, height } = viewport;
    const top = 56;
    const controlHeight = Math.min(310, Math.max(268, height * 0.39));
    const controlTop = height - controlHeight;
    const stripHeight = 66;
    const previewAreaHeight = controlTop - top - stripHeight;
    const artUi = getArtStyleUiTheme(this.deck.artStyleId);

    this.leftBand
      .clear()
      .rect(0, controlTop, width, controlHeight)
      .fill({ color: artUi.panel, alpha: 0.98 })
      .moveTo(0, controlTop)
      .lineTo(width, controlTop)
      .stroke({ color: COLORS.line, width: 1 });
    this.rightBand.clear();
    this.detailPanel.visible = false;

    const previewWidth = Math.min(width * 0.46, previewAreaHeight / (88 / 63) - 18, 196);
    const previewX = width / 2;
    const previewY = top + previewAreaHeight / 2 + 3;
    this.previewCard.setSize(Math.max(112, previewWidth));
    this.previewCard.position.set(previewX, previewY);
    this.previewCard.visible = true;
    this.previewHalo
      .circle(previewX, previewY, previewWidth * 0.72)
      .stroke({ color: artUi.accent, width: 1, alpha: 0.2 });
    this.regenerateArtworkButton.setLabel('重绘卡面');
    this.regenerateArtworkButton.setSize(104, 28);
    this.regenerateArtworkButton.position.set(14, top + 10);
    this.layoutPreviewTag(width - 108, top + 11);

    this.deckStrip.visible = true;
    this.deckStrip.position.set(0, controlTop - stripHeight);
    this.layoutDeckStrip(width, stripHeight, true);

    this.editor.visible = true;
    this.editor.position.set(14, controlTop + 10);
    this.editorTitle.visible = false;
    this.editorKicker.visible = false;
    const controlWidth = width - 28;
    this.contentPolicyButton.setIconOnly(true);
    this.contentPolicyButton.position.set(controlWidth - 140, 18);
    this.contentPolicyButton.setSize(40, 40);
    this.themeInput.position.set(0, 0);
    this.themeInput.setSize(controlWidth - 148, 58);
    this.generateButton.position.set(controlWidth - 94, 18);
    this.generateButton.setLabel(this.generateButtonLabel(true));
    this.generateButton.setSize(94, 40);
    this.presetControl.visible = false;
    this.tabControl.position.set(0, 70);
    this.tabControl.setSize(controlWidth, 38);
    const fieldY = 122;
    this.attackSlider.position.set(0, fieldY);
    this.attackSlider.setSize(controlWidth, 42);
    this.defenseSlider.position.set(0, fieldY + 52);
    this.defenseSlider.setSize(controlWidth, 42);
    this.foilToggle.position.set(0, fieldY + 105);
    this.foilToggle.setSize(controlWidth, 38);
    this.skillInput.position.set(0, fieldY);
    this.skillInput.setSize(controlWidth, 116);
    this.authorInput.position.set(0, fieldY);
    this.authorInput.setSize(controlWidth, 54);
    this.inscriptionStyleControl.position.set(0, fieldY + 58);
    this.inscriptionStyleControl.setSize(controlWidth, 34);
    this.inscriptionPlacementControl.position.set(0, fieldY + 96);
    this.inscriptionPlacementControl.setSize(controlWidth, 34);
    const phoneMarkActionWidth = (controlWidth - 6) / 2;
    this.applyAuthorToDeckButton.position.set(0, fieldY + 134);
    this.applyAuthorToDeckButton.setSize(phoneMarkActionWidth, 36);
    this.cardBackButton.position.set(phoneMarkActionWidth + 6, fieldY + 134);
    this.cardBackButton.setSize(phoneMarkActionWidth, 36);
    this.styleCategoryControl.position.set(0, fieldY);
    this.styleCategoryControl.setSize(controlWidth, 32);
    const styleSelectorY = controlHeight - 42;
    const styleSampleHeight = Math.max(60, styleSelectorY - fieldY - 44);
    this.styleSample.position.set(0, fieldY + 38);
    this.styleSample.setSize(controlWidth, styleSampleHeight);
    this.stylePreviousButton.position.set(0, styleSelectorY);
    this.stylePreviousButton.setSize(32, 32);
    this.styleSelectButton.position.set(38, styleSelectorY);
    this.styleSelectButton.setSize(controlWidth - 76, 32);
    this.styleNextButton.position.set(controlWidth - 32, styleSelectorY);
    this.styleNextButton.setSize(32, 32);
    this.layoutLoading(previewX, previewY, Math.min(250, width - 60));
  }

  private layoutDetailPanel(width: number, availableHeight: number): void {
    const artUi = getArtStyleUiTheme(this.deck.artStyleId);
    this.syncDetailText();
    this.infoKicker.position.set(0, 0);
    this.deckNameText.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 23,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width,
      lineHeight: 29,
    });
    this.deckNameText.position.set(0, 23);
    fitTextHeight(this.deckNameText, this.deck.name || '未命名套牌', 58);

    this.deckThemeText.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 11,
      fontWeight: '600',
      fill: artUi.accent,
      letterSpacing: 0,
      lineHeight: 17,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width,
    });
    this.deckThemeText.position.set(0, 23 + this.deckNameText.height + 8);
    fitTextHeight(
      this.deckThemeText,
      `${MODE_BY_ID[this.deck.modeId].name}  /  ${this.deck.theme}  /  ${this.currentArtStyle.name}`,
      34,
    );

    this.storyText.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 13,
      fontWeight: '400',
      fill: COLORS.paperMuted,
      letterSpacing: 0,
      lineHeight: 21,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width,
    });
    this.rulesText.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 12,
      fontWeight: '600',
      fill: COLORS.paper,
      letterSpacing: 0,
      lineHeight: 20,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width,
    });
    this.metaText.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '500',
      fill: COLORS.paperFaint,
      letterSpacing: 0,
      lineHeight: 17,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width,
    });

    this.exchangeButton.setSize(width, 42);
    const buttonY = availableHeight - 46;
    this.exchangeButton.position.set(0, buttonY);

    fitTextHeight(this.metaText, this.detailMeta(), 86);
    const metaY = buttonY - 16 - this.metaText.height;
    this.metaText.position.set(0, metaY);

    const storyY = this.deckThemeText.y + this.deckThemeText.height + 20;
    const contentBottom = metaY - 18;
    const contentHeight = Math.max(0, contentBottom - storyY);
    const contentGap = contentHeight >= 100 ? 18 : 10;
    const textBudget = Math.max(0, contentHeight - contentGap);

    this.storyText.text = this.deck.story || '暂无世界观设定。';
    const rules = renderDeckRules(this.deck) || '暂无规则说明。';
    this.rulesText.text = `玩法规则\n${rules}`;
    const fullStoryHeight = this.storyText.height;
    const fullRulesHeight = this.rulesText.height;
    let storyBudget = fullStoryHeight;
    if (fullStoryHeight + fullRulesHeight > textBudget) {
      const minimumStory = Math.min(fullStoryHeight, 63, textBudget);
      const minimumRules = Math.min(fullRulesHeight, 60, Math.max(0, textBudget - minimumStory));
      const desiredStory =
        textBudget >= minimumStory + minimumRules
          ? Math.max(minimumStory, Math.min(textBudget - minimumRules, textBudget * 0.46))
          : textBudget * 0.46;
      if (fullStoryHeight <= desiredStory) storyBudget = fullStoryHeight;
      else if (fullRulesHeight <= textBudget - desiredStory) {
        storyBudget = textBudget - fullRulesHeight;
      } else storyBudget = desiredStory;
      storyBudget = Math.max(0, Math.min(fullStoryHeight, textBudget, storyBudget));
    }

    this.storyText.position.set(0, storyY);
    fitTextHeight(this.storyText, this.deck.story || '暂无世界观设定。', Math.max(0, storyBudget));
    const rulesY = storyY + this.storyText.height + contentGap;
    this.rulesText.position.set(0, rulesY);
    fitTextHeight(
      this.rulesText,
      `玩法规则\n${rules}`,
      Math.max(0, contentBottom - rulesY),
    );
  }

  private layoutDeckStrip(width: number, height: number, compact: boolean): void {
    this.deckStripBg
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: COLORS.inkSoft, alpha: 0.95 })
      .moveTo(0, 0)
      .lineTo(width, 0)
      .stroke({ color: COLORS.line, width: 1 });
    const navSize = compact ? 28 : 32;
    const sideInset = compact ? 8 : 12;
    const cardWidth = compact ? 38 : Math.min(54, height * 0.5);
    const gap = compact ? 8 : 12;
    const availableWidth = Math.max(120, width - (sideInset + navSize + 12) * 2);
    const nextCapacity = Math.max(
      3,
      Math.min(compact ? 5 : 8, Math.floor((availableWidth + gap) / (cardWidth + gap))),
    );
    if (nextCapacity !== this.stripCapacity) {
      this.stripCapacity = nextCapacity;
      this.rebuildStrip(false);
    }

    const labelX = sideInset + navSize + 12;
    const labelRight = width - sideInset - navSize - 12;
    fitSingleLineWidth(
      this.deckStripLabel,
      this.deckCountLabel(compact),
      Math.max(96, labelRight - labelX),
      compact ? 9 : 10,
      compact ? 7.2 : 8,
    );
    this.deckStripLabel.visible = true;
    this.deckStripLabel.position.set(labelX, compact ? 3 : 11);

    const navY = (height - navSize) / 2;
    this.stripPreviousButton.position.set(sideInset, navY);
    this.stripPreviousButton.setSize(navSize, navSize);
    this.stripPreviousButton.setDisabled(this.selectedIndex <= 0);
    this.stripNextButton.position.set(width - sideInset - navSize, navY);
    this.stripNextButton.setSize(navSize, navSize);
    this.stripNextButton.setDisabled(this.selectedIndex >= this.deck.cards.length - 1);

    const total = this.stripCards.length * cardWidth + Math.max(0, this.stripCards.length - 1) * gap;
    const cardsLeft = sideInset + navSize + 10;
    const cardsRight = width - sideInset - navSize - 10;
    const startX = cardsLeft + Math.max(0, (cardsRight - cardsLeft - total) / 2);
    const centerY = compact ? height * 0.59 : height * 0.64;
    this.stripCards.forEach((card, visibleIndex) => {
      const actualIndex = this.stripCardIndices[visibleIndex];
      const selected = actualIndex === this.selectedIndex;
      card.setSize(72);
      card.position.set(startX + cardWidth / 2 + visibleIndex * (cardWidth + gap), centerY);
      card.alpha = selected ? 1 : 0.54;
      card.scale.set((cardWidth / 72) * (selected ? 1.08 : 1));
    });
  }

  private layoutPreviewTag(x: number, y: number): void {
    const artUi = getArtStyleUiTheme(this.deck.artStyleId);
    this.previewTag.position.set(x, y);
    this.previewTagBg
      .clear()
      .roundRect(0, 0, 90, 26, 7)
      .fill({ color: artUi.panelRaised, alpha: 0.92 })
      .stroke({ color: artUi.accent, width: 1, alpha: 0.48 });
    this.previewTagIcon.setColor(artUi.accent);
    this.previewTagText.style.fill = artUi.accent;
    this.previewTagIcon.position.set(10, 5);
    this.previewTagText.position.set(32, 7);
    this.previewTag.hitArea = new Rectangle(0, 0, 90, 26);
  }

  private updatePreviewFlipLabel(flipped: boolean): void {
    this.previewTagText.text = flipped ? '翻到卡面' : '翻到卡背';
    this.previewTagIcon.setIcon(flipped ? 'eye' : 'rotate-3d');
  }

  private layoutLoading(x: number, y: number, width: number): void {
    this.loadingGeometry = { x, y, width };
    const showsDeckProgress = this.loadingCardProgress.visible;
    const height = showsDeckProgress ? 132 : 86;
    const headerY = showsDeckProgress ? 28 : height / 2;
    const artUi = getArtStyleUiTheme(this.deck.artStyleId);
    this.loading.position.set(x - width / 2, y - height / 2);
    this.loadingBg
      .clear()
      .roundRect(0, 0, width, height, 8)
      .fill({ color: COLORS.inkSoft, alpha: 0.97 })
      .stroke({ color: artUi.accent, width: 1, alpha: 0.65 });
    this.loadingRing
      .clear()
      .circle(0, 0, 19)
      .stroke({ color: COLORS.gold, width: 2, alpha: 0.85 })
      .arc(0, 0, 19, -0.4, 1.25)
      .stroke({ color: COLORS.jade, width: 4, alpha: 1 });
    this.loadingRing.position.set(38, headerY);
    this.loadingIcon.anchor.set(0.5);
    this.loadingIcon.position.set(38, headerY);
    this.loadingText.style.fontSize = 11;
    this.loadingText.style.lineHeight = 16;
    this.loadingText.style.wordWrap = true;
    this.loadingText.style.breakWords = true;
    this.loadingText.style.wordWrapWidth = Math.max(80, width - 84);
    this.loadingText.position.set(72, headerY - this.loadingText.height / 2);
    this.drawDeckGenerationProgress(width);
  }

  private drawDeckGenerationProgress(panelWidth: number): void {
    const progress = this.deckGenerationProgress;
    this.loadingCardProgress.clear();
    if (!progress || progress.total <= 0) return;

    const total = Math.max(1, progress.total);
    const rows = total > 48 ? 4 : total > 24 ? 3 : total > 12 ? 2 : 1;
    const columns = Math.ceil(total / rows);
    const gap = panelWidth < 250 ? 1.5 : 2;
    const availableWidth = Math.max(80, panelWidth - 88);
    const cardWidth = Math.max(
      3.5,
      Math.min(9, (availableWidth - gap * (columns - 1)) / columns),
    );
    const cardHeight = cardWidth * 1.42;
    const gridWidth = columns * cardWidth + (columns - 1) * gap;
    const gridHeight = rows * cardHeight + (rows - 1) * gap;
    const startX = 72 + Math.max(0, (availableWidth - gridWidth) / 2);
    const startY = 58 + Math.max(0, (64 - gridHeight) / 2);
    const completed = Math.max(0, Math.min(total, progress.completed));
    const active = progress.phase === 'complete' || progress.phase === 'failed'
      ? -1
      : progress.cardIndex ?? Math.min(completed, total - 1);
    const failedIndices = new Set(progress.failedIndices ?? []);
    const accent = getArtStyleUiTheme(this.deck.artStyleId).accent;

    for (let index = 0; index < total; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cardX = startX + column * (cardWidth + gap);
      const cardY = startY + row * (cardHeight + gap);
      const ready = index < completed;
      const failed = failedIndices.has(index);
      const fillColor = failed ? COLORS.danger : ready ? accent : COLORS.ink;
      const statusStroke = index === active
        ? COLORS.gold
        : ready
          ? COLORS.paperMuted
          : COLORS.paperFaint;
      this.loadingCardProgress
        .roundRect(cardX, cardY, cardWidth, cardHeight, Math.min(1.5, cardWidth * 0.2))
        .fill({
          color: fillColor,
          alpha: failed ? 0.9 : ready ? 0.82 : 0.58,
        })
        .stroke({
          color: failed ? COLORS.paper : statusStroke,
          width: failed || index === active ? 1.25 : 0.65,
          alpha: failed || index === active ? 1 : ready ? 0.68 : 0.24,
        });
      if (ready && cardWidth >= 5) {
        this.loadingCardProgress
          .roundRect(
            cardX + cardWidth * 0.18,
            cardY + cardHeight * 0.16,
            cardWidth * 0.64,
            cardHeight * 0.5,
            Math.min(1, cardWidth * 0.12),
          )
          .fill({ color: COLORS.gold, alpha: 0.55 });
      }
      const centerX = cardX + cardWidth / 2;
      const centerY = cardY + cardHeight * 0.82;
      const markSize = Math.max(1.3, cardWidth * 0.24);
      if (failed) {
        this.loadingCardProgress
          .moveTo(centerX - markSize, centerY - markSize)
          .lineTo(centerX + markSize, centerY + markSize)
          .moveTo(centerX + markSize, centerY - markSize)
          .lineTo(centerX - markSize, centerY + markSize)
          .stroke({ color: COLORS.paper, width: Math.max(0.65, cardWidth * 0.12), alpha: 0.96 });
      } else if (ready) {
        this.loadingCardProgress
          .circle(centerX, centerY, markSize * 0.74)
          .fill({ color: COLORS.ink, alpha: 0.72 })
          .stroke({ color: COLORS.paper, width: Math.max(0.5, cardWidth * 0.08), alpha: 0.78 });
      }
    }
  }

  private updateDeckGenerationProgress(progress: DeckGenerationProgress): void {
    const wasVisible = this.loadingCardProgress.visible;
    const previousCompleted = this.deckGenerationProgress?.completed ?? 0;
    this.deckGenerationProgress = progress;
    if (progress.phase === 'optimizing' && progress.streamedCard && progress.completed > previousCompleted) {
      dispatchAudioCue('card-created');
    } else if (!progress.streamedCard && progress.phase === 'optimizing' && progress.completed > previousCompleted) {
      const newlyCompleted = Math.min(progress.total, progress.completed) - previousCompleted;
      for (let index = 0; index < newlyCompleted; index += 1) {
        dispatchAudioCue('card-created');
      }
    }
    this.loadingCardProgress.visible = true;
    if (!wasVisible && this.loadingGeometry) {
      const { x, y, width } = this.loadingGeometry;
      this.layoutLoading(x, y, width);
      return;
    }
    this.drawDeckGenerationProgress(this.loadingGeometry?.width ?? 250);
  }

  private clearDeckGenerationProgress(relayout = false): void {
    const wasVisible = this.loadingCardProgress.visible;
    this.deckGenerationProgress = null;
    this.loadingCardProgress.visible = false;
    this.loadingCardProgress.clear();
    if (relayout && wasVisible && this.loadingGeometry) {
      const { x, y, width } = this.loadingGeometry;
      this.layoutLoading(x, y, width);
    }
  }

  private updateEditorVisibility(): void {
    const stats = this.editorTab === 'stats';
    this.attackSlider.visible = stats;
    this.defenseSlider.visible = stats;
    this.foilToggle.visible = stats;
    this.skillInput.visible = this.editorTab === 'skill';
    this.authorInput.visible = this.editorTab === 'mark';
    this.applyAuthorToDeckButton.visible = this.editorTab === 'mark';
    this.inscriptionStyleControl.visible = this.editorTab === 'mark';
    this.inscriptionPlacementControl.visible = this.editorTab === 'mark';
    this.cardBackButton.visible = this.editorTab === 'mark';
    const style = this.editorTab === 'style';
    this.styleCategoryControl.visible = style;
    this.styleSample.visible = style;
    this.stylePreviousButton.visible = style;
    this.styleSelectButton.visible = style;
    this.styleNextButton.visible = style;
  }

  private syncArtStyleControls(): void {
    const preset = this.currentArtStyle;
    const categoryStyles = artStylesForCategory(preset.category);
    const index = Math.max(0, categoryStyles.findIndex((candidate) => candidate.id === preset.id));
    const uiTheme = getArtStyleUiTheme(preset.id);
    this.styleCategoryControl.setValue(preset.category);
    this.styleSample.setStyle(preset);
    this.styleSelectButton.setLabel(`${preset.name} · ${index + 1}/${categoryStyles.length}`);
    this.styleSelectButton.setVariant('secondary', uiTheme.accent);
    this.stylePreviousButton.setVariant('ghost', uiTheme.accent);
    this.styleNextButton.setVariant('ghost', uiTheme.accent);
    this.regenerateArtworkButton.setVariant('secondary', uiTheme.accent);
    this.editorKicker.style.fill = uiTheme.accent;
    this.infoKicker.style.fill = uiTheme.accent;
  }

  private selectArtStyle(styleId: ArtStyleId): void {
    const preset = resolveArtStyle(styleId);
    const changed = this.deck.artStyleId !== preset.id;
    this.deck = { ...this.deck, artStyleId: preset.id };
    this.previewCard.setArtStyle(preset.id);
    this.stripCards.forEach((card) => card.setArtStyle(preset.id));
    this.syncArtStyleControls();
    this.updateInfo();
    if (changed) {
      this.deck = this.onDeckChange(this.deck);
      announce(`已切换为${preset.name}风格`);
    }
  }

  private cycleArtStyle(direction: -1 | 1): void {
    const current = this.currentArtStyle;
    const styles = artStylesForCategory(current.category);
    const currentIndex = Math.max(0, styles.findIndex((preset) => preset.id === current.id));
    const nextIndex = (currentIndex + direction + styles.length) % styles.length;
    const next = styles[nextIndex];
    if (next) this.selectArtStyle(next.id);
  }

  private updateCurrentCard(patch: Partial<CardData>): void {
    const updated = { ...this.currentCard, ...patch };
    if (patch.attack !== undefined || patch.defense !== undefined) {
      updated.cost = Math.max(1, Math.min(9, Math.ceil((updated.attack + updated.defense) / 18)));
    }
    this.deck = {
      ...this.deck,
      cards: this.deck.cards.map((card, index) => (index === this.selectedIndex ? updated : card)),
    };
    this.previewCard.setData(updated);
    this.previewCard.setBackDesign(this.deck.cardBack, this.deck.name);
    const thumbnailIndex = this.stripCardIndices.indexOf(this.selectedIndex);
    this.stripCards[thumbnailIndex]?.setData(updated);
    this.deck = this.onDeckChange(this.deck);
  }

  private applyAuthorToDeck(): void {
    const author = this.authorInput.value.trim() || '佚名';
    this.deck = this.onDeckChange(applyAuthorToEntireDeck(this.deck, author));
    this.authorInput.setValue(this.deck.author);
    this.previewCard.setData(this.currentCard);
    this.stripCards.forEach((card, index) => {
      const deckIndex = this.stripCardIndices[index];
      if (deckIndex !== undefined) card.setData(this.deck.cards[deckIndex]);
    });
    this.updateInfo();
    this.toast.success(`署名“${this.deck.author}”已同步到整套 ${this.deck.cards.length} 张卡牌。`);
    announce(`整套卡牌署名已更新为${this.deck.author}`);
  }

  private selectCard(index: number): void {
    if (index < 0 || index >= this.deck.cards.length) return;
    this.selectedIndex = index;
    if (!this.stripCardIndices.includes(index)) this.rebuildStrip(false);
    this.previewCard.setData(this.currentCard);
    this.attackSlider.setValue(this.currentCard.attack);
    this.defenseSlider.setValue(this.currentCard.defense);
    this.skillInput.setValue(this.currentCard.skill);
    this.authorInput.setValue(this.currentCard.author);
    this.inscriptionStyleControl.setValue(this.currentCard.inscriptionStyle ?? 'seal');
    this.inscriptionPlacementControl.setValue(this.currentCard.inscriptionPlacement ?? 'front');
    if (this.viewport) this.layout(this.viewport);
    announce(`已选择 ${this.currentCard.name}`);
  }

  private rebuildStrip(relayout = true): void {
    for (const card of this.stripCards) {
      this.deckStrip.removeChild(card);
      card.destroy();
    }
    const visibleCount = Math.min(this.stripCapacity, this.deck.cards.length);
    const maximumStart = Math.max(0, this.deck.cards.length - visibleCount);
    const start = Math.max(
      0,
      Math.min(maximumStart, this.selectedIndex - Math.floor(visibleCount / 2)),
    );
    this.stripCardIndices = Array.from({ length: visibleCount }, (_, index) => start + index);
    this.stripCards = this.stripCardIndices.map((cardIndex) => {
      const data = this.deck.cards[cardIndex];
      const card = new CardView(data, 56)
        .setArtStyle(this.currentArtStyle.id)
        .setGameplayContext(this.deck.ruleKit?.modules, 'thumbnail')
        .setMotionProfile('static');
      card.setInteractiveTilt(false);
      card.cursor = 'pointer';
      card.on('pointerover', () => {
        card.alpha = 1;
        card.rotation = -0.025;
      });
      card.on('pointerout', () => {
        card.alpha = cardIndex === this.selectedIndex ? 1 : 0.54;
        card.rotation = 0;
      });
      card.on('pointertap', () => this.selectCard(cardIndex));
      attachInteractionHint(card, () => `选择第 ${cardIndex + 1} 张《${data.name}》`);
      this.deckStrip.addChild(card);
      return card;
    });
    if (relayout && this.viewport) this.layout(this.viewport);
  }

  private detailMeta(): string {
    const revision = describeRevision(this.deck);
    const creationMode = resolveDeckCreationMode(this.deck) === 'fan-study'
      ? '个人同人研习'
      : '原创世界';
    const state = describeDeckComposition(this.deck);
    const sessionPlayers = state.composition.playSetup?.defaultPlayers;
    const sessionCount = state.composition.playSetup?.cardsInPlay.default
      ?? state.recommendedTotal;
    const currentLabel = state.composition.status === 'complete'
      ? `已完成 ${state.currentTotal} 张`
      : state.composition.status === 'sample'
        ? `当前仅 ${state.currentTotal} 张样卡（非完整牌组）`
        : state.remaining > 0
          ? `当前 ${state.currentTotal} 张 · 尚缺 ${state.remaining} 张`
          : `当前 ${state.currentTotal} 张 · 多出 ${state.excess} 张`;
    const playLabel = sessionPlayers
      ? `${sessionPlayers} 人标准局 ${sessionCount} 张`
      : `标准局 ${sessionCount} 张`;
    return `${revision.versionLabel}  ·  ${revision.reasonLabel}  ·  编号 ${this.deck.id}\n画风  ${this.currentArtStyle.name}\n完整配方  ${this.deckRecipeLabel()}\n数量  ${currentLabel}  ·  ${playLabel}\n${creationMode}  ·  作者 ${this.deck.author}`;
  }

  private deckRecipeLabel(): string {
    const composition = this.composition;
    const parts = composition.parts;
    const total = composition.recommendedTotal;
    const part = (id: string) => parts.find((candidate) => candidate.id === id)?.count ?? 0;

    if (part('match-card')) {
      const symbolsPerCard = composition.constraints.find(
        (constraint) => constraint.id === 'symbols-per-card',
      )?.description.match(/\d+/u)?.[0];
      return `${total} 张唯一同纹牌${symbolsPerCard ? ` · 每牌 ${symbolsPerCard} 纹` : ''}`;
    }
    if (part('pair-side-a') && part('pair-side-b')) {
      return `${part('pair-side-a')} 对互补牌 · 共 ${total} 张`;
    }
    const quantityParts = parts.filter((candidate) => candidate.id.startsWith('category-'));
    if (quantityParts.length && quantityParts.every((candidate) => candidate.count === quantityParts[0].count)) {
      return `${quantityParts.length} 类 × ${quantityParts[0].count} 张 · 共 ${total} 张`;
    }
    const expressionIds = ['living', 'object', 'place', 'action', 'concept'];
    if (expressionIds.every((id) => part(id) > 0)) {
      return `五类目标 ${expressionIds.map((id) => part(id)).join('/')} · 共 ${total} 张`;
    }
    if (part('hazard') && part('rescue')) {
      const functionCount = parts
        .filter((candidate) => candidate.id.startsWith('function-'))
        .reduce((sum, candidate) => sum + candidate.count, 0);
      return `功能 ${functionCount} + 危机 ${part('hazard')} + 护航 ${part('rescue')} = ${total} 张`;
    }

    const visibleParts = parts.slice(0, 3).map((candidate) => `${candidate.label} ${candidate.count}`);
    return `${visibleParts.join(' + ')}${parts.length > 3 ? ' + …' : ''} = ${total} 张`;
  }

  private deckCountLabel(compact: boolean): string {
    const state = describeDeckComposition(this.deck);
    const sessionCount = state.composition.playSetup?.cardsInPlay.default
      ?? state.recommendedTotal;
    const position = `${this.selectedIndex + 1}/${this.deck.cards.length}`;
    if (state.composition.status === 'complete') {
      return compact
        ? `完整${state.recommendedTotal}张 · 单局${sessionCount}张 · ${position}`
        : `完整牌组 ${state.recommendedTotal} 张 · 标准局 ${sessionCount} 张 · 第 ${position} 张`;
    }
    if (state.composition.status === 'sample') {
      return compact
        ? `样卡${state.currentTotal}张（非完整）· 完整需${state.recommendedTotal}张 · 缺${state.remaining}张`
        : `样卡 ${state.currentTotal} 张（非完整牌组） · 完整需 ${state.recommendedTotal} 张 · 标准局 ${sessionCount} 张 · 尚缺 ${state.remaining} 张`;
    }
    if (state.remaining > 0) {
      return compact
        ? `当前${state.currentTotal}张 · 完整需${state.recommendedTotal}张 · 缺${state.remaining}张`
        : `当前 ${state.currentTotal} 张 · 完整需 ${state.recommendedTotal} 张 · 标准局 ${sessionCount} 张 · 尚缺 ${state.remaining} 张`;
    }
    return compact
      ? `当前${state.currentTotal}张 · 完整需${state.recommendedTotal}张 · 多${state.excess}张`
      : `当前 ${state.currentTotal} 张 · 完整需 ${state.recommendedTotal} 张 · 标准局 ${sessionCount} 张 · 多出 ${state.excess} 张`;
  }

  private generateButtonLabel(compact: boolean): string {
    return compact
      ? `生成${this.composition.recommendedTotal}张`
      : `生成完整牌组 · ${this.composition.recommendedTotal}张`;
  }

  private showCompositionNoticeOnce(): void {
    if (this.compositionNoticeShown) return;
    const state = describeDeckComposition(this.deck);
    if (state.composition.status !== 'sample') return;
    this.compositionNoticeShown = true;
    this.toast.info(
      `当前展示的是 ${state.currentTotal} 张设计样卡，不是完整游戏牌组。本玩法完整需要 ${state.recommendedTotal} 张，生成后才可游玩与印刷。`,
      6200,
    );
  }

  private regenerateCardBack(): void {
    const seed = Math.floor(performance.now() * 1000) ^ Date.now();
    this.deck = {
      ...this.deck,
      cardBack: createCardBack(this.deck.modeId, this.deck.name, seed >>> 0),
    };
    this.previewCard.setBackDesign(this.deck.cardBack, this.deck.name).setFlipped(true);
    this.deck = this.onDeckChange(this.deck);
    this.toast.success('统一卡背已重铸并写入套牌。');
  }

  private syncDetailText(): void {
    this.deckNameText.text = this.deck.name;
    this.deckThemeText.text = `${MODE_BY_ID[this.deck.modeId].name}  /  ${this.deck.theme}  /  ${this.currentArtStyle.name}`;
    this.storyText.text = this.deck.story;
    this.rulesText.text = `玩法规则\n${renderDeckRules(this.deck)}`;
    this.metaText.text = this.detailMeta();
  }

  private updateInfo(): void {
    const fanStudy = resolveDeckCreationMode(this.deck) === 'fan-study';
    this.contentPolicyButton.setLabel(fanStudy ? '同人研习' : '原创模式');
    this.contentPolicyButton.setVariant('secondary', fanStudy ? COLORS.gold : COLORS.jade);
    this.syncDetailText();
    if (this.viewport) this.layout(this.viewport);
  }

  private openContentPolicy(): void {
    this.onContentPolicy(this.deck);
  }

  private beginOperation(): number {
    this.operationVersion += 1;
    return this.operationVersion;
  }

  private isOperationActive(operation: number): boolean {
    return !this.disposed && operation === this.operationVersion;
  }

  private async regenerateCurrentArtwork(cardId?: string): Promise<void> {
    if (this.generating) return;
    const targetCard = cardId
      ? this.deck.cards.find((card) => card.id === cardId)
      : this.currentCard;
    if (!targetCard) return;
    const operation = this.beginOperation();
    this.generating = true;
    this.loading.visible = true;
    this.clearDeckGenerationProgress(true);
    this.generateButton.setDisabled(true);
    this.regenerateArtworkButton.setDisabled(true);
    this.regenerateArtworkButton.setLabel('重绘中');
    this.themeInput.setDisabled(true);
    announce(`正在切换${targetCard.name}的内置卡面`);
    try {
      const artwork = await requestRegeneratedArtwork(this.deck, targetCard, this.currentArtStyle.id);
      if (!this.isOperationActive(operation)) return;
      const targetIndex = this.deck.cards.findIndex((card) => card.id === targetCard.id);
      if (targetIndex < 0) throw new ApiError('当前卡牌已不在套牌中，请重新选择。', 'CARD_NOT_FOUND');

      const nextCard = {
        ...this.deck.cards[targetIndex],
        artUrl: artwork.dataUrl,
      };
      const nextDeck = {
        ...this.deck,
        cards: this.deck.cards.map((card, index) => (index === targetIndex ? nextCard : card)),
      };
      this.deck = this.onDeckRevision(nextDeck, 'card-regeneration');
      this.onDeckCheckpoint();
      const thumbnailIndex = this.stripCardIndices.indexOf(targetIndex);
      this.stripCards[thumbnailIndex]?.setData(this.deck.cards[targetIndex]);
      if (this.selectedIndex === targetIndex) this.previewCard.setData(this.deck.cards[targetIndex]);
      this.updateInfo();
      const revision = describeRevision(this.deck);
      this.toast.success(`${targetCard.name}卡面已重绘并保存，${revision.versionLabel}可立即编辑、导出和交换。`);
      announce(`${targetCard.name}卡面已切换并保存`);
    } catch (error) {
      if (!this.isOperationActive(operation)) return;
      const message = error instanceof ApiError ? error.message : '当前卡牌切换卡面失败，请稍后重试。';
      this.toast.error(message, 4600);
    } finally {
      if (this.isOperationActive(operation)) {
        this.generating = false;
        this.loading.visible = false;
        this.generateButton.setDisabled(false);
        this.regenerateArtworkButton.setDisabled(false);
        this.regenerateArtworkButton.setLabel(this.viewport?.phone ? '重绘卡面' : '重绘此卡');
        this.themeInput.setDisabled(false);
      }
    }
  }

  private async generate(): Promise<void> {
    if (this.generating) return;
    const theme = this.themeInput.value.trim();
    if (theme.length < 2) {
      this.toast.error('主题至少需要 2 个字符。');
      this.themeInput.focus();
      return;
    }
    const operation = this.beginOperation();
    const generationSourceDeck = this.deck;
    const streamedCards = new Map<number, CardData>();
    let generationDraftStarted = false;
    this.generating = true;
    this.loading.visible = true;
    this.loadingText.text = `准备生成完整牌组 · 共 ${this.composition.recommendedTotal} 张`;
    this.updateDeckGenerationProgress({
      completed: 0,
      total: this.composition.recommendedTotal,
      batch: 0,
      batchCount: 0,
      phase: 'preparing',
    });
    this.generateButton.setDisabled(true);
    this.generateButton.setLabel('炼制中');
    this.regenerateArtworkButton.setDisabled(true);
    this.themeInput.setDisabled(true);
    announce('正在本地拼装套牌');
    try {
      const deck = await requestGeneratedDeck(
        theme,
        this.deck.modeId,
        this.currentArtStyle.id,
        this.deck.ruleKit,
        (progress) => {
          const operationActive = this.isOperationActive(operation);
          if (!operationActive) return;
          if (progress.streamedCard && progress.cardIndex !== undefined) {
            const isNewArtwork = !streamedCards.has(progress.cardIndex);
            const selectedCardId = this.deck.cards[this.selectedIndex]?.id;
            const currentIndex = this.deck.cards.findIndex(
              (card) => card.id === progress.streamedCard?.id,
            );
            const mergedCard = progress.streamedCard;
            streamedCards.set(progress.cardIndex, mergedCard);
            let streamedIndex = currentIndex;
            if (isNewArtwork) {
              const orderedEntries = [...streamedCards.entries()].sort(([left], [right]) => left - right);
              const cards = orderedCurrentStreamedCards(streamedCards, this.deck.cards);
              const draftDeck: DeckData = generationDraftStarted
                ? { ...this.deck, cards }
                : {
                    ...generationSourceDeck,
                    theme,
                    name: `${theme} · 炼制中`,
                    story: '正在按规则配方逐张派生独立卡牌；已完成的卡牌会立即显示并保存在本机。',
                    rules: generationSourceDeck.rules,
                    cards,
                    artStyleId: this.currentArtStyle.id,
                  };
              this.deck = generationDraftStarted
                ? this.onDeckChange(draftDeck)
                : this.onDeckRevision(draftDeck, 'deck-generation');
              generationDraftStarted = true;
              streamedIndex = orderedEntries.findIndex(([index]) => index === progress.cardIndex);
            } else if (currentIndex >= 0) {
              this.deck = this.onDeckChange({
                ...this.deck,
                cards: this.deck.cards.map((card, index) => (
                  index === currentIndex ? mergedCard : card
                )),
              });
            }
            if (isNewArtwork) this.onDeckCheckpoint();

            if (isNewArtwork) {
              if (streamedIndex >= 0) this.selectedIndex = streamedIndex;
              this.previewCard
                .setData(this.currentCard)
                .setArtStyle(this.currentArtStyle.id)
                .setGameplayContext(this.deck.ruleKit?.modules);
              this.previewCard.setBackDesign(this.deck.cardBack, this.deck.name).setFlipped(false);
              this.attackSlider.setValue(this.currentCard.attack);
              this.defenseSlider.setValue(this.currentCard.defense);
              this.skillInput.setValue(this.currentCard.skill);
              this.authorInput.setValue(this.currentCard.author);
              this.rebuildStrip(false);
              this.updateInfo();
              announce(`${this.currentCard.name}卡面已生成并保存`);
            } else {
              const preservedIndex = selectedCardId
                ? this.deck.cards.findIndex((card) => card.id === selectedCardId)
                : -1;
              if (preservedIndex >= 0) this.selectedIndex = preservedIndex;
              const thumbnailIndex = this.stripCardIndices.indexOf(streamedIndex);
              if (thumbnailIndex >= 0 && streamedIndex >= 0) {
                this.stripCards[thumbnailIndex]?.setData(this.deck.cards[streamedIndex]);
              }
              if (streamedIndex === this.selectedIndex) this.previewCard.setData(this.currentCard);
              this.syncDetailText();
            }
          }
          if (progress.phase === 'preparing') {
            this.loadingText.text = `规划完整牌组 · ${progress.total} 张`;
          } else if (progress.phase === 'generating') {
            this.loadingText.text = `本地拼装 ${progress.completed}/${progress.total} 张`;
          } else if (progress.phase === 'optimizing') {
            this.loadingText.text = `卡面已落盘 ${progress.completed}/${progress.total}`;
          } else if (progress.phase === 'failed') {
            const failedCard = progress.failedCards?.[0] ?? '未知卡牌';
            this.loadingText.text = `该牌待重绘 · ${failedCard} · 其它卡继续生成`;
          } else {
            this.loadingText.text = `完整牌组 ${progress.total}/${progress.total}`;
          }
          this.loadingText.position.y = 28 - this.loadingText.height / 2;
          this.updateDeckGenerationProgress(progress);
        },
      );
      if (!this.isOperationActive(operation)) return;
      const selectedCardId = this.deck.cards[this.selectedIndex]?.id;
      const generatedDeck = {
        ...deck,
        cards: reconcileGeneratedCards(deck.cards, streamedCards, this.deck.cards),
        ...(this.deck.contentPolicy ? { contentPolicy: this.deck.contentPolicy } : {}),
      };
      const nextDeck = generatedDeck.cardBack
        ? generatedDeck
        : {
            ...generatedDeck,
            cardBack: createCardBack(generatedDeck.modeId, generatedDeck.name, Date.now() >>> 0),
          };
      this.deck = generationDraftStarted
        ? this.onDeckChange(nextDeck)
        : this.onDeckRevision(nextDeck, 'deck-generation');
      const preservedIndex = selectedCardId
        ? this.deck.cards.findIndex((card) => card.id === selectedCardId)
        : -1;
      this.selectedIndex = preservedIndex >= 0 ? preservedIndex : 0;
      this.previewCard
        .setData(this.currentCard)
        .setArtStyle(this.currentArtStyle.id)
        .setGameplayContext(this.deck.ruleKit?.modules);
      this.previewCard.setBackDesign(this.deck.cardBack, this.deck.name).setFlipped(false);
      this.themeInput.setValue(this.deck.theme);
      this.attackSlider.setValue(this.currentCard.attack);
      this.defenseSlider.setValue(this.currentCard.defense);
      this.skillInput.setValue(this.currentCard.skill);
      this.authorInput.setValue(this.currentCard.author);
      this.inscriptionStyleControl.setValue(this.currentCard.inscriptionStyle ?? 'seal');
      this.inscriptionPlacementControl.setValue(this.currentCard.inscriptionPlacement ?? 'front');
      this.syncArtStyleControls();
      this.rebuildStrip();
      this.updateInfo();
      const revision = describeRevision(this.deck);
      this.toast.success(`《${this.deck.name}》${this.deck.cards.length} 张完整牌组已在本地拼装完成，${revision.versionLabel}已写入作品库，可直接导出和交换。`);
    } catch (error) {
      if (!this.isOperationActive(operation)) return;
      const message = error instanceof ApiError ? error.message : '生成失败，请稍后重试。';
      const savedNotice = streamedCards.size > 0
        ? ` 已完成的 ${streamedCards.size} 张卡面已保存在作品库。`
        : '';
      this.toast.error(`${message}${savedNotice}`, 6200);
    } finally {
      if (this.isOperationActive(operation)) {
        this.clearDeckGenerationProgress(true);
        this.generating = false;
        this.loading.visible = false;
        this.generateButton.setDisabled(false);
        this.generateButton.setLabel(this.generateButtonLabel(Boolean(
          this.viewport && (this.viewport.phone || isStudioLowHeightLandscape(this.viewport)),
        )));
        this.regenerateArtworkButton.setDisabled(false);
        this.themeInput.setDisabled(false);
      }
    }
  }

  private tick = (ticker: Ticker): void => {
    if (this.loading.visible) {
      this.loadingRing.rotation += Math.min(3, ticker.deltaTime * 0.045);
      const pulse = 0.88 + Math.sin(performance.now() / 240) * 0.12;
      this.loadingIcon.scale.set(pulse);
    }
    if (this.styleSample.visible) this.styleSample.animate(performance.now());
  };

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.disposed = true;
    this.operationVersion += 1;
    this.clearDeckGenerationProgress();
    this.generating = false;
    this.acceptsDeferredActions = false;
    Ticker.shared.remove(this.tick);
    super.destroy(options ?? { children: true });
  }
}
