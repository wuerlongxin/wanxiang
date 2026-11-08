import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CardView } from '../card-view';
import { TopBar } from '../chrome';
import { createStarterCard, MODE_BY_ID } from '../data';
import { describeDeckComposition } from '../deck-composition';
import { renderDeckRules } from '../rules';
import {
  deckFamilyId,
  deckVersionKey,
  describeRevision,
  shortDeckCid,
} from '../services/deck-identity';
import { COLORS, DISPLAY_FONT, FONT_FAMILY } from '../theme';
import type { DeckData, Viewport } from '../types';
import { CanvasButton, IconSprite, SegmentedControl } from '../ui';
import { attachInteractionHint } from '../interaction-hints';
import {
  LIBRARY_ROWS_TOP,
  getLibraryPageSize,
  getLibraryRowLayout,
} from './library-layout';

type LibraryFilter = 'all' | 'created' | 'received';

interface LibrarySceneOptions {
  decks: DeckData[];
  activeDeckKey: string | null;
  onHome: () => void;
  onStudio: () => void;
  onRules: () => void;
  onExchange: () => void;
  onBattle: () => void;
  onOpen: (deck: DeckData) => void;
  onShowcase: (deck: DeckData) => void;
  onExport: (deck: DeckData) => void;
  onProjectExport: (deck: DeckData) => void;
  onProjectImport: () => void;
}

interface LibraryRow {
  root: Container;
  background: Graphics;
  separator: Graphics;
  card: CardView;
  name: Text;
  meta: Text;
  source: Text;
  showcase: CanvasButton;
  open: CanvasButton;
  deck: DeckData;
  nameValue: string;
  metaValue: string;
  sourceValue: string;
}

function shortPeerId(value: string): string {
  return value.length <= 17 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function fitTextWidth(text: Text, value: string, maxWidth: number): void {
  text.text = value;
  if (text.width <= maxWidth) return;
  const characters = Array.from(value);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    text.text = `${characters.slice(0, midpoint).join('')}…`;
    if (text.width <= maxWidth) low = midpoint;
    else high = midpoint - 1;
  }
  text.text = `${characters.slice(0, low).join('')}…`;
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
    text.text = `${characters.slice(0, midpoint).join('').trimEnd()}…`;
    if (text.height <= maxHeight) low = midpoint;
    else high = midpoint - 1;
  }
  text.text = `${characters.slice(0, low).join('').trimEnd()}…`;
}

