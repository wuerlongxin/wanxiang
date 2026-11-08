import { Container, Graphics, Rectangle, Text, TextStyle, Ticker } from 'pixi.js';
import { TopBar } from '../chrome';
import {
  RECOMMENDED_RULE_COMBOS,
  RULE_MODULE_TEMPLATES,
  applyRuleKitToDeck,
  createCustomRuleModule,
  createRuleKit,
  createRuleKitFromCombo,
  createRuleModule,
  generateRuleBook,
  resolveDeckRuleKit,
} from '../rules';
import { COLORS, DISPLAY_FONT, FONT_FAMILY } from '../theme';
import type {
  DeckData,
  GameplayMechanicId,
  GameplayRuleModule,
  RuleBook,
  RuleKit,
  RuleParameter,
  Viewport,
} from '../types';
import { CanvasButton, CanvasInput, SegmentedControl } from '../ui';
import { announce, getReducedMotion, hexToNumber } from '../utils';
import { attachInteractionHint } from '../interaction-hints';
import { MAX_RULE_MODULES } from '../rule-kit-constraints.ts';
import { planDeckComposition } from '../deck-composition.ts';
import {
  CUSTOM_CARDS_IN_PLAY_PARAMETER_ID,
  CUSTOM_DECK_PARTS_PARAMETER_ID,
  DEFAULT_CUSTOM_DECK_PARTS_TEXT,
  MIN_CUSTOM_SESSION_CARDS,
  formatCustomDeckParts,
  parseCustomDeckParts,
  resolveCustomDeckComposition,
} from '../custom-composition.ts';
import {
  planRuleStackMetaLayout,
  planRuleStackRowLayout,
} from './rule-builder-layout.ts';

type MobileSection = 'blocks' | 'stack' | 'book';

export interface RuleBuilderSceneOptions {
  deck: DeckData;
  onHome: () => void;
  onStudio: () => void;
  onLibrary: () => void;
  onExchange: () => void;
  onBattle: () => void;
  onBack: () => void;
  onDeckChange: (deck: DeckData) => DeckData;
}

interface TemplateRow {
  root: Container;
  background: Graphics;
  glyphPlate: Graphics;
  glyph: Text;
  name: Text;
  summary: Text;
  addButton: CanvasButton;
  mechanicId: GameplayMechanicId;
}

interface ComboRow {
  root: Container;
  background: Graphics;
  name: Text;
  description: Text;
  applyButton: CanvasButton;
  comboId: string;
}

interface StackRow {
  root: Container;
  background: Graphics;
  orderPlate: Graphics;
  order: Text;
  name: Text;
  summary: Text;
  editButton: CanvasButton;
  toggleButton: CanvasButton;
  upButton: CanvasButton;
  downButton: CanvasButton;
  removeButton: CanvasButton;
  module: GameplayRuleModule;
  globalIndex: number;
}

interface ParameterEditorRow {
  root: Container;
  label: Text;
  value: Text;
  previousButton?: CanvasButton;
  nextButton?: CanvasButton;
  valueButton?: CanvasButton;
}

const MECHANIC_IDS: GameplayMechanicId[] = [
  'rapid-match',
  'memory-pair',
  'quantity-trigger',
  'icon-coop',
  'risk-draw',
];

const PAPER = 0xf0ddba;
const PAPER_EDGE = 0xb68343;
const PAPER_INK = 0x38231c;
const PAPER_MUTED = 0x765b48;
const WOOD = 0x3b1717;
const WOOD_LIGHT = 0x682820;
const BLUE_WHITE = 0x78a9bd;
const MINERAL_BLUE = 0x356f8c;
const MODULE_LIMIT_HINT = `规则栈最多 ${MAX_RULE_MODULES} 枚玩法积木；请先移除一枚再添加。`;

function makeText(
  value: string,
  size: number,
  color: number,
  weight: '400' | '500' | '600' | '700' = '500',
  display = false,
): Text {
  return new Text({
    text: value,
    style: new TextStyle({
      fontFamily: display ? DISPLAY_FONT : FONT_FAMILY,
      fontSize: size,
      fontWeight: weight,
      fill: color,
      letterSpacing: 0,
    }),
  });
}

function shorten(value: string, maximum: number): string {
  const characters = Array.from(value.trim());
  if (characters.length <= maximum) return characters.join('');
  return `${characters.slice(0, Math.max(1, maximum - 1)).join('')}…`;
}

function fitTextHeight(text: Text, value: string, maximumHeight: number): void {
  const source = value.trim();
  text.text = source;
  if (!source || text.height <= maximumHeight) return;
  const characters = Array.from(source);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    text.text = `${characters.slice(0, midpoint).join('').trimEnd()}…`;
    if (text.height <= maximumHeight) low = midpoint;
    else high = midpoint - 1;
  }
  text.text = low ? `${characters.slice(0, low).join('').trimEnd()}…` : '';
}

