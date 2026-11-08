import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import { TopBar } from '../chrome';
import {
  FAN_STUDY_CONFIRMATION_LABELS,
  FAN_STUDY_DISCLAIMER,
  FAN_STUDY_TERMS_VERSION,
  allFanStudyConfirmationsAccepted,
  createFanStudyDeckContentPolicy,
  createOriginalDeckContentPolicy,
  resolveDeckContentPolicy,
  type FanStudyConfirmationId,
} from '../services/content-policy';
import { COLORS, DISPLAY_FONT, FONT_FAMILY } from '../theme';
import type { DeckCreationMode, DeckData, FanStudyConfirmations, Viewport } from '../types';
import { CanvasButton, SegmentedControl, Toggle } from '../ui';
import { announce } from '../utils';

export interface ContentPolicySceneOptions {
  deck: DeckData;
  onHome: () => void;
  onStudio: () => void;
  onRules: () => void;
  onLibrary: () => void;
  onExchange: () => void;
  onBattle: () => void;
  onCancel: () => void;
  onApply: (deck: DeckData) => void;
}

interface ConfirmationRow {
  id: FanStudyConfirmationId;
  root: Container;
  background: Graphics;
  label: Text;
  toggle: Toggle;
}

const CONFIRMATION_IDS = Object.keys(
  FAN_STUDY_CONFIRMATION_LABELS,
) as FanStudyConfirmationId[];

const EMPTY_CONFIRMATIONS: FanStudyConfirmations = {
  materialsRightsConfirmed: false,
  personalNonCommercialConfirmed: false,
  unofficialAndUnaffiliatedConfirmed: false,
  guardianJointlyConfirmed: false,
};

function paginateDisclaimer(value: string): string[] {
  const clauses = value
    .split('；')
    .map((clause) => clause.trim())
    .filter(Boolean)
    .map((clause, index, values) => `${clause}${index === values.length - 1 ? '' : '；'}`);
  const pages: string[] = [];
  let current = '';
  for (const clause of clauses) {
    if (current && Array.from(`${current}${clause}`).length > 150) {
      pages.push(current);
      current = clause;
    } else {
      current += clause;
    }
  }
  if (current) pages.push(current);
  return pages.length ? pages : [value];
}

const DISCLAIMER_PAGES = paginateDisclaimer(FAN_STUDY_DISCLAIMER);