export class LibraryScene extends Container {
  private readonly decks: DeckData[];
  private readonly onOpen: (deck: DeckData) => void;
  private readonly onShowcase: (deck: DeckData) => void;
  private readonly onExport: (deck: DeckData) => void;
  private readonly onProjectExport: (deck: DeckData) => void;
  private readonly chrome: TopBar;
  private readonly header = new Container();
  private readonly title = new Text({
    text: '本地作品库',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 29,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly kicker = new Text({
    text: 'LOCAL DECK ARCHIVE',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      fill: COLORS.jade,
      letterSpacing: 0,
    }),
  });
  private readonly countText = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '600',
      fill: COLORS.paperFaint,
      letterSpacing: 0,
    }),
  });
  private readonly filterControl: SegmentedControl<LibraryFilter>;
  private readonly saveProjectButton: CanvasButton;
  private readonly importProjectButton: CanvasButton;

  private readonly listBand = new Container();
  private readonly listBg = new Graphics();
  private readonly listTitle = new Text({
    text: '套牌清单',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 18,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly rows = new Container();
  private readonly emptyList = new Text({
    text: '此分类暂无作品',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 12,
      fontWeight: '500',
      fill: COLORS.paperFaint,
      letterSpacing: 0,
    }),
  });
  private readonly previousButton: CanvasButton;
  private readonly nextButton: CanvasButton;
  private readonly pageText = new Text({
    text: '1 / 1',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '700',
      fill: COLORS.paperMuted,
      letterSpacing: 0,
    }),
  });
  private rowViews: LibraryRow[] = [];

  private readonly previewCard = new CardView(createStarterCard('strategy'), 220);
  private readonly detail = new Container();
  private readonly deckName = new Text({ text: '' });
  private readonly deckTheme = new Text({ text: '' });
  private readonly sourceText = new Text({ text: '' });
  private readonly metaText = new Text({ text: '' });
  private readonly storyText = new Text({ text: '' });
  private readonly rulesText = new Text({ text: '' });
  private readonly showcaseButton: CanvasButton;
  private readonly openButton: CanvasButton;
  private readonly exportButton: CanvasButton;
  private readonly emptyPreview = new Container();
  private readonly emptyPreviewIcon = new IconSprite('library', 34, COLORS.paperFaint);
  private readonly emptyPreviewText = new Text({
    text: '尚无本地作品',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 13,
      fontWeight: '600',
      fill: COLORS.paperFaint,
      letterSpacing: 0,
    }),
  });

  private filter: LibraryFilter = 'all';
  private readonly activeDeckKey: string | null;
  private selectedKey: string | null;
  private page = 0;
  private pageSize = 5;
  private viewport?: Viewport;

  constructor(options: LibrarySceneOptions) {
    super();
    this.decks = options.decks;
    this.onOpen = options.onOpen;
    this.onShowcase = options.onShowcase;
    this.onExport = options.onExport;
    this.onProjectExport = options.onProjectExport;
    this.activeDeckKey = this.decks.some((deck) => deckVersionKey(deck) === options.activeDeckKey)
      ? options.activeDeckKey
      : null;
    this.selectedKey = this.decks.some((deck) => deckVersionKey(deck) === options.activeDeckKey)
      ? options.activeDeckKey
      : this.decks[0] ? deckVersionKey(this.decks[0]) : null;
    const initialIndex = this.decks.findIndex(
      (deck) => deckVersionKey(deck) === this.selectedKey,
    );
    if (initialIndex >= 0) this.page = Math.floor(initialIndex / this.pageSize);
    this.chrome = new TopBar({
      current: 'library',
      onHome: options.onHome,
      onNavigate: (scene) => {
        if (scene === 'studio') options.onStudio();
        if (scene === 'rules') options.onRules();
        if (scene === 'exchange') options.onExchange();
        if (scene === 'battle') options.onBattle();
      },
      onExport: this.decks.length ? () => this.exportSelected() : undefined,
    });
    this.filterControl = new SegmentedControl<LibraryFilter>({
      items: [
        { value: 'all', label: '全部' },
        { value: 'created', label: '我的创作' },
        { value: 'received', label: '交换所得' },
      ],
      value: this.filter,
      accent: COLORS.jade,
      onChange: (value) => {
        this.filter = value;
        this.page = 0;
        const filtered = this.filteredDecks;
        if (!filtered.some((deck) => deckVersionKey(deck) === this.selectedKey)) {
          this.selectedKey = filtered[0] ? deckVersionKey(filtered[0]) : null;
          this.updatePreview();
        }
        this.rebuildRows();
        if (this.viewport) this.layout(this.viewport);
      },
    });
    this.saveProjectButton = new CanvasButton({
      label: '另存工程',
      icon: 'save',
      iconOnly: true,
      tooltip: '将当前套牌另存为单文件工程，可选择保存位置',
      variant: 'secondary',
      accent: COLORS.gold,
      onPress: () => this.saveSelectedProject(),
    });
    this.importProjectButton = new CanvasButton({
      label: '加载工程',
      icon: 'upload',
      iconOnly: true,
      tooltip: '从本机导入套牌工程，可选择文件位置',
      variant: 'secondary',
      accent: COLORS.jade,
      onPress: () => options.onProjectImport(),
    });
    this.previousButton = new CanvasButton({
      label: '',
      icon: 'arrow-left',
      iconOnly: true,
      tooltip: '上一页',
      variant: 'ghost',
      onPress: () => this.changePage(-1),
    });
    this.nextButton = new CanvasButton({
      label: '',
      icon: 'arrow-right',
      iconOnly: true,
      tooltip: '下一页',
      variant: 'ghost',
      onPress: () => this.changePage(1),
    });
    this.openButton = new CanvasButton({
      label: '在设计台打开',
      icon: 'wand-sparkles',
      variant: 'primary',
      onPress: () => this.openSelected(),
    });
    this.showcaseButton = new CanvasButton({
      label: '牌组展览',
      icon: 'eye',
      variant: 'primary',
      accent: COLORS.gold,
      onPress: () => this.showcaseSelected(),
    });
    this.exportButton = new CanvasButton({
      label: '印刷导出',
      icon: 'download',
      variant: 'secondary',
      onPress: () => this.exportSelected(),
    });

    this.header.addChild(
      this.title,
      this.kicker,
      this.countText,
      this.saveProjectButton,
      this.importProjectButton,
      this.filterControl,
    );
    this.listBand.addChild(
      this.listBg,
      this.listTitle,
      this.rows,
      this.emptyList,
      this.previousButton,
      this.pageText,
      this.nextButton,
    );
    this.detail.addChild(
      this.deckName,
      this.deckTheme,
      this.sourceText,
      this.metaText,
      this.storyText,
      this.rulesText,
      this.showcaseButton,
      this.openButton,
      this.exportButton,
    );
    this.emptyPreviewIcon.anchor.set(0.5);
    this.emptyPreviewText.anchor.set(0.5, 0);
    this.emptyPreview.addChild(this.emptyPreviewIcon, this.emptyPreviewText);
    this.previewCard
      .setInteractiveTilt(true)
      .setAbilityPopoverEnabled(true)
      .setFlipOnTap(true);
    attachInteractionHint(
      this.previewCard,
      () => this.previewCard.isFlipped()
        ? '点击翻到卡牌正面'
        : '点击查看统一卡背，悬停查看完整能力',
    );
    this.addChild(
      this.header,
      this.listBand,
      this.previewCard,
      this.detail,
      this.emptyPreview,
      this.chrome,
    );
    this.rebuildRows();
    this.updatePreview();
  }

  private get filteredDecks(): DeckData[] {
    if (this.filter === 'created') return this.decks.filter((deck) => !deck.provenance);
    if (this.filter === 'received') return this.decks.filter((deck) => Boolean(deck.provenance));
    return this.decks;
  }

  private get selectedDeck(): DeckData | undefined {
    return this.decks.find((deck) => deckVersionKey(deck) === this.selectedKey);
  }

  layout(viewport: Viewport): void {
    this.viewport = viewport;
    this.chrome.layout(viewport);
    const { width, height, phone } = viewport;
    const side = phone ? 14 : 24;
    const headerTop = phone ? 68 : 78;
    const listTop = phone ? 158 : 152;
    const listWidth = phone ? width : Math.min(372, Math.max(320, width * 0.3));
    const listHeight = height - listTop;

    this.header.position.set(0, 0);
    this.title.style.fontSize = phone ? 23 : 29;
    this.title.position.set(side, headerTop);
    this.kicker.position.set(side + 1, headerTop + (phone ? 33 : 40));
    this.countText.position.set(side + (phone ? 154 : 205), headerTop + (phone ? 8 : 12));
    const familyCount = new Set(this.decks.map(deckFamilyId)).size;
    this.countText.text = `${familyCount} 套 · ${this.decks.length} 个版本`;
    const filterWidth = phone ? width - side * 2 : 300;
    this.filterControl.setSize(filterWidth, 36);
    this.filterControl.position.set(phone ? side : width - side - filterWidth, phone ? 112 : 86);
    const labeledProjectActions = !phone && width >= 900;
    this.saveProjectButton.setIconOnly(!labeledProjectActions);
    this.importProjectButton.setIconOnly(!labeledProjectActions);
    this.saveProjectButton.setLabel(labeledProjectActions ? '另存工程' : '');
    this.importProjectButton.setLabel(labeledProjectActions ? '加载工程' : '');
    this.saveProjectButton.setSize(labeledProjectActions ? 118 : 36, 36);
    this.importProjectButton.setSize(labeledProjectActions ? 112 : 36, 36);
    if (phone) {
      this.saveProjectButton.position.set(width - side - 78, 68);
      this.importProjectButton.position.set(width - side - 36, 68);
    } else {
      const filterX = width - side - filterWidth;
      const projectActionGap = 8;
      const importWidth = labeledProjectActions ? 112 : 36;
      const saveWidth = labeledProjectActions ? 118 : 36;
      this.saveProjectButton.position.set(filterX - saveWidth - importWidth - projectActionGap - 8, 86);
      this.importProjectButton.position.set(filterX - importWidth - 8, 86);
    }

    this.listBand.position.set(0, listTop);
    this.listBg
      .clear()
      .rect(0, 0, listWidth, listHeight)
      .fill({ color: COLORS.panel, alpha: 0.9 })
      .moveTo(listWidth, 0)
      .lineTo(listWidth, listHeight)
      .stroke({ color: COLORS.line, width: 1 });
    this.listTitle.position.set(18, 15);
    this.rows.position.set(0, LIBRARY_ROWS_TOP);
    this.emptyList.anchor.set(0.5);
    this.emptyList.position.set(listWidth / 2, Math.min(150, listHeight * 0.42));

    const nextPageSize = getLibraryPageSize(listHeight);
    if (nextPageSize !== this.pageSize) {
      const selectedIndex = this.filteredDecks.findIndex(
        (deck) => deckVersionKey(deck) === this.selectedKey,
      );
      this.pageSize = nextPageSize;
      this.page = selectedIndex >= 0
        ? Math.floor(selectedIndex / this.pageSize)
        : Math.min(this.page, Math.max(0, this.pageCount - 1));
      this.rebuildRows();
    }
    this.layoutRows(listWidth);
    this.previousButton.setSize(34, 34);
    this.nextButton.setSize(34, 34);
    this.previousButton.position.set(18, listHeight - 43);
    this.nextButton.position.set(listWidth - 52, listHeight - 43);
    this.pageText.anchor.set(0.5);
    this.pageText.position.set(listWidth / 2, listHeight - 26);

    if (phone) {
      this.previewCard.visible = false;
      this.detail.visible = false;
      this.emptyPreview.visible = false;
      return;
    }

    const contentWidth = width - listWidth;
    const contentHeight = height - listTop - 20;
    const cardWidth = Math.min(248, Math.max(184, contentWidth * 0.29), (contentHeight - 70) / (88 / 63));
    const cardX = listWidth + side + cardWidth / 2;
    const cardY = listTop + contentHeight / 2 - 8;
    this.previewCard.setSize(cardWidth);
    this.previewCard.position.set(cardX, cardY);

    const detailX = cardX + cardWidth / 2 + 28;
    const detailWidth = width - side - detailX;
    this.detail.position.set(detailX, listTop + 14);
    this.layoutDetail(detailWidth, contentHeight - 14);
    this.emptyPreviewIcon.position.set(0, 0);
    this.emptyPreviewText.position.set(0, 28);
    this.emptyPreview.position.set(listWidth + contentWidth / 2, listTop + contentHeight * 0.43);
  }

  private get pageCount(): number {
    return Math.max(1, Math.ceil(this.filteredDecks.length / this.pageSize));
  }

  private rebuildRows(): void {
    this.rows.removeChildren().forEach((child) => child.destroy({ children: true }));
    const start = this.page * this.pageSize;
    this.rowViews = this.filteredDecks
      .slice(start, start + this.pageSize)
      .map((deck) => this.createRow(deck));
    this.rowViews.forEach((row) => this.rows.addChild(row.root));
    this.emptyList.visible = this.rowViews.length === 0;
    this.pageText.text = `${this.page + 1} / ${this.pageCount}`;
    this.previousButton.setDisabled(this.page <= 0);
    this.nextButton.setDisabled(this.page >= this.pageCount - 1);
  }

  private createRow(deck: DeckData): LibraryRow {
    const root = new Container();
    const background = new Graphics();
    const separator = new Graphics();
    const card = new CardView(deck.cards[0] ?? createStarterCard(deck.modeId), 38)
      .setArtStyle(deck.artStyleId)
      .setGameplayContext(deck.ruleKit?.modules, 'thumbnail')
      .setMotionProfile('static');
    card.setInteractiveTilt(false);
    card.eventMode = 'none';
    const name = new Text({
      text: deck.name,
      style: new TextStyle({
        fontFamily: DISPLAY_FONT,
        fontSize: 14,
        fontWeight: '700',
        fill: COLORS.paper,
        letterSpacing: 0,
        lineHeight: 18,
      }),
    });
    const compositionState = describeDeckComposition(deck);
    const metaValue = `${MODE_BY_ID[deck.modeId].name} · ${compositionState.summary}`;
    const meta = new Text({
      text: metaValue,
      style: new TextStyle({
        fontFamily: FONT_FAMILY,
        fontSize: 10,
        fontWeight: '500',
        fill: COLORS.paperFaint,
        letterSpacing: 0,
        lineHeight: 13,
      }),
    });
    const revision = describeRevision(deck);
    const active = deckVersionKey(deck) === this.activeDeckKey;
    const sourceValue = [
      active ? '采用中' : null,
      revision.versionLabel,
      revision.reasonLabel,
      revision.createdAtLabel?.slice(0, 10) ?? null,
    ].filter(Boolean).join(' · ');
    const source = new Text({
      text: sourceValue,
      style: new TextStyle({
        fontFamily: FONT_FAMILY,
        fontSize: 9,
        fontWeight: '700',
        fill: active || deck.provenance ? COLORS.gold : COLORS.jade,
        letterSpacing: 0,
        lineHeight: 13,
      }),
    });
    const open = new CanvasButton({
      label: active ? '继续' : '采用',
      variant: active ? 'primary' : 'secondary',
      onPress: () => this.openDeck(deck),
    });
    const showcase = new CanvasButton({
      label: '',
      icon: 'eye',
      iconOnly: true,
      tooltip: `展览《${deck.name}》`,
      variant: 'secondary',
      accent: COLORS.gold,
      onPress: () => this.onShowcase(deck),
    });
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointertap', () => this.selectDeck(deck));
    root.on('pointerover', () => { root.alpha = 1; });
    root.on('pointerout', () => {
      root.alpha = deckVersionKey(deck) === this.selectedKey ? 1 : 0.94;
    });
    root.alpha = deckVersionKey(deck) === this.selectedKey ? 1 : 0.94;
    attachInteractionHint(root, () => `选择《${deck.name}》查看详情`);
    root.addChild(background, separator, card, name, meta, source, showcase, open);
    return {
      root,
      background,
      separator,
      card,
      name,
      meta,
      source,
      showcase,
      open,
      deck,
      nameValue: deck.name,
      metaValue,
      sourceValue,
    };
  }

  private layoutRows(width: number): void {
    const layout = getLibraryRowLayout(width);
    this.rowViews.forEach((row, index) => {
      const selected = deckVersionKey(row.deck) === this.selectedKey;
      const accent = MODE_BY_ID[row.deck.modeId].accent;
      row.root.position.set(layout.rowX, index * layout.pitch);
      row.background
        .clear()
        .roundRect(0, 0, layout.rowWidth, layout.rowHeight, 6)
        .fill({ color: selected ? accent : COLORS.panelRaised, alpha: selected ? 0.16 : 0.48 })
        .roundRect(0.5, 0.5, layout.rowWidth - 1, layout.rowHeight - 1, 6)
        .stroke({ color: selected ? accent : COLORS.line, width: selected ? 1.5 : 1, alpha: selected ? 0.84 : 0.68 });
      if (selected) {
        row.background
          .roundRect(
            layout.selectionBar.x,
            layout.selectionBar.y,
            layout.selectionBar.width,
            layout.selectionBar.height,
            2,
          )
          .fill({ color: accent, alpha: 0.96 });
      }
      row.separator
        .clear()
        .moveTo(layout.divider.x, layout.divider.y)
        .lineTo(layout.divider.x + layout.divider.width, layout.divider.y)
        .stroke({ color: selected ? accent : COLORS.line, width: 1, alpha: selected ? 0.38 : 0.42 });
      row.card.setSize(layout.thumbnail.width);
      row.card.position.set(
        layout.thumbnail.x + layout.thumbnail.width / 2,
        layout.thumbnail.y + layout.thumbnail.height / 2,
      );
      row.name.position.set(layout.name.x, layout.name.y);
      fitTextWidth(row.name, row.nameValue, layout.name.width);
      row.meta.position.set(layout.meta.x, layout.meta.y);
      fitTextWidth(row.meta, row.metaValue, layout.meta.width);
      row.source.position.set(layout.source.x, layout.source.y);
      fitTextWidth(row.source, row.sourceValue, layout.source.width);
      row.showcase.setSize(layout.showcase.width, layout.showcase.height);
      row.showcase.position.set(layout.showcase.x, layout.showcase.y);
      row.open.setSize(layout.open.width, layout.open.height);
      row.open.position.set(layout.open.x, layout.open.y);
      row.root.alpha = selected ? 1 : 0.94;
      row.root.hitArea = {
        contains: (x: number, y: number) => (
          x >= 0 && y >= 0 && x <= layout.rowWidth && y <= layout.rowHeight
        ),
      };
    });
  }

  private layoutDetail(width: number, height: number): void {
    this.deckName.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 25,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
      lineHeight: 31,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width,
    });
    this.deckTheme.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 11,
      fontWeight: '600',
      fill: COLORS.jade,
      letterSpacing: 0,
      lineHeight: 17,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width,
    });
    this.sourceText.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '700',
      fill: this.selectedDeck?.provenance ? COLORS.gold : COLORS.jade,
      letterSpacing: 0,
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
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width,
    });
    const bodyStyle = {
      fontFamily: FONT_FAMILY,
      fontSize: 12,
      fontWeight: '400' as const,
      fill: COLORS.paperMuted,
      letterSpacing: 0,
      lineHeight: 19,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width,
    };
    this.storyText.style = new TextStyle(bodyStyle);
    this.rulesText.style = new TextStyle({ ...bodyStyle, fill: COLORS.paper });

    this.deckName.position.set(0, 0);
    fitTextHeight(this.deckName, this.selectedDeck?.name ?? '', 62);
    this.deckTheme.position.set(0, this.deckName.height + 7);
    fitTextHeight(
      this.deckTheme,
      this.selectedDeck ? `${MODE_BY_ID[this.selectedDeck.modeId].name} / ${this.selectedDeck.theme}` : '',
      34,
    );
    this.sourceText.position.set(0, this.deckTheme.y + this.deckTheme.height + 12);
    this.metaText.position.set(0, this.sourceText.y + this.sourceText.height + 9);

    const buttonGap = 8;
    const compactActions = width < 330;
    const buttonWidth = Math.max(32, (width - buttonGap * 2) / 3);
    const buttonY = height - 42;
    this.showcaseButton.setIconOnly(compactActions);
    this.openButton.setIconOnly(compactActions);
    this.exportButton.setIconOnly(compactActions);
    this.showcaseButton.setLabel(compactActions ? '' : '牌组展览');
    this.openButton.setLabel(compactActions ? '' : '设计台');
    this.exportButton.setLabel(compactActions ? '' : '印刷导出');
    this.showcaseButton.setSize(buttonWidth, 42);
    this.openButton.setSize(buttonWidth, 42);
    this.exportButton.setSize(Math.max(32, width - buttonWidth * 2 - buttonGap * 2), 42);
    this.showcaseButton.position.set(0, buttonY);
    this.openButton.position.set(buttonWidth + buttonGap, buttonY);
    this.exportButton.position.set((buttonWidth + buttonGap) * 2, buttonY);

    const bodyY = this.metaText.y + this.metaText.height + 20;
    const bodyBottom = buttonY - 18;
    const bodyHeight = Math.max(0, bodyBottom - bodyY);
    const gap = bodyHeight >= 90 ? 16 : 8;
    const textBudget = Math.max(0, bodyHeight - gap);
    const storyValue = this.selectedDeck ? `世界观\n${this.selectedDeck.story}` : '';
    const rulesValue = this.selectedDeck
      ? `玩法规则\n${renderDeckRules(this.selectedDeck)}`
      : '';
    this.storyText.text = storyValue;
    this.rulesText.text = rulesValue;
    const fullStoryHeight = this.storyText.height;
    const fullRulesHeight = this.rulesText.height;
    let storyBudget = fullStoryHeight;
    if (fullStoryHeight + fullRulesHeight > textBudget) {
      const desired = textBudget * 0.48;
      if (fullStoryHeight <= desired) storyBudget = fullStoryHeight;
      else if (fullRulesHeight <= textBudget - desired) storyBudget = textBudget - fullRulesHeight;
      else storyBudget = desired;
    }
    this.storyText.position.set(0, bodyY);
    fitTextHeight(this.storyText, storyValue, Math.max(0, storyBudget));
    this.rulesText.position.set(0, bodyY + this.storyText.height + gap);
    fitTextHeight(this.rulesText, rulesValue, Math.max(0, bodyBottom - this.rulesText.y));
  }

  private updatePreview(): void {
    const deck = this.selectedDeck;
    this.previewCard.visible = Boolean(deck) && !this.viewport?.phone;
    this.detail.visible = Boolean(deck) && !this.viewport?.phone;
    this.emptyPreview.visible = !deck && !this.viewport?.phone;
    this.openButton.setDisabled(!deck);
    this.showcaseButton.setDisabled(!deck);
    this.exportButton.setDisabled(!deck);
    this.saveProjectButton.setDisabled(!deck);
    if (!deck) return;
    const active = deckVersionKey(deck) === this.activeDeckKey;
    if ((this.detail.getLocalBounds().width || 0) >= 330) {
      this.openButton.setLabel(active ? '继续编辑' : '采用版本');
    }
    this.previewCard
      .setData(deck.cards[0] ?? createStarterCard(deck.modeId))
      .setArtStyle(deck.artStyleId)
      .setGameplayContext(deck.ruleKit?.modules)
      .setBackDesign(deck.cardBack, deck.name)
      .setFlipped(false, true);
    this.deckName.text = deck.name;
    this.deckTheme.text = `${MODE_BY_ID[deck.modeId].name} / ${deck.theme}`;
    const cid = shortDeckCid(deck);
    const revision = describeRevision(deck);
    const source = deck.provenance
      ? `交换所得 · 签名 ${cid ?? '未知'} · ${shortPeerId(deck.provenance.signerPeerId)}`
      : '我的创作 · 本机留版';
    this.sourceText.text = [
      active ? '当前采用版本' : '可采用版本',
      source,
      revision.versionLabel,
      revision.reasonLabel,
      revision.createdAtLabel,
    ].filter(Boolean).join(' · ');
    const compositionState = describeDeckComposition(deck);
    this.metaText.text = `${compositionState.summary} · 作者 ${deck.author} · 所有旧版均保留在本机`;
    this.storyText.text = `世界观\n${deck.story}`;
    this.rulesText.text = `玩法规则\n${renderDeckRules(deck)}`;
  }

  private selectDeck(deck: DeckData): void {
    const key = deckVersionKey(deck);
    if (key === this.selectedKey) return;
    this.selectedKey = key;
    this.updatePreview();
    this.rebuildRows();
    if (this.viewport) this.layout(this.viewport);
  }

  private openDeck(deck: DeckData): void {
    this.selectedKey = deckVersionKey(deck);
    this.onOpen(deck);
  }

  private openSelected(): void {
    const deck = this.selectedDeck;
    if (deck) this.openDeck(deck);
  }

  private showcaseSelected(): void {
    const deck = this.selectedDeck;
    if (deck) this.onShowcase(deck);
  }

  private exportSelected(): void {
    const deck = this.selectedDeck;
    if (deck) this.onExport(deck);
  }

  private saveSelectedProject(): void {
    const deck = this.selectedDeck;
    if (deck) this.onProjectExport(deck);
  }

  private changePage(delta: number): void {
    const next = Math.max(0, Math.min(this.pageCount - 1, this.page + delta));
    if (next === this.page) return;
    this.page = next;
    this.rebuildRows();
    if (this.viewport) this.layout(this.viewport);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    super.destroy(options ?? { children: true });
  }
}