function instructionLines(value: string): string[] {
  const lines = value
    .split(/\n|[；;]/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : ['由创作者定义本模块的回合动作与结算顺序。'];
}

function formatSeal(value: string): string {
  const characters = Array.from(value.trim() || '万象').slice(0, 4);
  if (characters.length <= 2) return characters.join('\n');
  return `${characters.slice(0, 2).join('')}\n${characters.slice(2).join('')}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function listItems(value: string): string[] {
  return unique(value.split(/\n|[、，,；;]/).map((item) => item.trim()));
}

function parameterValueLabel(parameter: RuleParameter): string {
  if (parameter.control === 'toggle') return parameter.value ? '启用' : '关闭';
  const choice = parameter.choices?.find((candidate) => candidate.value === String(parameter.value));
  return choice?.label ?? `${String(parameter.value)}${parameter.unit ?? ''}`;
}

function parseCustomVariants(value: string): GameplayRuleModule['content']['variants'] {
  return unique(value.split(/\n|[；;]/)).map((line, index) => {
    const [rawName, ...descriptionParts] = line.split(/[：:]/);
    const name = rawName.trim() || `变体${index + 1}`;
    const description = descriptionParts.join('：').trim() || '按创作者约定调整本模块的结算方式。';
    return {
      id: `custom-variant-${index + 1}`,
      name,
      description,
      enabled: true,
    };
  });
}

export class RuleBuilderScene extends Container {
  private deck: DeckData;
  private ruleKit: RuleKit;
  private ruleBook: RuleBook;
  private readonly onDeckChange: (deck: DeckData) => DeckData;
  private readonly reducedMotion = getReducedMotion();

  private readonly chrome: TopBar;

  private readonly pageTitle = makeText('玩法织机', 29, COLORS.paper, '700', true);
  private readonly pageKicker = makeText('组合机制 · 编织规则 · 落款成书', 10, COLORS.gold, '700');
  private readonly deckLabel = makeText('', 11, COLORS.paperMuted, '600');
  private readonly aura = new Graphics();
  private readonly mobileTabs: SegmentedControl<MobileSection>;

  private readonly libraryPanel = new Container();
  private readonly libraryFrame = new Graphics();
  private readonly libraryTitle = makeText('机巧积木阁', 18, COLORS.paper, '700', true);
  private readonly librarySubtitle = makeText('五类原创机制', 9, COLORS.gold, '700');
  private readonly templateRowsContainer = new Container();
  private readonly comboTitle = makeText('推荐合璧', 13, COLORS.paperMuted, '700', true);
  private readonly comboRowsContainer = new Container();
  private readonly customButton: CanvasButton;
  private readonly templateRows: TemplateRow[] = [];
  private readonly comboRows: ComboRow[] = [];

  private readonly stackPanel = new Container();
  private readonly stackFrame = new Graphics();
  private readonly stackTitle = makeText('当前规则栈', 18, COLORS.paper, '700', true);
  private readonly stackSubtitle = makeText('', 9, COLORS.jade, '700');
  private readonly playerButton: CanvasButton;
  private readonly durationButton: CanvasButton;
  private readonly ageButton: CanvasButton;
  private readonly teamButton: CanvasButton;
  private readonly stackRowsContainer = new Container();
  private readonly paginationOrnament = new Graphics();
  private readonly previousPageButton: CanvasButton;
  private readonly nextPageButton: CanvasButton;
  private readonly pageText = makeText('1 / 1', 10, COLORS.paperMuted, '700');
  private stackRows: StackRow[] = [];
  private stackPage = 0;
  private stackPageSize = 4;

  private readonly previewPanel = new Container();
  private readonly previewFrame = new Graphics();
  private readonly previewPanelTitle = makeText('印刷说明书预览', 18, COLORS.paper, '700', true);
  private readonly previewPanelSubtitle = makeText('结构随规则即时成书', 9, COLORS.gold, '700');
  private readonly scrollShadow = new Graphics();
  private readonly scrollPaper = new Graphics();
  private readonly scrollInkEdge = new Graphics();
  private readonly scrollRods = new Graphics();
  private readonly scrollTitle = makeText('', 21, PAPER_INK, '700', true);
  private readonly scrollMeta = makeText('', 10, PAPER_MUTED, '600');
  private readonly scrollDivider = new Graphics();
  private readonly scrollBody = makeText('', 11, PAPER_INK, '500');
  private readonly plaqueBackground = new Graphics();
  private readonly plaqueTitle = makeText('创作者铭牌', 9, COLORS.cinnabar, '700');
  private readonly plaqueName = makeText('', 14, PAPER_INK, '700', true);
  private readonly plaqueMeta = makeText('', 9, PAPER_MUTED, '500');
  private readonly plaqueSeal = new Graphics();
  private readonly plaqueSealText = makeText('', 10, COLORS.cinnabar, '700', true);
  private readonly plaqueEditButton: CanvasButton;

  private readonly modalOverlay = new Graphics();
  private readonly customModal = new Container();
  private readonly modalBackground = new Graphics();
  private readonly modalOrnament = new Graphics();
  private readonly modalTitle = makeText('自定义玩法积木', 22, COLORS.paper, '700', true);
  private readonly modalSubtitle = makeText('原创规则将保留在套牌与印刷说明书中', 10, COLORS.gold, '600');
  private readonly customTabs: SegmentedControl<'core' | 'deck' | 'details'>;
  private readonly customNameInput: CanvasInput;
  private readonly customObjectiveInput: CanvasInput;
  private readonly customSetupInput: CanvasInput;
  private readonly customFlowInput: CanvasInput;
  private readonly customVictoryInput: CanvasInput;
  private readonly customDeckPartsInput: CanvasInput;
  private readonly customCardsInPlayInput: CanvasInput;
  private readonly customComponentsInput: CanvasInput;
  private readonly customVariantsInput: CanvasInput;
  private readonly cancelCustomButton: CanvasButton;
  private readonly confirmCustomButton: CanvasButton;

  private readonly moduleModal = new Container();
  private readonly moduleModalBackground = new Graphics();
  private readonly moduleModalOrnament = new Graphics();
  private readonly moduleModalTitle = makeText('积木参数', 22, COLORS.paper, '700', true);
  private readonly moduleModalSubtitle = makeText('调整数值与变体，说明书会即时重排', 10, COLORS.gold, '600');
  private readonly parameterRowsContainer = new Container();
  private readonly variantRowsContainer = new Container();
  private readonly moduleModalCloseButton: CanvasButton;
  private parameterRows: ParameterEditorRow[] = [];
  private variantRows: ParameterEditorRow[] = [];

  private readonly plaqueModal = new Container();
  private readonly plaqueModalBackground = new Graphics();
  private readonly plaqueModalOrnament = new Graphics();
  private readonly plaqueModalTitle = makeText('创作者铭牌与艺术签名', 22, COLORS.paper, '700', true);
  private readonly plaqueModalSubtitle = makeText('铭牌、落款与印章将随说明书一同导出', 10, COLORS.gold, '600');
  private readonly plaqueNameInput: CanvasInput;
  private readonly plaqueStudioInput: CanvasInput;
  private readonly plaqueSignatureInput: CanvasInput;
  private readonly plaqueSealInput: CanvasInput;
  private readonly plaqueEditionInput: CanvasInput;
  private readonly plaqueDedicationInput: CanvasInput;
  private readonly plaqueCancelButton: CanvasButton;
  private readonly plaqueConfirmButton: CanvasButton;

  private viewport?: Viewport;
  private mobileSection: MobileSection = 'stack';
  private customSerial = 0;
  private customNameValue = '';
  private customObjectiveValue = '';
  private customSetupValue = '';
  private customFlowValue = '';
  private customVictoryValue = '';
  private customDeckPartsValue = DEFAULT_CUSTOM_DECK_PARTS_TEXT;
  private customCardsInPlayValue = '24';
  private customComponentsValue = '';
  private customVariantsValue = '';
  private customModalTab: 'core' | 'deck' | 'details' = 'core';
  private editingCustomModuleId?: string;
  private editingModuleId?: string;
  private elapsed = 0;

  constructor(options: RuleBuilderSceneOptions) {
    super();
    this.sortableChildren = true;
    this.deck = options.deck;
    this.ruleKit = resolveDeckRuleKit(options.deck);
    this.ruleBook = generateRuleBook({ ...options.deck, ruleKit: this.ruleKit });
    this.onDeckChange = options.onDeckChange;

    this.chrome = new TopBar({
      current: 'rules',
      onHome: options.onHome,
      onNavigate: (scene) => {
        if (scene === 'studio') options.onStudio();
        if (scene === 'library') options.onLibrary();
        if (scene === 'exchange') options.onExchange();
        if (scene === 'battle') options.onBattle();
      },
      action: {
        label: '完成返回',
        icon: 'arrow-left',
        variant: 'primary',
        accent: COLORS.gold,
        tooltip: '保存当前玩法并返回设计台',
        onPress: options.onBack,
      },
    });

    this.mobileTabs = new SegmentedControl<MobileSection>({
      items: [
        { value: 'blocks', label: '积木库', icon: 'layers' },
        { value: 'stack', label: '规则栈', icon: 'sliders-horizontal' },
        { value: 'book', label: '说明书', icon: 'eye' },
      ],
      value: this.mobileSection,
      accent: COLORS.gold,
      onChange: (value) => {
        this.mobileSection = value;
        this.applySectionVisibility();
      },
    });

    this.customButton = new CanvasButton({
      label: '添加自定义积木',
      icon: 'plus',
      variant: 'primary',
      accent: COLORS.cinnabar,
      tooltip: `添加自定义玩法积木（最多 ${MAX_RULE_MODULES} 枚）`,
      onPress: () => this.openCustomModal(),
    });
    this.playerButton = new CanvasButton({
      label: '',
      iconOnly: false,
      variant: 'secondary',
      accent: COLORS.jade,
      tooltip: '切换玩家人数',
      onPress: () => this.cyclePlayers(),
    });
    this.durationButton = new CanvasButton({
      label: '',
      iconOnly: false,
      variant: 'secondary',
      accent: COLORS.gold,
      tooltip: '切换游戏时长',
      onPress: () => this.cycleDuration(),
    });
    this.ageButton = new CanvasButton({
      label: '',
      iconOnly: false,
      variant: 'secondary',
      accent: COLORS.cinnabar,
      tooltip: '切换建议年龄',
      onPress: () => this.cycleAge(),
    });
    this.teamButton = new CanvasButton({
      label: '',
      iconOnly: false,
      variant: 'secondary',
      accent: MINERAL_BLUE,
      tooltip: '切换组队模式',
      onPress: () => this.toggleTeamMode(),
    });
    this.previousPageButton = new CanvasButton({
      label: '',
      icon: 'arrow-left',
      iconOnly: true,
      variant: 'ghost',
      tooltip: '上一页规则积木',
      onPress: () => this.changeStackPage(-1),
    });
    this.nextPageButton = new CanvasButton({
      label: '',
      icon: 'arrow-right',
      iconOnly: true,
      variant: 'ghost',
      tooltip: '下一页规则积木',
      onPress: () => this.changeStackPage(1),
    });

    this.plaqueEditButton = new CanvasButton({
      label: '',
      icon: 'pen-line',
      iconOnly: true,
      variant: 'ghost',
      accent: COLORS.cinnabar,
      tooltip: '编辑创作者铭牌与艺术签名',
      onPress: () => this.openPlaqueModal(),
    });

    this.customTabs = new SegmentedControl<'core' | 'deck' | 'details'>({
      items: [
        { value: 'core', label: '核心规则', icon: 'layers' },
        { value: 'deck', label: '牌组构成', icon: 'layout-grid' },
        { value: 'details', label: '设置与变体', icon: 'sliders-horizontal' },
      ],
      value: this.customModalTab,
      accent: COLORS.gold,
      onChange: (value) => {
        this.customModalTab = value;
        this.applyCustomTabVisibility();
        if (this.viewport) this.layoutModal(this.viewport);
      },
    });

    this.customNameInput = new CanvasInput({
      label: '积木名称',
      placeholder: '例：星河接力',
      icon: 'pen-line',
      maxLength: 24,
      accent: COLORS.gold,
      onInput: (value) => { this.customNameValue = value; },
    });
    this.customObjectiveInput = new CanvasInput({
      label: '玩法目标',
      placeholder: '玩家需要达成的核心目标',
      multiline: true,
      maxLength: 180,
      accent: COLORS.cinnabar,
      onInput: (value) => { this.customObjectiveValue = value; },
    });
    this.customSetupInput = new CanvasInput({
      label: '初始设置',
      placeholder: '组件准备；洗牌与摆放；起始玩家',
      multiline: true,
      maxLength: 360,
      accent: MINERAL_BLUE,
      onInput: (value) => { this.customSetupValue = value; },
    });
    this.customFlowInput = new CanvasInput({
      label: '回合流程',
      placeholder: '行动；触发；结算',
      multiline: true,
      maxLength: 480,
      accent: COLORS.jade,
      onInput: (value) => { this.customFlowValue = value; },
    });
    this.customVictoryInput = new CanvasInput({
      label: '胜负判定',
      placeholder: '游戏结束与获胜条件',
      multiline: true,
      maxLength: 180,
      accent: COLORS.gold,
      onInput: (value) => { this.customVictoryValue = value; },
    });
    this.customDeckPartsInput = new CanvasInput({
      label: '完整盒装牌型',
      placeholder: '角色牌：8\n行动牌：12\n事件牌：4',
      multiline: true,
      maxLength: 360,
      accent: COLORS.gold,
      onInput: (value) => { this.customDeckPartsValue = value; },
    });
    this.customCardsInPlayInput = new CanvasInput({
      label: '标准单局投入',
      placeholder: '24',
      maxLength: 2,
      accent: COLORS.jade,
      onInput: (value) => { this.customCardsInPlayValue = value; },
    });
    this.customComponentsInput = new CanvasInput({
      label: '所需组件',
      placeholder: '卡牌、标记、计时器（用顿号或换行分隔）',
      multiline: true,
      maxLength: 240,
      accent: COLORS.jade,
      onInput: (value) => { this.customComponentsValue = value; },
    });
    this.customVariantsInput = new CanvasInput({
      label: '进阶变体',
      placeholder: '变体名称：玩法说明（每行一项）',
      multiline: true,
      maxLength: 480,
      accent: COLORS.cinnabar,
      onInput: (value) => { this.customVariantsValue = value; },
    });
    this.cancelCustomButton = new CanvasButton({
      label: '取消',
      icon: 'x',
      variant: 'ghost',
      onPress: () => this.closeCustomModal(),
    });
    this.confirmCustomButton = new CanvasButton({
      label: '加入规则栈',
      icon: 'plus',
      variant: 'primary',
      accent: COLORS.cinnabar,
      onPress: () => this.saveCustomModule(),
    });

    this.moduleModalCloseButton = new CanvasButton({
      label: '完成',
      icon: 'check',
      variant: 'primary',
      accent: COLORS.gold,
      onPress: () => this.closeModuleModal(),
    });

    const plaque = this.deck.creatorPlaque;
    this.plaqueNameInput = new CanvasInput({
      label: '创作者名',
      value: plaque?.displayName || this.deck.author,
      placeholder: '你的创作者名',
      maxLength: 32,
      accent: COLORS.gold,
    });
    this.plaqueStudioInput = new CanvasInput({
      label: '工作室 / 社团',
      value: plaque?.studioName || '',
      placeholder: '可留空',
      maxLength: 40,
      accent: MINERAL_BLUE,
    });
    this.plaqueSignatureInput = new CanvasInput({
      label: '艺术手签',
      value: plaque?.signatureText || plaque?.displayName || this.deck.author,
      placeholder: '用于手写风格落款',
      maxLength: 24,
      accent: COLORS.gold,
    });
    this.plaqueSealInput = new CanvasInput({
      label: '篆刻印文',
      value: plaque?.sealText || `${this.deck.author}制`,
      placeholder: '建议 2-4 字',
      maxLength: 8,
      accent: COLORS.cinnabar,
    });
    this.plaqueEditionInput = new CanvasInput({
      label: '版次',
      value: plaque?.edition || '初刻版',
      placeholder: '例：甲辰初刻',
      maxLength: 20,
      accent: COLORS.jade,
    });
    this.plaqueDedicationInput = new CanvasInput({
      label: '题记',
      value: plaque?.dedication || '',
      placeholder: '写给共同游戏的人',
      maxLength: 80,
      accent: COLORS.cinnabar,
    });
    this.plaqueCancelButton = new CanvasButton({
      label: '取消',
      icon: 'x',
      variant: 'ghost',
      onPress: () => this.closePlaqueModal(),
    });
    this.plaqueConfirmButton = new CanvasButton({
      label: '篆刻铭牌',
      icon: 'stamp',
      variant: 'primary',
      accent: COLORS.cinnabar,
      onPress: () => this.saveCreatorPlaque(),
    });

    this.buildTemplateRows();
    this.buildComboRows();
    this.refreshModuleLimitControls();
    this.templateRowsContainer.addChild(...this.templateRows.map((row) => row.root));
    this.comboRowsContainer.addChild(...this.comboRows.map((row) => row.root));

    this.libraryPanel.addChild(
      this.libraryFrame,
      this.libraryTitle,
      this.librarySubtitle,
      this.templateRowsContainer,
      this.comboTitle,
      this.comboRowsContainer,
      this.customButton,
    );
    this.stackPanel.addChild(
      this.stackFrame,
      this.stackTitle,
      this.stackSubtitle,
      this.playerButton,
      this.durationButton,
      this.ageButton,
      this.teamButton,
      this.stackRowsContainer,
      this.paginationOrnament,
      this.previousPageButton,
      this.pageText,
      this.nextPageButton,
    );
    this.plaqueSealText.anchor.set(0.5);
    this.previewPanel.addChild(
      this.previewFrame,
      this.previewPanelTitle,
      this.previewPanelSubtitle,
      this.scrollShadow,
      this.scrollPaper,
      this.scrollInkEdge,
      this.scrollRods,
      this.scrollTitle,
      this.scrollMeta,
      this.scrollDivider,
      this.scrollBody,
      this.plaqueBackground,
      this.plaqueTitle,
      this.plaqueName,
      this.plaqueMeta,
      this.plaqueSeal,
      this.plaqueSealText,
      this.plaqueEditButton,
    );

    this.modalOverlay.eventMode = 'static';
    this.customModal.addChild(
      this.modalBackground,
      this.modalOrnament,
      this.modalTitle,
      this.modalSubtitle,
      this.customTabs,
      this.customNameInput,
      this.customObjectiveInput,
      this.customSetupInput,
      this.customFlowInput,
      this.customVictoryInput,
      this.customDeckPartsInput,
      this.customCardsInPlayInput,
      this.customComponentsInput,
      this.customVariantsInput,
      this.cancelCustomButton,
      this.confirmCustomButton,
    );
    this.moduleModal.addChild(
      this.moduleModalBackground,
      this.moduleModalOrnament,
      this.moduleModalTitle,
      this.moduleModalSubtitle,
      this.parameterRowsContainer,
      this.variantRowsContainer,
      this.moduleModalCloseButton,
    );
    this.plaqueModal.addChild(
      this.plaqueModalBackground,
      this.plaqueModalOrnament,
      this.plaqueModalTitle,
      this.plaqueModalSubtitle,
      this.plaqueNameInput,
      this.plaqueStudioInput,
      this.plaqueSignatureInput,
      this.plaqueSealInput,
      this.plaqueEditionInput,
      this.plaqueDedicationInput,
      this.plaqueCancelButton,
      this.plaqueConfirmButton,
    );
    this.modalOverlay.visible = false;
    this.customModal.visible = false;
    this.moduleModal.visible = false;
    this.plaqueModal.visible = false;
    this.modalOverlay.zIndex = 100;
    this.customModal.zIndex = 110;
    this.moduleModal.zIndex = 110;
    this.plaqueModal.zIndex = 110;

    this.addChild(
      this.chrome,
      this.pageTitle,
      this.pageKicker,
      this.deckLabel,
      this.aura,
      this.mobileTabs,
      this.libraryPanel,
      this.stackPanel,
      this.previewPanel,
      this.modalOverlay,
      this.customModal,
      this.moduleModal,
      this.plaqueModal,
    );

    this.rebuildStackRows();
    this.updateBookPreview();
    this.applyCustomTabVisibility();
    this.applySectionVisibility();
    Ticker.shared.add(this.tick);
  }

  layout(viewport: Viewport): void {
    this.viewport = viewport;
    const { width, height, phone } = viewport;
    this.chrome.layout(viewport);
    this.layoutHeader(viewport);

    const side = phone ? 14 : 20;
    const gap = phone ? 0 : 12;
    const panelTop = phone ? 154 : 132;
    const panelHeight = Math.max(318, height - panelTop - (phone ? 12 : 16));
    let libraryWidth: number;
    let stackWidth: number;
    let previewWidth: number;

    if (phone) {
      libraryWidth = width - side * 2;
      stackWidth = libraryWidth;
      previewWidth = libraryWidth;
      this.libraryPanel.position.set(side, panelTop);
      this.stackPanel.position.set(side, panelTop);
      this.previewPanel.position.set(side, panelTop);
    } else {
      const available = width - side * 2 - gap * 2;
      libraryWidth = Math.min(294, Math.max(244, available * 0.255));
      stackWidth = Math.min(372, Math.max(296, available * 0.315));
      previewWidth = available - libraryWidth - stackWidth;
      this.libraryPanel.position.set(side, panelTop);
      this.stackPanel.position.set(side + libraryWidth + gap, panelTop);
      this.previewPanel.position.set(side + libraryWidth + gap + stackWidth + gap, panelTop);
    }

    this.layoutLibraryPanel(libraryWidth, panelHeight, phone);
    this.layoutStackPanel(stackWidth, panelHeight, phone);
    this.layoutPreviewPanel(previewWidth, panelHeight, phone);
    this.layoutModal(viewport);
    this.applySectionVisibility();
  }

  private layoutHeader(viewport: Viewport): void {
    const { width, phone } = viewport;
    const side = phone ? 12 : 20;
    this.pageTitle.style.fontSize = phone ? 22 : 29;
    this.pageTitle.position.set(side, phone ? 67 : 75);
    this.pageKicker.position.set(side + 1, phone ? 96 : 109);
    this.pageKicker.visible = !phone;
    this.deckLabel.text = `${shorten(this.deck.name, phone ? 18 : 34)} · ${this.ruleKit.modules.length} 枚积木`;
    this.deckLabel.anchor.set(phone ? 1 : 0, 0);
    this.deckLabel.position.set(phone ? width - side : Math.min(width * 0.35, 390), phone ? 73 : 87);

    this.aura.clear();
    const auraY = phone ? 102 : 112;
    for (let index = 0; index < (phone ? 5 : 9); index += 1) {
      const x = side + 190 + index * (phone ? 28 : 48);
      this.aura.circle(x, auraY + Math.sin(index * 1.7) * 4, index % 3 === 0 ? 2.2 : 1.2).fill({
        color: index % 2 ? COLORS.gold : COLORS.cinnabar,
        alpha: 0.3,
      });
    }
    this.mobileTabs.visible = phone;
    if (phone) {
      this.mobileTabs.setSize(width - side * 2, 34);
      this.mobileTabs.position.set(side, 112);
    }
  }

  private drawPanel(frame: Graphics, width: number, height: number, accent: number): void {
    frame
      .clear()
      .roundRect(0, 0, width, height, 6)
      .fill({ color: COLORS.panel, alpha: 0.93 })
      .stroke({ color: COLORS.line, width: 1 })
      .rect(1, 1, width - 2, 52)
      .fill({ color: WOOD, alpha: 0.76 })
      .moveTo(12, 55)
      .lineTo(width - 12, 55)
      .stroke({ color: accent, width: 1, alpha: 0.4 });
    frame
      .roundRect(5, 5, width - 10, height - 10, 3)
      .stroke({ color: COLORS.black, width: 1.5, alpha: 0.34 })
      .moveTo(16, 7)
      .lineTo(width - 16, 7)
      .stroke({ color: COLORS.gold, width: 1, alpha: 0.28 });
    for (let x = 14; x < width - 18; x += 22) {
      frame
        .moveTo(x, 57)
        .quadraticCurveTo(x + 5.5, 52.5, x + 11, 57)
        .quadraticCurveTo(x + 16.5, 61.5, x + 22, 57)
        .stroke({ color: BLUE_WHITE, width: 0.8, alpha: 0.28 });
    }
    frame
      .moveTo(0, 8)
      .lineTo(8, 0)
      .lineTo(24, 0)
      .lineTo(0, 24)
      .closePath()
      .fill({ color: COLORS.gold, alpha: 0.1 })
      .moveTo(width, 8)
      .lineTo(width - 8, 0)
      .lineTo(width - 24, 0)
      .lineTo(width, 24)
      .closePath()
      .fill({ color: COLORS.gold, alpha: 0.1 });
    const corner = 13;
    for (const [x, y, sx, sy] of [
      [8, 8, 1, 1],
      [width - 8, 8, -1, 1],
      [8, height - 8, 1, -1],
      [width - 8, height - 8, -1, -1],
    ] as const) {
      frame
        .moveTo(x, y + sy * corner)
        .lineTo(x, y)
        .lineTo(x + sx * corner, y)
        .stroke({ color: accent, width: 1.2, alpha: 0.7 });
    }
  }

  private layoutLibraryPanel(width: number, height: number, phone: boolean): void {
    this.drawPanel(this.libraryFrame, width, height, COLORS.cinnabar);
    this.libraryTitle.style.fontSize = phone ? 16 : 18;
    this.libraryTitle.position.set(14, 12);
    this.librarySubtitle.position.set(15, 36);

    const dense = phone || height < 450;
    const templateTop = 62;
    const templateGap = dense ? 2 : 5;
    const templateHeight = dense ? 29 : 39;
    this.templateRowsContainer.position.set(0, templateTop);
    this.templateRows.forEach((row, index) => {
      const rowWidth = width - 20;
      const accent = hexToNumber(RULE_MODULE_TEMPLATES[row.mechanicId].accentHex);
      const glyphSize = templateHeight - 10;
      row.root.position.set(10, index * (templateHeight + templateGap));
      row.root.hitArea = new Rectangle(0, 0, rowWidth, templateHeight);
      row.background
        .clear()
        .roundRect(0, 0, rowWidth, templateHeight, 5)
        .fill({ color: COLORS.panelRaised, alpha: 0.78 })
        .stroke({ color: accent, width: 1, alpha: 0.35 })
        .moveTo(glyphSize + 8, templateHeight - 3)
        .lineTo(rowWidth - 38, templateHeight - 3)
        .stroke({ color: BLUE_WHITE, width: 0.7, alpha: 0.22 });
      row.glyphPlate
        .clear()
        .roundRect(5, 5, glyphSize, glyphSize, 4)
        .fill({ color: accent, alpha: 0.18 })
        .stroke({ color: accent, width: 1, alpha: 0.5 });
      row.glyph.style.fontSize = dense ? 12 : 14;
      row.glyph.position.set(5 + glyphSize / 2, templateHeight / 2);
      row.name.style.fontSize = dense ? 11 : 12;
      row.name.position.set(glyphSize + 11, dense ? 8 : 5);
      row.summary.visible = !dense;
      row.summary.position.set(glyphSize + 11, 22);
      row.summary.style.wordWrap = false;
      row.addButton.setSize(28, 28);
      row.addButton.position.set(rowWidth - 33, (templateHeight - 28) / 2);
    });

    const templatesBottom = templateTop + MECHANIC_IDS.length * (templateHeight + templateGap) - templateGap;
    this.comboTitle.position.set(12, templatesBottom + (dense ? 7 : 10));
    const comboTop = this.comboTitle.y + (dense ? 20 : 23);
    this.comboRowsContainer.position.set(0, comboTop);
    const comboGap = dense ? 3 : 4;
    const comboHeight = dense ? 26 : 31;
    const comboColumns = dense && width >= 290 ? 2 : 1;
    const comboWidth = comboColumns === 2 ? (width - 24 - comboGap) / 2 : width - 20;
    this.comboRows.forEach((row, index) => {
      const column = index % comboColumns;
      const line = Math.floor(index / comboColumns);
      row.root.position.set(10 + column * (comboWidth + comboGap), line * (comboHeight + comboGap));
      row.root.hitArea = new Rectangle(0, 0, comboWidth, comboHeight);
      row.background
        .clear()
        .roundRect(0, 0, comboWidth, comboHeight, 5)
        .fill({ color: COLORS.cinnabar, alpha: 0.09 })
        .stroke({ color: COLORS.bronze, width: 1, alpha: 0.5 });
      for (let notch = 0; notch < 3; notch += 1) {
        const notchX = 5 + notch * 7;
        row.background
          .moveTo(notchX, comboHeight)
          .lineTo(notchX + 3, comboHeight - 3)
          .lineTo(notchX + 6, comboHeight)
          .closePath()
          .fill({ color: COLORS.cinnabar, alpha: 0.28 });
      }
      row.name.style.fontSize = dense ? 10 : 11;
      row.name.position.set(9, dense ? 7 : 4);
      row.description.visible = !dense;
      row.description.position.set(9, 17);
      row.applyButton.setSize(26, 26);
      row.applyButton.position.set(comboWidth - 29, (comboHeight - 26) / 2);
    });

    this.customButton.setSize(width - 20, 35);
    this.customButton.position.set(10, height - 44);
  }

  private layoutStackPanel(width: number, height: number, phone: boolean): void {
    this.drawPanel(this.stackFrame, width, height, COLORS.jade);
    this.stackTitle.style.fontSize = phone ? 16 : 18;
    this.stackTitle.position.set(14, 12);
    const composition = planDeckComposition(this.ruleKit);
    const surfaceDensityOverflow = composition.constraints.some(
      (constraint) => (
        constraint.id === 'surface-density-overflow'
        || constraint.id === 'rapid-symbol-overflow'
      ),
    );
    this.stackSubtitle.text = `${this.ruleKit.modules.filter((module) => module.enabled).length} 枚启用 · 盒装 ${composition.totalCards} 张 · 标准局 ${composition.playSetup.cardsInPlay.default} 张${surfaceDensityOverflow ? ' · 超过4层，不可印刷' : ''}`;
    this.stackSubtitle.style.fill = surfaceDensityOverflow ? COLORS.coral : COLORS.jade;
    this.stackSubtitle.position.set(15, 36);

    this.refreshMetaLabels();
    const metaLayout = planRuleStackMetaLayout(width);
    const metaButtons = [
      this.playerButton,
      this.durationButton,
      this.ageButton,
      this.teamButton,
    ];
    metaButtons.forEach((button, index) => {
      button.setSize(metaLayout.buttonWidth, metaLayout.buttonHeight);
      button.position.set(metaLayout.positions[index].x, metaLayout.positions[index].y);
    });

    const rowsTop = metaLayout.rowsTop;
    const footerHeight = 42;
    const rowLayout = planRuleStackRowLayout(width);
    const nextPageSize = Math.max(
      1,
      Math.floor((height - rowsTop - footerHeight - 8) / rowLayout.rowStride),
    );
    if (nextPageSize !== this.stackPageSize) {
      this.stackPageSize = nextPageSize;
      this.stackPage = Math.min(this.stackPage, this.stackPageCount - 1);
      this.rebuildStackRows();
    }
    this.stackRowsContainer.position.set(0, rowsTop);
    this.layoutStackRows(width);

    this.previousPageButton.setSize(32, 32);
    this.nextPageButton.setSize(32, 32);
    this.previousPageButton.position.set(12, height - 38);
    this.nextPageButton.position.set(width - 44, height - 38);
    this.paginationOrnament
      .clear()
      .circle(28, height - 22, 18)
      .fill({ color: COLORS.jade, alpha: 0.09 })
      .stroke({ color: COLORS.jade, width: 1, alpha: 0.34 })
      .circle(width - 28, height - 22, 18)
      .fill({ color: COLORS.jade, alpha: 0.09 })
      .stroke({ color: COLORS.jade, width: 1, alpha: 0.34 })
      .moveTo(50, height - 22)
      .lineTo(width - 50, height - 22)
      .stroke({ color: BLUE_WHITE, width: 0.8, alpha: 0.22 });
    for (let x = 62; x < width - 58; x += 18) {
      this.paginationOrnament
        .moveTo(x, height - 22)
        .lineTo(x + 4, height - 26)
        .lineTo(x + 8, height - 22)
        .lineTo(x + 4, height - 18)
        .closePath()
        .stroke({ color: MINERAL_BLUE, width: 0.6, alpha: 0.22 });
    }
    this.pageText.anchor.set(0.5);
    this.pageText.position.set(width / 2, height - 22);
    this.pageText.text = `${this.stackPage + 1} / ${this.stackPageCount}`;
    this.previousPageButton.setDisabled(this.stackPage <= 0);
    this.nextPageButton.setDisabled(this.stackPage >= this.stackPageCount - 1);
  }

  private layoutStackRows(width: number): void {
    const layout = planRuleStackRowLayout(width);
    this.stackRows.forEach((row, visibleIndex) => {
      const accent = hexToNumber(row.module.accentHex);
      row.root.position.set(12, visibleIndex * layout.rowStride);
      row.background
        .clear()
        .roundRect(0, 0, layout.rowWidth, layout.rowHeight, 5)
        .fill({ color: row.module.enabled ? COLORS.panelRaised : COLORS.inkSoft, alpha: 0.94 })
        .stroke({ color: accent, width: 1, alpha: row.module.enabled ? 0.58 : 0.28 });
      row.root.alpha = 1;
      row.orderPlate
        .clear()
        .circle(23, layout.rowHeight / 2, 16)
        .fill({ color: accent, alpha: row.module.enabled ? 0.2 : 0.1 })
        .stroke({ color: accent, width: 1, alpha: row.module.enabled ? 0.68 : 0.4 });
      row.order.position.set(23, layout.rowHeight / 2);
      row.name.style.fill = row.module.enabled ? COLORS.paper : COLORS.paperMuted;
      row.name.position.set(layout.contentX, layout.nameY);
      row.name.style.wordWrap = false;
      row.name.text = shorten(row.module.name, Math.max(5, Math.floor(layout.contentWidth / 13)));
      row.summary.style.fill = COLORS.paperMuted;
      row.summary.position.set(layout.contentX, layout.summaryY);
      row.summary.style.wordWrap = false;
      row.summary.text = shorten(
        row.module.summary,
        Math.max(8, Math.floor(layout.contentWidth / 9.2)),
      );
      row.editButton.setSize(layout.controlSize, layout.controlSize);
      row.toggleButton.setSize(layout.controlSize, layout.controlSize);
      row.upButton.setSize(layout.controlSize, layout.controlSize);
      row.downButton.setSize(layout.controlSize, layout.controlSize);
      row.removeButton.setSize(layout.controlSize, layout.controlSize);
      row.editButton.position.set(layout.controls.edit.x, layout.controls.edit.y);
      row.toggleButton.position.set(layout.controls.toggle.x, layout.controls.toggle.y);
      row.upButton.scale.set(1, -1);
      row.upButton.position.set(
        layout.controls.up.x,
        layout.controls.up.y + layout.controlSize,
      );
      row.downButton.position.set(layout.controls.down.x, layout.controls.down.y);
      row.removeButton.position.set(layout.controls.remove.x, layout.controls.remove.y);
    });
  }

  private layoutPreviewPanel(width: number, height: number, phone: boolean): void {
    this.drawPanel(this.previewFrame, width, height, COLORS.gold);
    this.previewPanelTitle.style.fontSize = phone ? 16 : 18;
    this.previewPanelTitle.position.set(14, 12);
    this.previewPanelSubtitle.position.set(15, 36);

    const scrollX = 12;
    const scrollY = 64;
    const scrollWidth = width - 24;
    const scrollHeight = height - 78;
    this.scrollShadow
      .clear()
      .roundRect(scrollX + 4, scrollY + 6, scrollWidth, scrollHeight, 4)
      .fill({ color: COLORS.black, alpha: 0.24 });
    this.scrollPaper
      .clear()
      .roundRect(scrollX, scrollY, scrollWidth, scrollHeight, 3)
      .fill({ color: PAPER, alpha: 0.97 })
      .stroke({ color: PAPER_EDGE, width: 1.2, alpha: 0.9 });
    this.scrollInkEdge
      .clear()
      .moveTo(scrollX + 4, scrollY + 14)
      .bezierCurveTo(
        scrollX + 1,
        scrollY + scrollHeight * 0.28,
        scrollX + 7,
        scrollY + scrollHeight * 0.7,
        scrollX + 3,
        scrollY + scrollHeight - 14,
      )
      .stroke({ color: PAPER_INK, width: 1.2, alpha: 0.16 })
      .moveTo(scrollX + scrollWidth - 4, scrollY + 14)
      .bezierCurveTo(
        scrollX + scrollWidth - 1,
        scrollY + scrollHeight * 0.32,
        scrollX + scrollWidth - 7,
        scrollY + scrollHeight * 0.68,
        scrollX + scrollWidth - 3,
        scrollY + scrollHeight - 14,
      )
      .stroke({ color: PAPER_INK, width: 1.2, alpha: 0.16 })
      .rect(scrollX + 7, scrollY + 7, 2, scrollHeight - 14)
      .fill({ color: MINERAL_BLUE, alpha: 0.15 })
      .rect(scrollX + scrollWidth - 9, scrollY + 7, 2, scrollHeight - 14)
      .fill({ color: COLORS.cinnabar, alpha: 0.13 });
    this.scrollRods
      .clear()
      .roundRect(scrollX - 4, scrollY - 4, scrollWidth + 8, 8, 4)
      .fill(WOOD_LIGHT)
      .stroke({ color: COLORS.gold, width: 1, alpha: 0.65 })
      .roundRect(scrollX - 4, scrollY + scrollHeight - 4, scrollWidth + 8, 8, 4)
      .fill(WOOD_LIGHT)
      .stroke({ color: COLORS.gold, width: 1, alpha: 0.65 });

    const inset = phone ? 16 : 20;
    const textX = scrollX + inset;
    const textWidth = scrollWidth - inset * 2;
    this.scrollTitle.style.fontSize = phone ? 18 : 21;
    this.scrollTitle.style.wordWrap = true;
    this.scrollTitle.style.breakWords = true;
    this.scrollTitle.style.wordWrapWidth = textWidth;
    this.scrollTitle.position.set(textX, scrollY + 16);
    fitTextHeight(this.scrollTitle, this.ruleBook.title, phone ? 44 : 50);
    this.scrollMeta.position.set(textX, this.scrollTitle.y + this.scrollTitle.height + 5);
    this.scrollMeta.style.wordWrap = true;
    this.scrollMeta.style.wordWrapWidth = textWidth;
    this.scrollDivider
      .clear()
      .moveTo(textX, this.scrollMeta.y + this.scrollMeta.height + 8)
      .lineTo(textX + textWidth, this.scrollMeta.y + this.scrollMeta.height + 8)
      .stroke({ color: COLORS.cinnabar, width: 1, alpha: 0.48 });
    for (let x = textX; x < textX + textWidth - 8; x += 16) {
      const y = this.scrollMeta.y + this.scrollMeta.height + 8;
      this.scrollDivider
        .moveTo(x, y)
        .quadraticCurveTo(x + 4, y - 3, x + 8, y)
        .quadraticCurveTo(x + 12, y + 3, x + 16, y)
        .stroke({ color: MINERAL_BLUE, width: 0.65, alpha: 0.32 });
    }

    const plaqueHeight = phone ? 65 : 72;
    const plaqueY = scrollY + scrollHeight - plaqueHeight - 10;
    const bodyY = this.scrollMeta.y + this.scrollMeta.height + 16;
    const bodyHeight = Math.max(48, plaqueY - bodyY - 8);
    this.scrollBody.position.set(textX, bodyY);
    this.scrollBody.style.fontSize = phone ? 10 : 11;
    this.scrollBody.style.lineHeight = phone ? 15 : 17;
    this.scrollBody.style.wordWrap = true;
    this.scrollBody.style.breakWords = true;
    this.scrollBody.style.wordWrapWidth = textWidth;
    fitTextHeight(this.scrollBody, this.composePreviewText(phone), bodyHeight);

    this.plaqueBackground
      .clear()
      .roundRect(textX, plaqueY, textWidth, plaqueHeight, 4)
      .fill({ color: COLORS.white, alpha: 0.2 })
      .stroke({ color: COLORS.cinnabar, width: 1, alpha: 0.35 });
    this.plaqueTitle.position.set(textX + 10, plaqueY + 7);
    this.plaqueName.position.set(textX + 10, plaqueY + 22);
    this.plaqueMeta.position.set(textX + 10, plaqueY + 43);
    this.plaqueMeta.style.wordWrap = false;
    const sealSize = plaqueHeight - 18;
    const sealX = textX + textWidth - sealSize - 9;
    const sealY = plaqueY + 9;
    this.plaqueSeal
      .clear()
      .roundRect(sealX, sealY, sealSize, sealSize, 2)
      .stroke({ color: COLORS.cinnabar, width: 2, alpha: 0.85 })
      .rect(sealX + 4, sealY + 4, sealSize - 8, sealSize - 8)
      .stroke({ color: COLORS.cinnabar, width: 0.8, alpha: 0.55 });
    this.plaqueSealText.style.fontSize = phone ? 9 : 10;
    this.plaqueSealText.position.set(sealX + sealSize / 2, sealY + sealSize / 2);
    this.plaqueEditButton.setSize(30, 30);
    this.plaqueEditButton.position.set(width - 44, 12);
  }

  private layoutModal(viewport: Viewport): void {
    const { width, height, phone } = viewport;
    this.modalOverlay.clear().rect(0, 0, width, height).fill({ color: COLORS.black, alpha: 0.74 });
    this.modalOverlay.hitArea = new Rectangle(0, 0, width, height);

    const modalWidth = Math.min(660, width - (phone ? 24 : 48));
    const modalHeight = Math.min(phone ? 520 : 570, height - 24);
    this.customModal.position.set((width - modalWidth) / 2, (height - modalHeight) / 2);
    this.modalBackground
      .clear()
      .roundRect(0, 0, modalWidth, modalHeight, 7)
      .fill({ color: COLORS.panel, alpha: 0.99 })
      .stroke({ color: COLORS.gold, width: 1.2, alpha: 0.75 })
      .rect(1, 1, modalWidth - 2, 64)
      .fill({ color: WOOD, alpha: 0.78 });
    this.modalOrnament
      .clear()
      .moveTo(18, 66)
      .lineTo(modalWidth - 18, 66)
      .stroke({ color: COLORS.cinnabar, width: 1, alpha: 0.48 });
    this.modalTitle.style.fontSize = phone ? 19 : 22;
    this.modalTitle.position.set(22, 13);
    this.modalSubtitle.position.set(23, 43);

    const fieldX = phone ? 16 : 24;
    const fieldWidth = modalWidth - fieldX * 2;
    this.customTabs.setSize(fieldWidth, 34);
    this.customTabs.position.set(fieldX, 74);
    const top = 116;
    const gap = 8;
    const nameHeight = 58;
    const objectiveHeight = phone ? 70 : 78;
    const flowHeight = Math.max(76, modalHeight - top - nameHeight - objectiveHeight - 70 - gap * 3 - 58);
    const victoryHeight = 70;
    this.customNameInput.setSize(fieldWidth, nameHeight);
    this.customObjectiveInput.setSize(fieldWidth, objectiveHeight);
    this.customFlowInput.setSize(fieldWidth, flowHeight);
    this.customVictoryInput.setSize(fieldWidth, victoryHeight);
    this.customNameInput.position.set(fieldX, top);
    this.customObjectiveInput.position.set(fieldX, top + nameHeight + gap);
    this.customFlowInput.position.set(fieldX, top + nameHeight + objectiveHeight + gap * 2);
    this.customVictoryInput.position.set(fieldX, this.customFlowInput.y + flowHeight + gap);

    const deckPartsHeight = Math.max(150, modalHeight - top - 58 - 82 - gap);
    this.customDeckPartsInput.setSize(fieldWidth, deckPartsHeight);
    this.customCardsInPlayInput.setSize(fieldWidth, 74);
    this.customDeckPartsInput.position.set(fieldX, top);
    this.customCardsInPlayInput.position.set(fieldX, top + deckPartsHeight + gap);

    const detailAvailable = modalHeight - top - 58;
    const setupHeight = Math.max(82, Math.floor(detailAvailable * 0.3));
    const componentsHeight = Math.max(72, Math.floor(detailAvailable * 0.24));
    const variantsHeight = Math.max(82, detailAvailable - setupHeight - componentsHeight - gap * 2);
    this.customSetupInput.setSize(fieldWidth, setupHeight);
    this.customComponentsInput.setSize(fieldWidth, componentsHeight);
    this.customVariantsInput.setSize(fieldWidth, variantsHeight);
    this.customSetupInput.position.set(fieldX, top);
    this.customComponentsInput.position.set(fieldX, top + setupHeight + gap);
    this.customVariantsInput.position.set(fieldX, top + setupHeight + componentsHeight + gap * 2);

    const buttonY = modalHeight - 50;
    const buttonGap = 8;
    const cancelWidth = phone ? 94 : 112;
    this.cancelCustomButton.setSize(cancelWidth, 38);
    this.confirmCustomButton.setSize(phone ? 142 : 166, 38);
    this.confirmCustomButton.position.set(modalWidth - fieldX - (phone ? 142 : 166), buttonY);
    this.cancelCustomButton.position.set(this.confirmCustomButton.x - buttonGap - cancelWidth, buttonY);
    this.applyCustomTabVisibility();

    const editedModule = this.editingModuleId
      ? this.ruleKit.modules.find((module) => module.id === this.editingModuleId)
      : undefined;
    const parameterCount = editedModule?.parameters.length ?? 0;
    const variantCount = editedModule?.content.variants.length ?? 0;
    const moduleWidth = Math.min(590, width - (phone ? 24 : 48));
    const desiredModuleHeight = 158 + parameterCount * 54 + Math.min(variantCount, 3) * 42;
    const moduleHeight = Math.min(Math.max(300, desiredModuleHeight), height - 24);
    this.moduleModal.position.set((width - moduleWidth) / 2, (height - moduleHeight) / 2);
    this.moduleModalBackground
      .clear()
      .roundRect(0, 0, moduleWidth, moduleHeight, 7)
      .fill({ color: COLORS.panel, alpha: 0.99 })
      .stroke({ color: COLORS.gold, width: 1.2, alpha: 0.75 })
      .rect(1, 1, moduleWidth - 2, 64)
      .fill({ color: WOOD, alpha: 0.78 });
    this.moduleModalOrnament
      .clear()
      .moveTo(18, 66)
      .lineTo(moduleWidth - 18, 66)
      .stroke({ color: COLORS.jade, width: 1, alpha: 0.55 });
    this.moduleModalTitle.style.fontSize = phone ? 19 : 22;
    this.moduleModalTitle.position.set(22, 13);
    this.moduleModalSubtitle.position.set(23, 43);
    this.parameterRowsContainer.position.set(22, 80);
    this.variantRowsContainer.position.set(22, 86 + parameterCount * 54);
    this.layoutModuleEditorRows(moduleWidth - 44);
    this.moduleModalCloseButton.setSize(112, 38);
    this.moduleModalCloseButton.position.set(moduleWidth - 134, moduleHeight - 50);

    const plaqueWidth = Math.min(700, width - (phone ? 24 : 48));
    const plaqueHeight = Math.min(406, height - 24);
    this.plaqueModal.position.set((width - plaqueWidth) / 2, (height - plaqueHeight) / 2);
    this.plaqueModalBackground
      .clear()
      .roundRect(0, 0, plaqueWidth, plaqueHeight, 7)
      .fill({ color: COLORS.panel, alpha: 0.99 })
      .stroke({ color: COLORS.cinnabar, width: 1.2, alpha: 0.78 })
      .rect(1, 1, plaqueWidth - 2, 64)
      .fill({ color: WOOD, alpha: 0.8 });
    this.plaqueModalOrnament
      .clear()
      .moveTo(18, 66)
      .lineTo(plaqueWidth - 18, 66)
      .stroke({ color: COLORS.gold, width: 1, alpha: 0.5 });
    this.plaqueModalTitle.style.fontSize = phone ? 18 : 22;
    this.plaqueModalTitle.position.set(22, 13);
    this.plaqueModalSubtitle.position.set(23, 43);
    const plaqueFieldX = phone ? 14 : 22;
    const plaqueGap = phone ? 8 : 12;
    const plaqueFieldWidth = (plaqueWidth - plaqueFieldX * 2 - plaqueGap) / 2;
    const plaqueTop = 78;
    const plaqueRowHeight = 66;
    const plaqueInputs = [
      this.plaqueNameInput,
      this.plaqueStudioInput,
      this.plaqueSignatureInput,
      this.plaqueSealInput,
      this.plaqueEditionInput,
      this.plaqueDedicationInput,
    ];
    plaqueInputs.forEach((input, index) => {
      input.setSize(plaqueFieldWidth, 60);
      input.position.set(
        plaqueFieldX + (index % 2) * (plaqueFieldWidth + plaqueGap),
        plaqueTop + Math.floor(index / 2) * plaqueRowHeight,
      );
    });
    const plaqueButtonY = plaqueHeight - 50;
    this.plaqueCancelButton.setSize(104, 38);
    this.plaqueConfirmButton.setSize(146, 38);
    this.plaqueConfirmButton.position.set(plaqueWidth - plaqueFieldX - 146, plaqueButtonY);
    this.plaqueCancelButton.position.set(this.plaqueConfirmButton.x - plaqueGap - 104, plaqueButtonY);
  }

  private buildTemplateRows(): void {
    for (const mechanicId of MECHANIC_IDS) {
      const template = RULE_MODULE_TEMPLATES[mechanicId];
      const accent = hexToNumber(template.accentHex);
      const root = new Container();
      const background = new Graphics();
      const glyphPlate = new Graphics();
      const glyph = makeText(template.glyph, 14, accent, '700', true);
      const name = makeText(template.name, 12, COLORS.paper, '700', true);
      const summary = makeText(shorten(template.summary, 18), 8, COLORS.paperFaint, '500');
      const addButton = new CanvasButton({
        label: '',
        icon: 'plus',
        iconOnly: true,
        variant: 'ghost',
        accent,
        tooltip: `添加${template.name}（最多 ${MAX_RULE_MODULES} 枚）`,
        onPress: () => this.addTemplateModule(mechanicId),
      });
      glyph.anchor.set(0.5);
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.on('pointertap', () => this.addTemplateModule(mechanicId));
      root.on('pointerover', () => { root.alpha = this.hasModuleCapacity ? 1 : 0.5; });
      root.on('pointerout', () => { root.alpha = this.hasModuleCapacity ? 0.92 : 0.5; });
      attachInteractionHint(root, () => (
        this.hasModuleCapacity ? `添加玩法积木：${template.name}` : MODULE_LIMIT_HINT
      ));
      root.alpha = 0.92;
      root.addChild(background, glyphPlate, glyph, name, summary, addButton);
      this.templateRows.push({ root, background, glyphPlate, glyph, name, summary, addButton, mechanicId });
    }
  }

  private buildComboRows(): void {
    for (const combo of RECOMMENDED_RULE_COMBOS) {
      const root = new Container();
      const background = new Graphics();
      const name = makeText(combo.name, 11, COLORS.paper, '700', true);
      const description = makeText(shorten(combo.description, 22), 8, COLORS.paperFaint, '500');
      const applyButton = new CanvasButton({
        label: '',
        icon: 'check',
        iconOnly: true,
        variant: 'ghost',
        accent: COLORS.gold,
        tooltip: `应用${combo.name}`,
        onPress: () => this.applyCombo(combo.id),
      });
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.on('pointertap', () => this.applyCombo(combo.id));
      root.on('pointerover', () => { root.alpha = 1; });
      root.on('pointerout', () => { root.alpha = 0.92; });
      root.alpha = 0.92;
      attachInteractionHint(root, () => `应用推荐组合：${combo.name}`);
      root.addChild(background, name, description, applyButton);
      this.comboRows.push({ root, background, name, description, applyButton, comboId: combo.id });
    }
  }

  private rebuildStackRows(): void {
    this.stackRowsContainer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.stackRows = [];
    this.stackPage = Math.min(this.stackPage, this.stackPageCount - 1);
    const start = this.stackPage * this.stackPageSize;
    const modules = this.ruleKit.modules.slice(start, start + this.stackPageSize);
    const enabledCount = this.ruleKit.modules.filter((module) => module.enabled).length;
    modules.forEach((module, visibleIndex) => {
      const globalIndex = start + visibleIndex;
      const accent = hexToNumber(module.accentHex);
      const root = new Container();
      const background = new Graphics();
      const orderPlate = new Graphics();
      const order = makeText(String(globalIndex + 1).padStart(2, '0'), 9, accent, '700');
      const name = makeText(module.name, 13, COLORS.paper, '700', true);
      const summary = makeText(module.summary, 10, COLORS.paperMuted, '500');
      const editButton = new CanvasButton({
        label: '',
        icon: module.source === 'custom' ? 'pen-line' : 'settings',
        iconOnly: true,
        variant: 'ghost',
        accent,
        tooltip: module.source === 'custom' ? '编辑自定义积木' : '调整积木参数与变体',
        onPress: () => this.openModuleEditor(module.id),
      });
      const toggleButton = new CanvasButton({
        label: '',
        icon: module.enabled ? 'circle-check' : 'circle',
        iconOnly: true,
        variant: 'ghost',
        accent,
        selected: module.enabled,
        disabled: module.enabled && enabledCount <= 1,
        tooltip: module.enabled && enabledCount <= 1
          ? '至少保留一枚启用的玩法积木'
          : module.enabled ? '停用积木' : '启用积木',
        onPress: () => this.toggleModule(module.id),
      });
      const upButton = new CanvasButton({
        label: '',
        icon: 'chevron-down',
        iconOnly: true,
        variant: 'ghost',
        tooltip: '上移',
        disabled: globalIndex === 0,
        onPress: () => this.moveModule(module.id, -1),
      });
      const downButton = new CanvasButton({
        label: '',
        icon: 'chevron-down',
        iconOnly: true,
        variant: 'ghost',
        tooltip: '下移',
        disabled: globalIndex >= this.ruleKit.modules.length - 1,
        onPress: () => this.moveModule(module.id, 1),
      });
      const removeButton = new CanvasButton({
        label: '',
        icon: 'trash-2',
        iconOnly: true,
        variant: 'danger',
        tooltip: this.ruleKit.modules.length <= 1 ? '规则栈至少保留一枚积木' : '移除积木',
        disabled: this.ruleKit.modules.length <= 1,
        onPress: () => this.removeModule(module.id),
      });
      order.anchor.set(0.5);
      root.addChild(
        background,
        orderPlate,
        order,
        name,
        summary,
        editButton,
        toggleButton,
        upButton,
        downButton,
        removeButton,
      );
      this.stackRowsContainer.addChild(root);
      this.stackRows.push({
        root,
        background,
        orderPlate,
        order,
        name,
        summary,
        editButton,
        toggleButton,
        upButton,
        downButton,
        removeButton,
        module,
        globalIndex,
      });
    });
    this.pageText.text = `${this.stackPage + 1} / ${this.stackPageCount}`;
  }

  private get stackPageCount(): number {
    return Math.max(1, Math.ceil(this.ruleKit.modules.length / this.stackPageSize));
  }

  private get hasModuleCapacity(): boolean {
    return this.ruleKit.modules.length < MAX_RULE_MODULES;
  }

  private refreshModuleLimitControls(): void {
    const atLimit = !this.hasModuleCapacity;
    this.customButton.setDisabled(atLimit);
    for (const row of this.templateRows) {
      row.addButton.setDisabled(atLimit);
      row.root.cursor = atLimit ? 'not-allowed' : 'pointer';
      row.root.alpha = atLimit ? 0.5 : 0.92;
    }
  }

  private addTemplateModule(mechanicId: GameplayMechanicId): void {
    if (!this.hasModuleCapacity) {
      announce(MODULE_LIMIT_HINT);
      return;
    }
    const instance = createRuleModule(
      mechanicId,
      `${mechanicId}-${Date.now().toString(36)}-${++this.customSerial}`,
    );
    const componentKit = createRuleKit(this.ruleKit.title, [mechanicId]);
    this.commitRuleKit(
      {
        ...this.ruleKit,
        components: unique([...this.ruleKit.components, ...componentKit.components]),
        modules: [...this.ruleKit.modules, instance],
      },
      `已添加${instance.name}`,
      true,
    );
  }

  private applyCombo(comboId: string): void {
    const combo = RECOMMENDED_RULE_COMBOS.find((candidate) => candidate.id === comboId);
    if (!combo) return;
    const next = createRuleKitFromCombo(comboId, this.ruleKit.title);
    next.playerRange = { ...this.ruleKit.playerRange };
    next.durationMinutes = { ...this.ruleKit.durationMinutes };
    next.ageFrom = this.ruleKit.ageFrom;
    next.customNotes = [...this.ruleKit.customNotes];
    this.stackPage = 0;
    this.commitRuleKit(next, `已应用推荐组合：${combo.name}`);
  }

  private saveCustomModule(): void {
    const name = this.customNameValue.trim();
    const objective = this.customObjectiveValue.trim();
    const setup = this.customSetupValue.trim();
    const flow = this.customFlowValue.trim();
    const victory = this.customVictoryValue.trim();
    const components = listItems(this.customComponentsValue);
    const variants = parseCustomVariants(this.customVariantsValue);
    const deckParts = parseCustomDeckParts(this.customDeckPartsValue);
    const editingId = this.editingCustomModuleId;
    if (!editingId && !this.hasModuleCapacity) {
      announce(MODULE_LIMIT_HINT);
      return;
    }
    if (!deckParts.ok) {
      this.customModalTab = 'deck';
      this.customTabs.setValue('deck');
      this.applyCustomTabVisibility();
      announce(deckParts.error);
      return;
    }
    const cardsInPlay = Number(this.customCardsInPlayValue.trim());
    const minimumCardsInPlay = Math.min(MIN_CUSTOM_SESSION_CARDS, deckParts.totalCards);
    if (!Number.isSafeInteger(cardsInPlay) || cardsInPlay < minimumCardsInPlay || cardsInPlay > deckParts.totalCards) {
      this.customModalTab = 'deck';
      this.customTabs.setValue('deck');
      this.applyCustomTabVisibility();
      announce(`标准单局投入需为 ${minimumCardsInPlay}–${deckParts.totalCards} 张。`);
      return;
    }
    const module = createCustomRuleModule({
      id: editingId,
      name: name || '我的原创机制',
      summary: objective ? shorten(objective, 32) : '由创作者定义的原创互动规则。',
      glyph: name ? Array.from(name)[0] : '创',
      accentHex: '#c84f3d',
      tags: ['原创', '自定义'],
      deckParts: formatCustomDeckParts(deckParts.parts),
      cardsInPlay,
      content: {
        objective: objective ? [objective] : ['完成创作者设定的原创挑战。'],
        setup: setup
          ? instructionLines(setup)
          : ['准备本套牌与创作者标注的必要组件，并决定起始玩家。'],
        flow: instructionLines(flow),
        victory: victory ? [victory] : ['完成目标后比较得分，由分数最高者获胜。'],
        variants,
      },
    });
    this.closeCustomModal();
    const modules = editingId
      ? this.ruleKit.modules.map((candidate) => (candidate.id === editingId ? module : candidate))
      : [...this.ruleKit.modules, module];
    this.commitRuleKit(
      {
        ...this.ruleKit,
        components: editingId
          ? components.length
            ? components
            : ['本套装卡牌']
          : unique([
              ...this.ruleKit.components,
              ...(components.length ? components : ['创作者自定义组件']),
            ]),
        modules,
      },
      editingId ? `原创积木${module.name}已更新` : `原创积木${module.name}已加入规则栈`,
      !editingId,
    );
  }

  private toggleModule(id: string): void {
    const module = this.ruleKit.modules.find((candidate) => candidate.id === id);
    if (!module) return;
    if (module.enabled && this.ruleKit.modules.filter((candidate) => candidate.enabled).length <= 1) {
      announce('至少保留一枚启用的玩法积木。');
      return;
    }
    const modules = this.ruleKit.modules.map((candidate) =>
      candidate.id === id ? { ...candidate, enabled: !candidate.enabled } : candidate,
    );
    this.commitRuleKit(
      { ...this.ruleKit, modules },
      `${module.name}已${module.enabled ? '停用' : '启用'}`,
    );
  }

  private moveModule(id: string, direction: -1 | 1): void {
    const index = this.ruleKit.modules.findIndex((module) => module.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this.ruleKit.modules.length) return;
    const modules = [...this.ruleKit.modules];
    [modules[index], modules[target]] = [modules[target], modules[index]];
    this.stackPage = Math.floor(target / this.stackPageSize);
    this.commitRuleKit({ ...this.ruleKit, modules }, `${modules[target].name}已${direction < 0 ? '上移' : '下移'}`);
  }

  private removeModule(id: string): void {
    if (this.ruleKit.modules.length <= 1) return;
    const module = this.ruleKit.modules.find((candidate) => candidate.id === id);
    const modules = this.ruleKit.modules.filter((candidate) => candidate.id !== id);
    this.stackPage = Math.min(this.stackPage, Math.max(0, Math.ceil(modules.length / this.stackPageSize) - 1));
    this.commitRuleKit({ ...this.ruleKit, modules }, `已移除${module?.name ?? '玩法积木'}`);
  }

  private cyclePlayers(): void {
    const enabled = this.ruleKit.modules.filter((module) => module.enabled);
    const requiredPlayers = enabled.some((module) => module.templateId === 'icon-coop')
      ? 3
      : enabled.some((module) => module.templateId !== undefined) ? 2 : 1;
    const presets = [
      { min: 1, max: 4 },
      { min: 2, max: 4 },
      { min: 2, max: 6 },
      { min: 3, max: 4 },
      { min: 3, max: 6 },
      { min: 3, max: 8 },
    ].filter((preset) => preset.min >= requiredPlayers);
    const index = presets.findIndex(
      (preset) => preset.min === this.ruleKit.playerRange.min && preset.max === this.ruleKit.playerRange.max,
    );
    const next = presets[(index + 1) % presets.length];
    this.commitRuleKit({ ...this.ruleKit, playerRange: { ...next } }, `玩家人数调整为${next.min}-${next.max}人`);
  }

  private cycleDuration(): void {
    const presets = [
      { min: 10, max: 20 },
      { min: 15, max: 30 },
      { min: 30, max: 45 },
      { min: 45, max: 60 },
    ];
    const index = presets.findIndex(
      (preset) =>
        preset.min === this.ruleKit.durationMinutes.min && preset.max === this.ruleKit.durationMinutes.max,
    );
    const next = presets[(index + 1) % presets.length];
    this.commitRuleKit({ ...this.ruleKit, durationMinutes: { ...next } }, `游戏时长调整为${next.min}-${next.max}分钟`);
  }

  private cycleAge(): void {
    const presets = [6, 8, 10, 12, 14];
    const index = presets.indexOf(this.ruleKit.ageFrom);
    const next = presets[(index + 1) % presets.length];
    this.commitRuleKit({ ...this.ruleKit, ageFrom: next }, `建议年龄调整为${next}岁以上`);
  }

  private toggleTeamMode(): void {
    const teamMode = !this.ruleKit.teamMode;
    this.commitRuleKit(
      { ...this.ruleKit, teamMode },
      teamMode ? '已启用组队协作模式' : '已切换为自由对局模式',
    );
  }

  private refreshMetaLabels(): void {
    this.playerButton.setLabel(`${this.ruleKit.playerRange.min}-${this.ruleKit.playerRange.max}人`);
    const duration = this.ruleKit.durationMinutes;
    this.durationButton.setLabel(
      `${duration.min === duration.max ? duration.min : `${duration.min}-${duration.max}`}分`,
    );
    this.ageButton.setLabel(`${this.ruleKit.ageFrom}岁+`);
    this.teamButton.setLabel(this.ruleKit.teamMode ? '组队' : '自由');
    this.teamButton.setSelected(this.ruleKit.teamMode);
  }

  private changeStackPage(delta: number): void {
    const next = Math.max(0, Math.min(this.stackPageCount - 1, this.stackPage + delta));
    if (next === this.stackPage) return;
    this.stackPage = next;
    this.rebuildStackRows();
    if (this.viewport) this.layoutStackPanel(this.stackPanelWidth, this.stackPanelHeight, this.viewport.phone);
  }

  private get stackPanelWidth(): number {
    if (!this.viewport) return 320;
    if (this.viewport.phone) return this.viewport.width - 28;
    const available = this.viewport.width - 40 - 24;
    return Math.min(372, Math.max(296, available * 0.315));
  }

  private get stackPanelHeight(): number {
    if (!this.viewport) return 480;
    return Math.max(318, this.viewport.height - (this.viewport.phone ? 154 : 132) - (this.viewport.phone ? 12 : 16));
  }

  private commitRuleKit(next: RuleKit, message: string, revealLast = false): void {
    this.ruleKit = next;
    this.refreshModuleLimitControls();
    if (revealLast) this.stackPage = Math.max(0, Math.ceil(next.modules.length / this.stackPageSize) - 1);
    this.deck = applyRuleKitToDeck(this.deck, next);
    this.deck = this.onDeckChange(this.deck);
    this.rebuildStackRows();
    this.updateBookPreview();
    if (this.viewport) this.layout(this.viewport);
    announce(message);
  }

  private updateBookPreview(): void {
    this.ruleBook = generateRuleBook(this.deck);
    this.scrollTitle.text = this.ruleBook.title;
    this.scrollMeta.text = `${this.ruleBook.audience} · ${this.ruleBook.duration}`;
    const plaque = this.deck.creatorPlaque;
    const creator = plaque?.displayName?.trim() || this.deck.author || '佚名';
    this.plaqueName.text = shorten(creator, 14);
    this.plaqueMeta.text = shorten(
      [plaque?.studioName, plaque?.edition, plaque?.serialNumber].filter(Boolean).join(' · ') || '原创卡牌模组',
      34,
    );
    this.plaqueSealText.text = formatSeal(plaque?.sealText || plaque?.signatureText || creator);
    this.deckLabel.text = `${shorten(this.deck.name, 34)} · ${this.ruleKit.modules.length} 枚积木`;
  }

  private composePreviewText(phone: boolean): string {
    const book = this.ruleBook;
    if (phone) {
      const flow = book.flow.map((step) => step.instruction).join('；');
      const variants = book.variants.map((variant) => variant.name).join('、');
      return [
        `目标｜${shorten(book.objective[0] ?? '完成原创挑战', 18)}`,
        `设置｜${shorten(book.setup[0] ?? '准备套牌与标记', 18)}`,
        `流程｜${shorten(flow || '依规则栈顺序结算', 18)}`,
        `胜负｜${shorten(book.victory[0] ?? '完成目标者获胜', 18)}`,
        `变体｜${shorten(variants || '暂未启用', 18)}`,
      ].join('\n');
    }

    const flow = book.flow.slice(0, 3).map(
      (step, index) => `${index + 1}. ${shorten(`${step.moduleName}：${step.instruction}`, 34)}`,
    );
    const variants = book.variants.slice(0, 3).map((variant) => variant.name).join('、');
    return [
      `【目标】${shorten(book.objective[0] ?? '完成原创挑战', 38)}`,
      `【设置】${shorten(book.setup[0] ?? '准备套牌与标记', 38)}`,
      '【流程】',
      ...flow,
      `【胜负】${shorten(book.victory[0] ?? '完成目标者获胜', 38)}`,
      `【进阶变体】${shorten(variants || '暂未启用', 34)}`,
    ].join('\n');
  }

  private openCustomModal(moduleId?: string): void {
    const module = moduleId
      ? this.ruleKit.modules.find((candidate) => candidate.id === moduleId && candidate.source === 'custom')
      : undefined;
    if (!module && !this.hasModuleCapacity) {
      announce(MODULE_LIMIT_HINT);
      return;
    }
    this.editingCustomModuleId = module?.id;
    this.modalTitle.text = module ? '编辑原创玩法积木' : '自定义玩法积木';
    this.confirmCustomButton.setLabel(module ? '保存积木' : '加入规则栈');
    this.customModalTab = 'core';
    this.customTabs.setValue('core');
    const customComposition = module ? resolveCustomDeckComposition(module) : undefined;
    const storedDeckParts = module?.parameters.find(
      (parameter) => parameter.id === CUSTOM_DECK_PARTS_PARAMETER_ID,
    )?.value;
    const storedCardsInPlay = module?.parameters.find(
      (parameter) => parameter.id === CUSTOM_CARDS_IN_PLAY_PARAMETER_ID,
    )?.value;

    const values = {
      name: module?.name ?? '',
      objective: module?.content.objective.join('；') ?? '',
      setup: module?.content.setup.join('；') ?? '',
      flow: module?.content.flow.join('\n') ?? '',
      victory: module?.content.victory.join('；') ?? '',
      deckParts: typeof storedDeckParts === 'string'
        ? storedDeckParts
        : customComposition
          ? formatCustomDeckParts(customComposition.parts)
          : DEFAULT_CUSTOM_DECK_PARTS_TEXT,
      cardsInPlay: String(
        typeof storedCardsInPlay === 'number'
          ? storedCardsInPlay
          : customComposition?.cardsInPlay ?? 24,
      ),
      components: module ? this.ruleKit.components.join('、') : '',
      variants:
        module?.content.variants.map((variant) => `${variant.name}：${variant.description}`).join('\n') ?? '',
    };
    this.customNameValue = values.name;
    this.customObjectiveValue = values.objective;
    this.customSetupValue = values.setup;
    this.customFlowValue = values.flow;
    this.customVictoryValue = values.victory;
    this.customDeckPartsValue = values.deckParts;
    this.customCardsInPlayValue = values.cardsInPlay;
    this.customComponentsValue = values.components;
    this.customVariantsValue = values.variants;
    this.customNameInput.setValue(values.name);
    this.customObjectiveInput.setValue(values.objective);
    this.customSetupInput.setValue(values.setup);
    this.customFlowInput.setValue(values.flow);
    this.customVictoryInput.setValue(values.victory);
    this.customDeckPartsInput.setValue(values.deckParts);
    this.customCardsInPlayInput.setValue(values.cardsInPlay);
    this.customComponentsInput.setValue(values.components);
    this.customVariantsInput.setValue(values.variants);

    this.modalOverlay.visible = true;
    this.customModal.visible = true;
    this.moduleModal.visible = false;
    this.plaqueModal.visible = false;
    this.applyCustomTabVisibility();
    if (this.viewport) this.layoutModal(this.viewport);
    announce(module ? `正在编辑${module.name}` : '已打开自定义玩法积木编辑器');
  }

  private closeCustomModal(): void {
    for (const input of [
      this.customNameInput,
      this.customObjectiveInput,
      this.customSetupInput,
      this.customFlowInput,
      this.customVictoryInput,
      this.customDeckPartsInput,
      this.customCardsInPlayInput,
      this.customComponentsInput,
      this.customVariantsInput,
    ]) {
      input.blur();
    }
    this.modalOverlay.visible = false;
    this.customModal.visible = false;
    this.editingCustomModuleId = undefined;
  }

  private applyCustomTabVisibility(): void {
    const core = this.customModalTab === 'core';
    const deck = this.customModalTab === 'deck';
    const details = this.customModalTab === 'details';
    this.customNameInput.visible = core;
    this.customObjectiveInput.visible = core;
    this.customFlowInput.visible = core;
    this.customVictoryInput.visible = core;
    this.customDeckPartsInput.visible = deck;
    this.customCardsInPlayInput.visible = deck;
    this.customSetupInput.visible = details;
    this.customComponentsInput.visible = details;
    this.customVariantsInput.visible = details;
  }

  private openModuleEditor(moduleId: string): void {
    const module = this.ruleKit.modules.find((candidate) => candidate.id === moduleId);
    if (!module) return;
    if (module.source === 'custom') {
      this.openCustomModal(module.id);
      return;
    }
    this.editingModuleId = module.id;
    this.moduleModalTitle.text = `${module.glyph} · ${module.name}`;
    this.rebuildModuleEditorRows();
    this.modalOverlay.visible = true;
    this.customModal.visible = false;
    this.plaqueModal.visible = false;
    this.moduleModal.visible = true;
    if (this.viewport) this.layoutModal(this.viewport);
    announce(`正在调整${module.name}的参数与变体`);
  }

  private closeModuleModal(): void {
    this.moduleModal.visible = false;
    this.modalOverlay.visible = false;
    this.editingModuleId = undefined;
  }

  private rebuildModuleEditorRows(): void {
    this.parameterRowsContainer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.variantRowsContainer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.parameterRows = [];
    this.variantRows = [];
    const module = this.editingModuleId
      ? this.ruleKit.modules.find((candidate) => candidate.id === this.editingModuleId)
      : undefined;
    if (!module) return;

    for (const parameter of module.parameters) {
      const root = new Container();
      const label = makeText(parameter.label, 12, COLORS.paper, '600');
      const value = makeText(parameterValueLabel(parameter), 12, COLORS.gold, '700');
      value.anchor.set(0.5);
      const row: ParameterEditorRow = { root, label, value };
      root.addChild(label, value);
      if (parameter.control === 'stepper') {
        row.previousButton = new CanvasButton({
          label: '',
          icon: 'minus',
          iconOnly: true,
          variant: 'secondary',
          accent: hexToNumber(module.accentHex),
          tooltip: `减少${parameter.label}`,
          onPress: () => this.stepModuleParameter(module.id, parameter.id, -1),
        });
        row.nextButton = new CanvasButton({
          label: '',
          icon: 'plus',
          iconOnly: true,
          variant: 'secondary',
          accent: hexToNumber(module.accentHex),
          tooltip: `增加${parameter.label}`,
          onPress: () => this.stepModuleParameter(module.id, parameter.id, 1),
        });
        root.addChild(row.previousButton, row.nextButton);
      } else {
        row.valueButton = new CanvasButton({
          label: parameterValueLabel(parameter),
          variant: 'secondary',
          accent: hexToNumber(module.accentHex),
          selected: parameter.control === 'toggle' && Boolean(parameter.value),
          tooltip: `切换${parameter.label}`,
          onPress: () => this.cycleModuleParameter(module.id, parameter.id),
        });
        value.visible = false;
        root.addChild(row.valueButton);
      }
      this.parameterRowsContainer.addChild(root);
      this.parameterRows.push(row);
    }

    for (const variant of module.content.variants) {
      const root = new Container();
      const label = makeText(variant.name, 11, COLORS.paper, '600');
      const value = makeText('', 10, COLORS.paperMuted, '500');
      const enabled = variant.enabled === true;
      const valueButton = new CanvasButton({
        label: enabled ? '纳入说明书' : '暂不采用',
        icon: enabled ? 'circle-check' : 'circle',
        variant: 'ghost',
        accent: hexToNumber(module.accentHex),
        selected: enabled,
        tooltip: `切换变体：${variant.name}`,
        onPress: () => this.toggleModuleVariant(module.id, variant.id),
      });
      root.addChild(label, valueButton);
      this.variantRowsContainer.addChild(root);
      this.variantRows.push({ root, label, value, valueButton });
    }
  }

  private layoutModuleEditorRows(width: number): void {
    for (const [index, row] of this.parameterRows.entries()) {
      row.root.position.set(0, index * 54);
      row.label.position.set(0, 16);
      if (row.previousButton && row.nextButton) {
        row.previousButton.setSize(34, 34);
        row.nextButton.setSize(34, 34);
        row.previousButton.position.set(width - 122, 6);
        row.nextButton.position.set(width - 34, 6);
        row.value.position.set(width - 61, 23);
      } else if (row.valueButton) {
        const buttonWidth = Math.min(260, Math.max(128, width - 148));
        row.valueButton.setSize(buttonWidth, 36);
        row.valueButton.position.set(width - buttonWidth, 5);
      }
    }
    for (const [index, row] of this.variantRows.entries()) {
      row.root.position.set(0, index * 42);
      row.label.position.set(0, 12);
      if (row.valueButton) {
        row.valueButton.setSize(Math.min(164, Math.max(122, width * 0.34)), 34);
        row.valueButton.position.set(width - row.valueButton.width, 4);
      }
    }
  }

  private stepModuleParameter(moduleId: string, parameterId: string, direction: -1 | 1): void {
    const module = this.ruleKit.modules.find((candidate) => candidate.id === moduleId);
    const parameter = module?.parameters.find((candidate) => candidate.id === parameterId);
    if (!module || !parameter || typeof parameter.value !== 'number') return;
    const step = parameter.step ?? 1;
    const min = parameter.min ?? Number.MIN_SAFE_INTEGER;
    const max = parameter.max ?? Number.MAX_SAFE_INTEGER;
    const value = Math.min(max, Math.max(min, parameter.value + step * direction));
    if (value === parameter.value) return;
    this.updateModuleParameter(moduleId, parameterId, value, `${parameter.label}调整为${value}${parameter.unit ?? ''}`);
  }

  private cycleModuleParameter(moduleId: string, parameterId: string): void {
    const module = this.ruleKit.modules.find((candidate) => candidate.id === moduleId);
    const parameter = module?.parameters.find((candidate) => candidate.id === parameterId);
    if (!module || !parameter) return;
    if (parameter.control === 'toggle') {
      this.updateModuleParameter(moduleId, parameterId, !Boolean(parameter.value), `${parameter.label}已切换`);
      return;
    }
    const choices = parameter.choices ?? [];
    if (!choices.length) return;
    const index = choices.findIndex((choice) => choice.value === String(parameter.value));
    const choice = choices[(index + 1) % choices.length];
    this.updateModuleParameter(moduleId, parameterId, choice.value, `${parameter.label}调整为${choice.label}`);
  }

  private updateModuleParameter(
    moduleId: string,
    parameterId: string,
    value: RuleParameter['value'],
    message: string,
  ): void {
    const modules = this.ruleKit.modules.map((module) =>
      module.id === moduleId
        ? {
            ...module,
            parameters: module.parameters.map((parameter) =>
              parameter.id === parameterId ? { ...parameter, value } : parameter,
            ),
          }
        : module,
    );
    this.commitRuleKit({ ...this.ruleKit, modules }, message);
    this.rebuildModuleEditorRows();
    if (this.viewport) this.layoutModal(this.viewport);
  }

  private toggleModuleVariant(moduleId: string, variantId: string): void {
    const modules = this.ruleKit.modules.map((module) =>
      module.id === moduleId
        ? {
            ...module,
            content: {
              ...module.content,
              variants: module.content.variants.map((variant) =>
                variant.id === variantId ? { ...variant, enabled: !variant.enabled } : variant,
              ),
            },
          }
        : module,
    );
    this.commitRuleKit({ ...this.ruleKit, modules }, '进阶变体设置已更新');
    this.rebuildModuleEditorRows();
    if (this.viewport) this.layoutModal(this.viewport);
  }

  private openPlaqueModal(): void {
    const plaque = this.deck.creatorPlaque;
    const creator = plaque?.displayName || this.deck.author;
    this.plaqueNameInput.setValue(creator);
    this.plaqueStudioInput.setValue(plaque?.studioName || '');
    this.plaqueSignatureInput.setValue(plaque?.signatureText || creator);
    this.plaqueSealInput.setValue(plaque?.sealText || `${creator}制`);
    this.plaqueEditionInput.setValue(plaque?.edition || '初刻版');
    this.plaqueDedicationInput.setValue(plaque?.dedication || '');
    this.modalOverlay.visible = true;
    this.customModal.visible = false;
    this.moduleModal.visible = false;
    this.plaqueModal.visible = true;
    if (this.viewport) this.layoutModal(this.viewport);
    announce('已打开创作者铭牌与艺术签名编辑器');
  }

  private closePlaqueModal(): void {
    for (const input of [
      this.plaqueNameInput,
      this.plaqueStudioInput,
      this.plaqueSignatureInput,
      this.plaqueSealInput,
      this.plaqueEditionInput,
      this.plaqueDedicationInput,
    ]) {
      input.blur();
    }
    this.plaqueModal.visible = false;
    this.modalOverlay.visible = false;
  }

  private saveCreatorPlaque(): void {
    const previousAuthor = this.deck.author;
    const displayName = this.plaqueNameInput.value.trim() || previousAuthor || '佚名';
    const signatureText = this.plaqueSignatureInput.value.trim() || displayName;
    this.deck = {
      ...this.deck,
      author: displayName,
      cards: this.deck.cards.map((card) =>
        card.author === previousAuthor
          ? {
              ...card,
              author: displayName,
              inscriptionText:
                !card.inscriptionText || card.inscriptionText === previousAuthor
                  ? signatureText
                  : card.inscriptionText,
            }
          : card,
      ),
      creatorPlaque: {
        ...this.deck.creatorPlaque,
        displayName,
        studioName: this.plaqueStudioInput.value.trim() || undefined,
        signatureText,
        sealText: this.plaqueSealInput.value.trim() || `${displayName}制`,
        edition: this.plaqueEditionInput.value.trim() || undefined,
        serialNumber:
          this.deck.creatorPlaque?.serialNumber || `AD-${this.deck.id.slice(-8).toUpperCase()}`,
        dedication: this.plaqueDedicationInput.value.trim() || undefined,
      },
    };
    this.deck = this.onDeckChange(this.deck);
    this.updateBookPreview();
    if (this.viewport) this.layout(this.viewport);
    this.closePlaqueModal();
    announce('创作者铭牌与艺术签名已篆刻到套牌');
  }

  private applySectionVisibility(): void {
    const phone = this.viewport?.phone ?? false;
    this.libraryPanel.visible = !phone || this.mobileSection === 'blocks';
    this.stackPanel.visible = !phone || this.mobileSection === 'stack';
    this.previewPanel.visible = !phone || this.mobileSection === 'book';
  }

  private tick = (ticker: Ticker): void => {
    if (this.reducedMotion) return;
    this.elapsed += Math.min(50, ticker.deltaMS) / 1000;
    this.aura.x = Math.sin(this.elapsed * 0.42) * 8;
    this.aura.alpha = 0.55 + Math.sin(this.elapsed * 1.15) * 0.28;
    this.scrollRods.alpha = 0.82 + Math.sin(this.elapsed * 0.72) * 0.12;
  };

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    Ticker.shared.remove(this.tick);
    super.destroy(options ?? { children: true });
  }
}