export class ContentPolicyScene extends Container {
  private readonly deck: DeckData;
  private readonly onApply: (deck: DeckData) => void;
  private readonly chrome: TopBar;
  private readonly backdrop = new Graphics();
  private readonly panel = new Graphics();
  private readonly ornament = new Graphics();
  private readonly kicker = new Text({
    text: 'AUTHORSHIP & USE POLICY',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      fill: COLORS.gold,
      letterSpacing: 0,
    }),
  });
  private readonly title = new Text({
    text: '创作权属与使用方式',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 28,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly status = new Text({ text: '' });
  private readonly intro = new Text({ text: '' });
  private readonly modeControl: SegmentedControl<DeckCreationMode>;
  private readonly rows: ConfirmationRow[];
  private readonly noticeBand = new Graphics();
  private readonly noticeSummary = new Text({ text: '' });
  private readonly fullNoticeButton: CanvasButton;
  private readonly applyButton: CanvasButton;

  private readonly fullNoticeLayer = new Container();
  private readonly fullNoticeTitle = new Text({ text: '个人同人研习免责声明' });
  private readonly fullNoticeMeta = new Text({ text: '' });
  private readonly fullNoticeText = new Text({ text: '' });
  private readonly noticePreviousButton: CanvasButton;
  private readonly noticeNextButton: CanvasButton;
  private readonly noticeBackButton: CanvasButton;

  private mode: DeckCreationMode;
  private confirmations: FanStudyConfirmations;
  private noticePage = 0;
  private viewport?: Viewport;

  constructor(options: ContentPolicySceneOptions) {
    super();
    this.deck = options.deck;
    this.onApply = options.onApply;
    const policy = resolveDeckContentPolicy(options.deck);
    this.mode = policy.mode;
    this.confirmations = policy.mode === 'fan-study'
      ? { ...policy.agreement.confirmations }
      : { ...EMPTY_CONFIRMATIONS };

    this.chrome = new TopBar({
      current: 'studio',
      onHome: options.onHome,
      onNavigate: (scene) => {
        if (scene === 'studio') options.onStudio();
        if (scene === 'rules') options.onRules();
        if (scene === 'library') options.onLibrary();
        if (scene === 'exchange') options.onExchange();
        if (scene === 'battle') options.onBattle();
      },
      action: {
        label: '返回设计台',
        icon: 'arrow-left',
        tooltip: '取消更改并返回设计台',
        variant: 'secondary',
        accent: COLORS.gold,
        onPress: options.onCancel,
      },
    });

    this.modeControl = new SegmentedControl<DeckCreationMode>({
      items: [
        { value: 'original', label: '原创世界', icon: 'sparkles' },
        { value: 'fan-study', label: '个人同人研习', icon: 'shield' },
      ],
      value: this.mode,
      accent: COLORS.gold,
      onChange: (mode) => {
        this.mode = mode;
        this.refresh();
      },
    });

    this.rows = CONFIRMATION_IDS.map((id) => {
      const root = new Container();
      const background = new Graphics();
      const label = new Text({
        text: FAN_STUDY_CONFIRMATION_LABELS[id],
        style: new TextStyle({
          fontFamily: FONT_FAMILY,
          fontSize: 12,
          fontWeight: '500',
          fill: COLORS.paper,
          letterSpacing: 0,
          lineHeight: 18,
          wordWrap: true,
          breakWords: true,
        }),
      });
      const toggle = new Toggle({
        value: this.confirmations[id],
        accent: COLORS.gold,
        tooltip: `确认：${FAN_STUDY_CONFIRMATION_LABELS[id]}`,
        onChange: (value) => {
          this.confirmations = { ...this.confirmations, [id]: value };
          this.refresh();
        },
      });
      root.addChild(background, label, toggle);
      return { id, root, background, label, toggle };
    });

    this.fullNoticeButton = new CanvasButton({
      label: '阅读完整免责声明',
      icon: 'info',
      variant: 'secondary',
      accent: COLORS.gold,
      onPress: () => this.showFullNotice(),
    });
    this.applyButton = new CanvasButton({
      label: '保存创作方式',
      icon: 'shield-check',
      variant: 'primary',
      accent: COLORS.gold,
      onPress: () => this.apply(),
    });
    this.noticePreviousButton = new CanvasButton({
      label: '',
      icon: 'arrow-left',
      iconOnly: true,
      tooltip: '上一页免责声明',
      variant: 'secondary',
      onPress: () => this.changeNoticePage(-1),
    });
    this.noticeNextButton = new CanvasButton({
      label: '',
      icon: 'arrow-right',
      iconOnly: true,
      tooltip: '下一页免责声明',
      variant: 'secondary',
      onPress: () => this.changeNoticePage(1),
    });
    this.noticeBackButton = new CanvasButton({
      label: '返回确认清单',
      icon: 'arrow-left',
      variant: 'primary',
      accent: COLORS.gold,
      onPress: () => this.hideFullNotice(),
    });

    this.fullNoticeLayer.addChild(
      this.fullNoticeTitle,
      this.fullNoticeMeta,
      this.fullNoticeText,
      this.noticePreviousButton,
      this.noticeNextButton,
      this.noticeBackButton,
    );
    this.addChild(
      this.backdrop,
      this.panel,
      this.ornament,
      this.kicker,
      this.title,
      this.status,
      this.intro,
      this.modeControl,
      ...this.rows.map((row) => row.root),
      this.noticeBand,
      this.noticeSummary,
      this.fullNoticeButton,
      this.applyButton,
      this.fullNoticeLayer,
      this.chrome,
    );
    this.fullNoticeLayer.visible = false;
    this.refresh();
  }

  layout(viewport: Viewport): void {
    this.viewport = viewport;
    this.chrome.layout(viewport);
    const { width, height, phone } = viewport;
    const navigationHeight = viewport.profile.navigationHeight;
    const margin = phone ? 10 : 22;
    const panelX = Math.max(margin, (width - Math.min(860, width - margin * 2)) / 2);
    const panelY = navigationHeight + margin;
    const panelWidth = Math.max(280, Math.min(860, width - margin * 2));
    const panelHeight = Math.max(280, height - panelY - margin);
    const padding = phone ? 16 : 28;
    const contentX = panelX + padding;
    const contentWidth = panelWidth - padding * 2;
    const compact = phone || panelHeight < 590;

    this.backdrop
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: COLORS.ink, alpha: 0.38 });
    this.panel
      .clear()
      .roundRect(panelX, panelY, panelWidth, panelHeight, 7)
      .fill({ color: COLORS.panel, alpha: 0.97 })
      .stroke({ color: COLORS.gold, width: 1.2, alpha: 0.66 })
      .roundRect(panelX + 6, panelY + 6, panelWidth - 12, panelHeight - 12, 4)
      .stroke({ color: COLORS.cinnabar, width: 0.7, alpha: 0.38 });
    this.ornament
      .clear()
      .moveTo(panelX + 18, panelY + 18)
      .lineTo(panelX + 68, panelY + 18)
      .stroke({ color: COLORS.gold, width: 1, alpha: 0.45 })
      .moveTo(panelX + panelWidth - 68, panelY + panelHeight - 18)
      .lineTo(panelX + panelWidth - 18, panelY + panelHeight - 18)
      .stroke({ color: COLORS.gold, width: 1, alpha: 0.45 });

    if (this.fullNoticeLayer.visible) {
      this.layoutFullNotice(contentX, panelY + padding, contentWidth, panelHeight - padding * 2, compact);
      return;
    }

    this.kicker.visible = !compact;
    this.kicker.position.set(contentX, panelY + 22);
    this.title.style.fontSize = phone ? 22 : compact ? 24 : 28;
    this.title.position.set(contentX, panelY + (compact ? 18 : 40));
    this.status.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: phone ? 9 : 10,
      fontWeight: '700',
      fill: this.mode === 'fan-study' ? COLORS.gold : COLORS.jade,
      letterSpacing: 0,
    });
    this.status.anchor.set(1, 0);
    this.status.position.set(contentX + contentWidth, this.title.y + 7);

    const modeY = this.title.y + this.title.height + (compact ? 10 : 16);
    this.modeControl.position.set(contentX, modeY);
    this.modeControl.setSize(contentWidth, compact ? 36 : 40);
    this.intro.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: compact ? 11 : 12,
      fontWeight: '500',
      fill: COLORS.paperMuted,
      letterSpacing: 0,
      lineHeight: compact ? 16 : 19,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: contentWidth,
    });
    this.intro.position.set(contentX, modeY + (compact ? 44 : 50));

    const buttonHeight = compact ? 38 : 42;
    const buttonY = panelY + panelHeight - padding - buttonHeight;
    const actionGap = 10;
    const actionWidth = (contentWidth - actionGap) / 2;
    this.fullNoticeButton.position.set(contentX, buttonY);
    this.fullNoticeButton.setSize(actionWidth, buttonHeight);
    this.applyButton.position.set(contentX + actionWidth + actionGap, buttonY);
    this.applyButton.setSize(actionWidth, buttonHeight);

    const noticeHeight = compact ? 54 : 72;
    const noticeY = buttonY - noticeHeight - (compact ? 10 : 14);
    this.noticeBand
      .clear()
      .rect(contentX, noticeY, contentWidth, noticeHeight)
      .fill({ color: this.mode === 'fan-study' ? COLORS.cinnabar : COLORS.jade, alpha: 0.09 })
      .moveTo(contentX, noticeY)
      .lineTo(contentX, noticeY + noticeHeight)
      .stroke({ color: this.mode === 'fan-study' ? COLORS.gold : COLORS.jade, width: 3, alpha: 0.8 });
    this.noticeSummary.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: compact ? 10 : 11,
      fontWeight: '500',
      fill: COLORS.paper,
      letterSpacing: 0,
      lineHeight: compact ? 15 : 17,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: contentWidth - 24,
    });
    this.noticeSummary.position.set(contentX + 14, noticeY + (compact ? 8 : 10));

    const rowsTop = this.intro.y + this.intro.height + (compact ? 8 : 13);
    const rowsBottom = noticeY - (compact ? 7 : 12);
    const rowGap = compact ? 3 : 6;
    const rowHeight = Math.max(34, (rowsBottom - rowsTop - rowGap * 3) / 4);
    this.rows.forEach((row, index) => {
      const y = rowsTop + index * (rowHeight + rowGap);
      row.root.position.set(contentX, y);
      row.background
        .clear()
        .rect(0, 0, contentWidth, rowHeight)
        .fill({ color: COLORS.panelRaised, alpha: this.mode === 'fan-study' ? 0.54 : 0.22 })
        .moveTo(0, rowHeight)
        .lineTo(contentWidth, rowHeight)
        .stroke({ color: COLORS.line, width: 0.8, alpha: 0.7 });
      row.label.style = new TextStyle({
        fontFamily: FONT_FAMILY,
        fontSize: compact ? 10 : 12,
        fontWeight: '500',
        fill: this.mode === 'fan-study' ? COLORS.paper : COLORS.paperFaint,
        letterSpacing: 0,
        lineHeight: compact ? 14 : 17,
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: contentWidth - 66,
      });
      row.label.position.set(10, Math.max(4, (rowHeight - row.label.height) / 2));
      row.toggle.setSize(42, Math.min(32, rowHeight));
      row.toggle.position.set(contentWidth - 50, (rowHeight - Math.min(32, rowHeight)) / 2);
    });
  }

  private layoutFullNotice(
    x: number,
    y: number,
    width: number,
    height: number,
    compact: boolean,
  ): void {
    this.kicker.visible = false;
    this.title.visible = false;
    this.status.visible = false;
    this.intro.visible = false;
    this.modeControl.visible = false;
    this.rows.forEach((row) => { row.root.visible = false; });
    this.noticeBand.visible = false;
    this.noticeSummary.visible = false;
    this.fullNoticeButton.visible = false;
    this.applyButton.visible = false;

    this.fullNoticeTitle.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: compact ? 22 : 28,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    });
    this.fullNoticeTitle.position.set(x, y);
    this.fullNoticeMeta.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '700',
      fill: COLORS.gold,
      letterSpacing: 0,
    });
    this.fullNoticeMeta.position.set(x, y + this.fullNoticeTitle.height + 10);
    const controlsHeight = compact ? 38 : 42;
    const controlsY = y + height - controlsHeight;
    const textY = this.fullNoticeMeta.y + this.fullNoticeMeta.height + (compact ? 14 : 22);
    this.fullNoticeText.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: compact ? 12 : 14,
      fontWeight: '400',
      fill: COLORS.paperMuted,
      letterSpacing: 0,
      lineHeight: compact ? 19 : 23,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width,
    });
    this.fullNoticeText.position.set(x, textY);
    this.fullNoticeText.text = DISCLAIMER_PAGES[this.noticePage];
    this.fullNoticeText.style.wordWrapWidth = width;
    const availableTextHeight = Math.max(40, controlsY - textY - 16);
    if (this.fullNoticeText.height > availableTextHeight) {
      this.fullNoticeText.style.fontSize = 10;
      this.fullNoticeText.style.lineHeight = 16;
    }

    const navSize = controlsHeight;
    const gap = 8;
    this.noticePreviousButton.setSize(navSize, navSize);
    this.noticeNextButton.setSize(navSize, navSize);
    this.noticePreviousButton.position.set(x, controlsY);
    this.noticeNextButton.position.set(x + navSize + gap, controlsY);
    const backWidth = Math.min(190, Math.max(126, width * 0.42));
    this.noticeBackButton.setSize(backWidth, controlsHeight);
    this.noticeBackButton.position.set(x + width - backWidth, controlsY);
  }

  private refresh(): void {
    const fanStudy = this.mode === 'fan-study';
    this.status.text = fanStudy
      ? `个人研习 · LOCAL ONLY · 条款 ${FAN_STUDY_TERMS_VERSION}`
      : '原创世界 · 默认模式';
    this.intro.text = fanStudy
      ? '可在本机围绕已有作品进行个人同人研习。保存前请逐项确认；本模式不会替你取得任何知识产权授权。'
      : '适用于自创角色、世界观与视觉设定。旧套牌默认使用此模式，无需额外法律确认。';
    this.noticeSummary.text = fanStudy
      ? '本机编辑、展览及带“非商业同人创作 / 非官方授权”标记的个人印刷可用；P2P 交换、收费传播和商业用途默认禁止。'
      : '请仅使用原创内容或你已明确获准使用的素材；若主题涉及已有作品，请切换到“个人同人研习”。';
    this.rows.forEach((row) => {
      row.toggle.setValue(this.confirmations[row.id]);
      row.toggle.setDisabled(!fanStudy);
      row.root.alpha = fanStudy ? 1 : 0.5;
      row.root.visible = true;
    });
    this.kicker.visible = true;
    this.title.visible = true;
    this.status.visible = true;
    this.intro.visible = true;
    this.modeControl.visible = true;
    this.noticeBand.visible = true;
    this.noticeSummary.visible = true;
    this.fullNoticeButton.visible = true;
    this.applyButton.visible = true;
    this.applyButton.setDisabled(fanStudy && !allFanStudyConfirmationsAccepted(this.confirmations));
    this.applyButton.setLabel(fanStudy ? '同意并启用研习模式' : '保存原创模式');
    if (this.viewport) this.layout(this.viewport);
  }

  private apply(): void {
    if (this.mode === 'fan-study' && !allFanStudyConfirmationsAccepted(this.confirmations)) return;
    const contentPolicy = this.mode === 'fan-study'
      ? createFanStudyDeckContentPolicy(this.confirmations)
      : createOriginalDeckContentPolicy();
    announce(this.mode === 'fan-study' ? '个人同人研习模式已启用' : '原创模式已启用');
    this.onApply({ ...this.deck, contentPolicy });
  }

  private showFullNotice(): void {
    this.noticePage = 0;
    this.fullNoticeLayer.visible = true;
    this.updateNoticePage();
    announce('正在阅读个人同人研习免责声明');
    if (this.viewport) this.layout(this.viewport);
  }

  private hideFullNotice(): void {
    this.fullNoticeLayer.visible = false;
    this.refresh();
  }

  private changeNoticePage(delta: number): void {
    const next = Math.max(0, Math.min(DISCLAIMER_PAGES.length - 1, this.noticePage + delta));
    if (next === this.noticePage) return;
    this.noticePage = next;
    this.updateNoticePage();
    if (this.viewport) this.layout(this.viewport);
  }

  private updateNoticePage(): void {
    this.fullNoticeMeta.text = `条款 ${FAN_STUDY_TERMS_VERSION} · ${this.noticePage + 1} / ${DISCLAIMER_PAGES.length} · 勾选不构成许可或合法性背书`;
    this.fullNoticeText.text = DISCLAIMER_PAGES[this.noticePage];
    this.noticePreviousButton.setDisabled(this.noticePage === 0);
    this.noticeNextButton.setDisabled(this.noticePage === DISCLAIMER_PAGES.length - 1);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.hitArea = new Rectangle();
    super.destroy(options ?? { children: true });
  }
}
