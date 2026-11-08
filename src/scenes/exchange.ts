import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CardView } from '../card-view';
import { TopBar } from '../chrome';
import { attachInteractionHint } from '../interaction-hints';
import {
  connectPeer,
  getP2pSnapshot,
  isDesktopRuntime,
  respondToOffer,
  sendDeckOffer,
  startP2p,
  stopP2p,
} from '../services/p2p';
import { canExchangeDeck } from '../services/content-policy';
import { deckVersionKey, mergeDeckVersions, shortDeckCid } from '../services/deck-identity';
import { COLORS, DISPLAY_FONT, FONT_FAMILY } from '../theme';
import type { DeckData, ExchangeOffer, P2pPeer, P2pSnapshot, Viewport } from '../types';
import { CanvasButton, CanvasInput, IconSprite, SegmentedControl, ToastLayer } from '../ui';
import {
  getExchangeActivityGrid,
  getExchangeIdentityControls,
  getExchangeLayout,
  getExchangeOfferControls,
  getExchangePeerCapacity,
  getExchangePeerRowLayout,
  type ExchangeSection,
} from './exchange-layout';
import { findNextExchangeableDeckIndex } from './exchange-selection';

type ConnectMode = 'nearby' | 'manual';

interface ExchangeSceneOptions {
  deck: DeckData;
  decks: DeckData[];
  onHome: () => void;
  onLibrary: () => void;
  onStudio: () => void;
  onRules: () => void;
  onBattle: () => void;
  onDeckReceived: (deck: DeckData, offerId: string) => Promise<boolean>;
}

interface PeerRow {
  root: Container;
  separator: Graphics;
  name: Text;
  id: Text;
  status: Text;
  button: CanvasButton;
  peerId: string;
  nameValue: string;
  idValue: string;
  statusValue: string;
}

interface OfferRow {
  offerId: string;
  root: Container;
  separator: Graphics;
  title: Text;
  meta: Text;
  status: Text;
  accept?: CanvasButton;
  decline?: CanvasButton;
  titleValue: string;
  metaValue: string;
}

const EMPTY_SNAPSHOT: P2pSnapshot = {
  running: false,
  identity: null,
  peers: [],
  offers: [],
};

function shortPeerId(peerId: string): string {
  if (peerId.length <= 18) return peerId;
  return `${peerId.slice(0, 9)}…${peerId.slice(-7)}`;
}

function offerStatusLabel(offer: ExchangeOffer): string {
  const labels = {
    pending: '等待回应',
    accepted: '已接受',
    declined: '已谢绝',
    completed: '验证完成',
    failed: '交换失败',
  } as const;
  return labels[offer.status];
}

function fitText(text: Text, value: string, maxWidth: number): void {
  text.scale.set(1);
  text.text = value;
  if (maxWidth <= 0) {
    text.text = '';
    return;
  }
  if (text.width <= maxWidth) return;

  const characters = Array.from(value);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    text.text = `${characters.slice(0, midpoint).join('')}\u2026`;
    if (text.width <= maxWidth) low = midpoint;
    else high = midpoint - 1;
  }
  text.text = `${characters.slice(0, low).join('')}\u2026`;
}

export class ExchangeScene extends Container {
  private readonly decks: DeckData[];
  private selectedDeckIndex: number;
  private readonly onDeckReceived: (deck: DeckData, offerId: string) => Promise<boolean>;
  private readonly chrome: TopBar;
  private readonly header = new Container();
  private readonly title = new Text({
    text: '去中心交换站',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 30,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly kicker = new Text({
    text: 'PEER-TO-PEER  /  DIRECT EXCHANGE',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '700',
      fill: COLORS.jade,
      letterSpacing: 0,
    }),
  });
  private readonly headerRule = new Graphics();
  private readonly statusDot = new Graphics();
  private readonly statusText = new Text({
    text: '交换未启动',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 11,
      fontWeight: '600',
      fill: COLORS.paperMuted,
      letterSpacing: 0,
    }),
  });

  private readonly identityBand = new Container();
  private readonly identityBg = new Graphics();
  private readonly identityMark = new Graphics();
  private readonly identityGlyph = new Text({
    text: 'P2P',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 18,
      fontWeight: '800',
      fill: COLORS.ink,
      letterSpacing: 0,
    }),
  });
  private readonly identityTitle = new Text({
    text: '本机身份',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 20,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly peerIdText = new Text({ text: '生成中…' });
  private readonly identityMeta = new Text({
    text: 'ED25519  /  本地密钥',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      fill: COLORS.jade,
      letterSpacing: 0,
    }),
  });
  private readonly verifiedBadge = new Container();
  private readonly verifiedBg = new Graphics();
  private readonly verifiedIcon = new IconSprite('shield-check', 15, COLORS.jade);
  private readonly verifiedText = new Text({
    text: '本机签名有效',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 10,
      fontWeight: '700',
      fill: COLORS.jade,
      letterSpacing: 0,
    }),
  });
  private readonly nodeToggleButton: CanvasButton;
  private readonly copyCodeButton: CanvasButton;
  private readonly connectionMode: SegmentedControl<ConnectMode>;
  private readonly manualInput: CanvasInput;
  private readonly connectButton: CanvasButton;
  private readonly sectionTabs: SegmentedControl<ExchangeSection>;

  private readonly peerBand = new Container();
  private readonly peerBandBg = new Graphics();
  private readonly peerTitle = new Text({
    text: '附近节点',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 20,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly peerCount = new Text({ text: '0 ONLINE' });
  private readonly peerRows = new Container();
  private readonly emptyPeers = new Container();
  private readonly emptyMesh = new Graphics();
  private readonly emptyIcon = new IconSprite('network', 24, COLORS.paperFaint);
  private readonly emptyText = new Text({
    text: '未发现附近节点',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 12,
      fontWeight: '600',
      fill: COLORS.paperFaint,
      letterSpacing: 0,
    }),
  });
  private peerViews: PeerRow[] = [];

  private readonly offerBand = new Container();
  private readonly offerBg = new Graphics();
  private readonly offerTitle = new Text({
    text: '待交换卡包',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 20,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly deckCard: CardView;
  private readonly deckName = new Text({ text: '' });
  private readonly deckCid = new Text({
    text: 'CID  发送时生成',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '600',
      fill: COLORS.paperFaint,
      letterSpacing: 0,
    }),
  });
  private readonly recipientText = new Text({
    text: '尚未选择节点',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 11,
      fontWeight: '600',
      fill: COLORS.paperMuted,
      letterSpacing: 0,
    }),
  });
  private readonly deckSelectButton: CanvasButton;
  private readonly sendButton: CanvasButton;
  private deckCidLabel = 'CID  发送时生成';

  private readonly activityBand = new Container();
  private readonly activityBg = new Graphics();
  private readonly activityTitle = new Text({
    text: '交换记录',
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 18,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private readonly offerRows = new Container();
  private readonly emptyOffers = new Text({
    text: '暂无交换请求',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 11,
      fontWeight: '500',
      fill: COLORS.paperFaint,
      letterSpacing: 0,
    }),
  });
  private offerViews: OfferRow[] = [];
  private readonly toast = new ToastLayer();
  private snapshot: P2pSnapshot = EMPTY_SNAPSHOT;
  private selectedPeerId?: string;
  private connectMode: ConnectMode = 'nearby';
  private activeSection: ExchangeSection = 'identity';
  private responsiveLayout = false;
  private recipientLabel = '尚未选择节点';
  private viewport?: Viewport;
  private pollTimer?: number;
  private refreshInFlight = false;
  private peerCapacity = 6;
  private offerCapacity = 4;
  private snapshotSignature = '';
  private readonly archivedOfferIds = new Set<string>();
  private readonly archivingOfferIds = new Set<string>();
  private readonly desktopRuntime = isDesktopRuntime();
  private nodeTransitionInFlight = false;
  private nodeLeaseId?: string;
  private activated = false;
  private snapshotRequestVersion = 0;
  private disposed = false;

  constructor(options: ExchangeSceneOptions) {
    super();
    this.decks = mergeDeckVersions([...options.decks, options.deck]);
    this.selectedDeckIndex = Math.max(
      0,
      this.decks.findIndex((deck) => deckVersionKey(deck) === deckVersionKey(options.deck)),
    );
    this.onDeckReceived = options.onDeckReceived;
    this.chrome = new TopBar({
      current: 'exchange',
      onHome: options.onHome,
      onNavigate: (scene) => {
        if (scene === 'studio') options.onStudio();
        if (scene === 'rules') options.onRules();
        if (scene === 'library') options.onLibrary();
        if (scene === 'battle') options.onBattle();
      },
    });
    this.nodeToggleButton = new CanvasButton({
      label: '启动本机交换',
      icon: 'network',
      variant: 'primary',
      accent: COLORS.jade,
      onPress: () => void this.toggleNode(),
    });
    this.copyCodeButton = new CanvasButton({
      label: '复制连接码',
      icon: 'copy',
      variant: 'secondary',
      onPress: () => void this.copyConnectionCode(),
    });
    this.connectionMode = new SegmentedControl<ConnectMode>({
      items: [
        { value: 'nearby', label: '附近发现', icon: 'network' },
        { value: 'manual', label: '手工连接', icon: 'refresh-cw' },
      ],
      value: this.connectMode,
      accent: COLORS.jade,
      onChange: (value) => {
        this.connectMode = value;
        this.updateConnectMode();
      },
    });
    this.manualInput = new CanvasInput({
      label: '对方连接码',
      placeholder: '/ip4/…/udp/…/quic-v1/p2p/…',
      maxLength: 720,
      icon: 'network',
      onSubmit: () => void this.connectManual(),
    });
    this.connectButton = new CanvasButton({
      label: '建立直连',
      icon: 'refresh-cw',
      variant: 'primary',
      onPress: () => void this.connectManual(),
    });
    this.sectionTabs = new SegmentedControl<ExchangeSection>({
      items: [
        { value: 'identity', label: '本机', icon: 'shield-check' },
        { value: 'peers', label: '节点', icon: 'network' },
        { value: 'offer', label: '发送', icon: 'send' },
        { value: 'activity', label: '记录', icon: 'library' },
      ],
      value: this.activeSection,
      accent: COLORS.gold,
      onChange: (value) => {
        this.activeSection = value;
        if (value !== 'identity') this.manualInput.blur();
        if (this.viewport) this.layout(this.viewport);
      },
    });
    this.sendButton = new CanvasButton({
      label: '发送交换请求',
      icon: 'send',
      variant: 'primary',
      accent: COLORS.gold,
      disabled: true,
      onPress: () => void this.sendOffer(),
    });
    this.deckSelectButton = new CanvasButton({
      label: '',
      icon: 'layers',
      variant: 'secondary',
      accent: COLORS.gold,
      onPress: () => this.selectNextDeck(),
    });
    this.deckSelectButton.setIconOnly(false);
    this.deckSelectButton.setDisabled(this.decks.length < 2);
    this.deckCard = new CardView(this.selectedDeck.cards[0], 154)
      .setArtStyle(this.selectedDeck.artStyleId)
      .setGameplayContext(this.selectedDeck.ruleKit?.modules)
      .setFoilIntensity(0.88)
      .setBackDesign(this.selectedDeck.cardBack, this.selectedDeck.name)
      .setInteractiveTilt(true)
      .setAbilityPopoverEnabled(true)
      .setFlipOnTap(true);
    attachInteractionHint(
      this.deckCard,
      () => this.deckCard.isFlipped()
        ? '点击翻到交换牌正面'
        : '点击查看统一卡背，悬停查看完整能力',
    );
    this.deckName.text = this.selectedDeck.name;
    this.updateDeckSelection();
    this.peerIdText.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 11,
      fontWeight: '600',
      fill: COLORS.paperMuted,
      letterSpacing: 0,
    });
    this.peerCount.style = new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      fill: COLORS.jade,
      letterSpacing: 0,
    });
    this.deckName.style = new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 18,
      fontWeight: '700',
      fill: COLORS.paper,
      letterSpacing: 0,
    });

    this.header.addChild(this.title, this.kicker, this.headerRule, this.statusDot, this.statusText);
    this.verifiedBadge.addChild(this.verifiedBg, this.verifiedIcon, this.verifiedText);
    this.identityGlyph.anchor.set(0.5);
    this.identityBand.addChild(
      this.identityBg,
      this.identityMark,
      this.identityGlyph,
      this.identityTitle,
      this.peerIdText,
      this.identityMeta,
      this.verifiedBadge,
      this.nodeToggleButton,
      this.copyCodeButton,
      this.connectionMode,
      this.manualInput,
      this.connectButton,
    );
    this.emptyPeers.addChild(this.emptyMesh, this.emptyIcon, this.emptyText);
    this.peerBand.addChild(this.peerBandBg, this.peerTitle, this.peerCount, this.peerRows, this.emptyPeers);
    this.offerBand.addChild(
      this.offerBg,
      this.offerTitle,
      this.deckCard,
      this.deckName,
      this.deckCid,
      this.deckSelectButton,
      this.recipientText,
      this.sendButton,
    );
    this.activityBand.addChild(
      this.activityBg,
      this.activityTitle,
      this.offerRows,
      this.emptyOffers,
    );
    this.addChild(
      this.header,
      this.sectionTabs,
      this.identityBand,
      this.peerBand,
      this.offerBand,
      this.activityBand,
      this.chrome,
      this.toast,
    );
    if (!this.desktopRuntime) {
      this.nodeToggleButton.setDisabled(true);
      this.connectionMode.setDisabled(true);
      this.manualInput.setDisabled(true);
      this.connectButton.setDisabled(true);
    }
    this.updateNodeControls();
    this.updateConnectMode();
  }

  activate(): void {
    if (this.disposed || this.activated) return;
    this.activated = true;
    void this.loadNodeState();
  }

  private get selectedDeck(): DeckData {
    return this.decks[this.selectedDeckIndex] ?? this.decks[0];
  }

  private get selectedDeckExchangeable(): boolean {
    return canExchangeDeck(this.selectedDeck);
  }

  layout(viewport: Viewport): void {
    this.viewport = viewport;
    const { width, height } = viewport;
    this.chrome.layout(viewport);
    this.toast.setSize(width, height);

    const sceneLayout = getExchangeLayout(viewport);
    this.responsiveLayout = sceneLayout.responsive;
    const { header } = sceneLayout;
    this.header.position.set(header.x, header.y);
    this.title.style.fontSize = sceneLayout.responsive ? (sceneLayout.tightHeader ? 23 : 26) : 30;
    this.title.position.set(0, 0);
    this.kicker.visible = !sceneLayout.tightHeader && (!sceneLayout.responsive || header.width >= 520);
    this.kicker.position.set(1, sceneLayout.responsive ? 32 : 42);
    this.headerRule.visible = !sceneLayout.responsive && !sceneLayout.tightHeader;
    this.headerRule.clear();
    if (this.headerRule.visible) {
      this.headerRule
        .moveTo(310, 22)
        .lineTo(Math.max(310, header.width - 160), 22)
        .stroke({ color: COLORS.jade, width: 1, alpha: 0.28 });
    }
    this.statusDot
      .clear()
      .circle(0, 0, 4)
      .fill({ color: this.snapshot.running ? COLORS.jade : COLORS.coral, alpha: 0.92 });
    const showStatusText = !sceneLayout.responsive || header.width >= 520;
    this.statusText.visible = showStatusText;
    if (sceneLayout.responsive) {
      const statusY = sceneLayout.tightHeader ? 14 : 12;
      const statusRight = header.width - 8;
      this.statusText.position.set(Math.max(0, header.width - 142), statusY);
      this.statusDot.position.set(
        showStatusText ? this.statusText.x - 12 : statusRight - 4,
        sceneLayout.tightHeader ? 19 : 18,
      );
    } else {
      this.statusDot.position.set(header.width - 136, 22);
      this.statusText.position.set(header.width - 124, 14);
    }

    if (sceneLayout.tabs) {
      this.sectionTabs.position.set(sceneLayout.tabs.x, sceneLayout.tabs.y);
      this.sectionTabs.setSize(sceneLayout.tabs.width, sceneLayout.tabs.height);
    }

    const identity = sceneLayout.sections.identity;
    this.identityBand.position.set(identity.x, identity.y);
    this.layoutIdentity(identity.width, identity.height, sceneLayout.responsive);
    const peers = sceneLayout.sections.peers;
    this.peerBand.position.set(peers.x, peers.y);
    this.layoutPeers(peers.width, peers.height, sceneLayout.responsive);
    const offer = sceneLayout.sections.offer;
    this.offerBand.position.set(offer.x, offer.y);
    this.layoutOffer(offer.width, offer.height, sceneLayout.responsive);
    const activity = sceneLayout.sections.activity;
    this.activityBand.position.set(activity.x, activity.y);
    this.layoutActivity(activity.width, activity.height, sceneLayout.responsive);
    this.applySectionVisibility(sceneLayout.responsive);
  }

  private layoutIdentity(width: number, height: number, responsive: boolean): void {
    const manual = this.connectMode === 'manual' && this.desktopRuntime && this.snapshot.running;
    const controls = getExchangeIdentityControls(width, height, manual, responsive);
    this.identityBg
      .clear()
      .roundRect(0, 0, width, height, responsive ? 6 : 0)
      .fill({ color: COLORS.panel, alpha: 0.88 })
      .stroke({ color: COLORS.line, width: 1 });

    const side = responsive ? (width < 360 ? 14 : 18) : 18;
    const markSize = responsive ? (controls.shallow ? 42 : 48) : 54;
    const markY = responsive ? 14 : 20;
    this.identityMark
      .clear()
      .roundRect(side, markY, markSize, markSize, 8)
      .fill({ color: COLORS.gold, alpha: 0.92 })
      .stroke({ color: COLORS.paper, width: 1, alpha: 0.42 });
    this.identityGlyph.style.fontSize = responsive ? 15 : 18;
    this.identityGlyph.position.set(side + markSize / 2, markY + markSize / 2);
    this.identityTitle.style.fontSize = responsive ? 18 : 20;
    this.identityTitle.position.set(side + markSize + 12, responsive ? 14 : 21);
    this.identityMeta.position.set(side + markSize + 13, responsive ? 41 : 53);
    this.identityMeta.visible = true;
    const peerIdLabel = this.snapshot.identity
      ? `PEER  ${shortPeerId(this.snapshot.identity.peerId)}`
      : 'PEER  节点未启动';
    this.peerIdText.position.set(side, responsive ? (controls.shallow ? 65 : 80) : 92);
    fitText(this.peerIdText, peerIdLabel, width - side * 2);
    this.verifiedBg
      .clear()
      .roundRect(0, 0, Math.min(width - side * 2, 150), 30, 7)
      .fill({ color: COLORS.jade, alpha: 0.08 })
      .stroke({ color: COLORS.jade, width: 1, alpha: 0.36 });
    this.verifiedIcon.position.set(11, 7);
    this.verifiedText.position.set(34, 8);
    this.verifiedBadge.position.set(side, responsive ? 106 : 122);
    this.verifiedBadge.visible = !controls.shallow && this.desktopRuntime && Boolean(this.snapshot.identity);

    this.nodeToggleButton.position.set(controls.nodeToggle.x, controls.nodeToggle.y);
    this.nodeToggleButton.setSize(controls.nodeToggle.width, controls.nodeToggle.height);
    this.copyCodeButton.visible = Boolean(controls.copyCode);
    if (controls.copyCode) {
      this.copyCodeButton.position.set(controls.copyCode.x, controls.copyCode.y);
      this.copyCodeButton.setSize(controls.copyCode.width, controls.copyCode.height);
    }
    this.connectionMode.visible = true;
    this.connectionMode.position.set(controls.connectionMode.x, controls.connectionMode.y);
    this.connectionMode.setSize(controls.connectionMode.width, controls.connectionMode.height);
    this.manualInput.visible = manual && Boolean(controls.manualInput);
    if (controls.manualInput) {
      this.manualInput.position.set(controls.manualInput.x, controls.manualInput.y);
      this.manualInput.setSize(controls.manualInput.width, controls.manualInput.height);
    }
    this.connectButton.visible = manual && Boolean(controls.connectButton);
    if (controls.connectButton) {
      this.connectButton.position.set(controls.connectButton.x, controls.connectButton.y);
      this.connectButton.setSize(controls.connectButton.width, controls.connectButton.height);
    }
    this.updateNodeControls();
  }

  private layoutPeers(width: number, height: number, responsive: boolean): void {
    const nextCapacity = getExchangePeerCapacity(height, responsive);
    if (nextCapacity !== this.peerCapacity) {
      this.peerCapacity = nextCapacity;
      this.rebuildPeers();
    }
    this.peerBandBg
      .clear()
      .roundRect(0, 0, width, height, responsive ? 6 : 0)
      .fill({ color: COLORS.panel, alpha: 0.72 })
      .stroke({ color: COLORS.line, width: 1 });
    this.peerTitle.position.set(18, 20);
    this.peerCount.anchor.set(1, 0);
    this.peerCount.position.set(width - 18, 28);
    this.peerRows.position.set(0, 0);
    this.peerViews.forEach((row, index) => this.layoutPeerRow(row, width, index, responsive));
    this.emptyMesh
      .clear()
      .circle(0, 0, 34)
      .stroke({ color: COLORS.paperFaint, width: 1, alpha: 0.22 })
      .circle(0, 0, 54)
      .stroke({ color: COLORS.jade, width: 1, alpha: 0.12 });
    this.emptyMesh.position.set(width / 2, height * 0.44);
    this.emptyIcon.anchor.set(0.5);
    this.emptyIcon.position.set(width / 2, height * 0.44);
    this.emptyText.anchor.set(0.5);
    this.emptyText.position.set(width / 2, height * 0.44 + 52);
  }

  private layoutPeerRow(row: PeerRow, width: number, index: number, responsive: boolean): void {
    const geometry = getExchangePeerRowLayout(width, index, responsive);
    const rowWidth = geometry.row.width;
    row.root.position.set(geometry.row.x, geometry.row.y);
    row.separator
      .clear()
      .moveTo(0, geometry.row.height - 6)
      .lineTo(rowWidth, geometry.row.height - 6)
      .stroke({ color: COLORS.line, width: 1, alpha: 0.8 });
    row.name.position.set(0, responsive ? 5 : 8);
    row.id.position.set(0, responsive ? 29 : 33);
    row.status.position.set(0, responsive ? 47 : 51);
    row.button.setSize(geometry.selectButton.width, geometry.selectButton.height);
    row.button.position.set(
      geometry.selectButton.x - geometry.row.x,
      geometry.selectButton.y - geometry.row.y,
    );
    const textWidth = Math.max(24, rowWidth - geometry.selectButton.width - 12);
    fitText(row.name, row.nameValue, textWidth);
    fitText(row.id, row.idValue, textWidth);
    fitText(row.status, row.statusValue, textWidth);
  }

  private layoutOffer(width: number, height: number, responsive: boolean): void {
    this.offerBg
      .clear()
      .roundRect(0, 0, width, height, responsive ? 6 : 0)
      .fill({ color: COLORS.panel, alpha: 0.54 })
      .stroke({ color: COLORS.line, width: 1, alpha: responsive ? 1 : 0 });
    this.offerTitle.position.set(18, 20);
    this.deckCid.text = this.deckCidLabel;

    if (responsive) {
      const controls = getExchangeOfferControls(width, height);
      this.deckCard.setSize(controls.card.width);
      this.deckCard.position.set(
        controls.card.x + controls.card.width / 2,
        controls.card.y + controls.card.height / 2,
      );
      const detailsWidth = controls.details.width;
      this.deckName.anchor.set(0, 0);
      this.deckName.style.fontSize = width < 360 ? 16 : 18;
      this.deckName.position.set(controls.details.x, 58);
      fitText(this.deckName, this.selectedDeck.name, detailsWidth);
      this.deckCid.anchor.set(0, 0);
      this.deckCid.position.set(controls.details.x, 88);
      fitText(this.deckCid, this.deckCidLabel, detailsWidth);
      this.deckSelectButton.setSize(controls.deckSelect.width, controls.deckSelect.height);
      this.deckSelectButton.position.set(controls.deckSelect.x, controls.deckSelect.y);
      this.recipientText.anchor.set(0, 0);
      this.recipientText.position.set(controls.recipient.x, controls.recipient.y);
      fitText(this.recipientText, this.recipientLabel, detailsWidth);
      this.sendButton.setSize(controls.send.width, controls.send.height);
      this.sendButton.position.set(controls.send.x, controls.send.y);
      return;
    }

    this.deckName.style.fontSize = 18;
    const cardWidth = Math.min(176, Math.max(128, height * 0.29), width * 0.44);
    const cardHeight = cardWidth * (88 / 63);
    this.deckCard.setSize(cardWidth);
    this.deckCard.position.set(width / 2, 72 + cardHeight / 2);
    const textY = 84 + cardHeight;
    this.deckName.anchor.set(0.5, 0);
    this.deckName.position.set(width / 2, textY);
    fitText(this.deckName, this.selectedDeck.name, width - 28);
    this.deckCid.anchor.set(0.5, 0);
    this.deckCid.position.set(width / 2, textY + 30);
    fitText(this.deckCid, this.deckCidLabel, width - 28);
    this.deckSelectButton.setSize(Math.min(230, width - 36), 36);
    this.deckSelectButton.position.set((width - this.deckSelectButton.width) / 2, height - 148);
    this.recipientText.anchor.set(0.5, 0);
    this.recipientText.position.set(width / 2, height - 102);
    fitText(this.recipientText, this.recipientLabel, width - 28);
    this.sendButton.setSize(Math.min(210, width - 36), 42);
    this.sendButton.position.set((width - this.sendButton.width) / 2, height - 58);
  }

  private layoutActivity(width: number, height: number, responsive: boolean): void {
    const grid = getExchangeActivityGrid(width, height, responsive);
    const nextCapacity = grid.capacity;
    if (nextCapacity !== this.offerCapacity) {
      this.offerCapacity = nextCapacity;
      this.rebuildOffers();
    }
    this.activityBg
      .clear()
      .roundRect(0, 0, width, height, responsive ? 6 : 0)
      .fill({ color: COLORS.inkSoft, alpha: 0.94 })
      .stroke({ color: COLORS.line, width: 1 });
    this.activityTitle.position.set(responsive ? grid.side : 0, 16);
    this.offerRows.position.set(0, 0);
    this.offerViews.forEach((row, index) => {
      this.layoutOfferRow(row, index, grid, responsive);
    });
    this.emptyOffers.position.set(responsive ? grid.side : 128, responsive ? 58 : 46);
  }

  private layoutOfferRow(
    row: OfferRow,
    index: number,
    grid: ReturnType<typeof getExchangeActivityGrid>,
    responsive: boolean,
  ): void {
    const column = index % grid.columns;
    const x = grid.side + column * (grid.rowWidth + grid.columnGap);
    const y = grid.rowsTop + Math.floor(index / grid.columns) * grid.rowStride;
    const width = grid.rowWidth;
    row.root.position.set(x, y);
    row.separator
      .clear()
      .moveTo(0, 62)
      .lineTo(width, 62)
      .stroke({ color: COLORS.line, width: 1 });
    row.title.position.set(0, 2);
    row.meta.position.set(0, 27);
    row.status.anchor.set(1, 0);
    row.status.position.set(width, 5);
    fitText(row.title, row.titleValue, Math.max(24, width - row.status.width - 14));
    const acceptButtonWidth = responsive ? 72 : 68;
    const declineButtonWidth = responsive ? 72 : 68;
    fitText(
      row.meta,
      row.metaValue,
      row.accept && row.decline
        ? width - acceptButtonWidth - declineButtonWidth - 18
        : width,
    );
    if (row.accept && row.decline) {
      const buttonHeight = responsive ? 34 : 30;
      row.accept.setSize(acceptButtonWidth, buttonHeight);
      row.decline.setSize(declineButtonWidth, buttonHeight);
      row.decline.position.set(
        width - acceptButtonWidth - declineButtonWidth - 8,
        responsive ? 29 : 30,
      );
      row.accept.position.set(width - acceptButtonWidth, responsive ? 29 : 30);
    }
  }

  private async loadNodeState(): Promise<void> {
    const requestVersion = this.snapshotRequestVersion;
    try {
      const snapshot = await getP2pSnapshot();
      if (this.disposed || requestVersion !== this.snapshotRequestVersion) return;
      this.applySnapshot(snapshot);
      if (!this.desktopRuntime) {
        this.statusText.text = '仅桌面版启用 P2P';
        return;
      }
      if (snapshot.running) this.schedulePoll();
    } catch (error) {
      if (this.disposed || requestVersion !== this.snapshotRequestVersion) return;
      this.statusText.text = '节点状态读取失败';
      this.toast.error(error instanceof Error ? error.message : '无法读取 P2P 节点状态。');
    }
  }

  private async toggleNode(): Promise<void> {
    if (this.disposed || this.nodeTransitionInFlight || !this.desktopRuntime) return;
    const wasRunning = this.snapshot.running;
    this.nodeTransitionInFlight = true;
    this.snapshotRequestVersion += 1;
    this.updateNodeControls();
    try {
      if (wasRunning) {
        const snapshot = await stopP2p(null);
        if (this.disposed) return;
        this.nodeLeaseId = undefined;
        if (this.pollTimer !== undefined) window.clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
        this.applySnapshot(snapshot);
        this.toast.info('本机交换已停止，不再发现或接受连接。');
        return;
      }

      const result = await startP2p(this.selectedDeck.author || '万象学徒');
      if (this.disposed) {
        if (result.leaseId) void stopP2p(result.leaseId).catch(() => undefined);
        return;
      }
      this.nodeLeaseId = result.leaseId ?? undefined;
      this.applySnapshot(result.snapshot);
      if (result.snapshot.running) this.schedulePoll();
      this.toast.success(
        result.leaseId ? '本机交换已启动。' : '已连接正在运行的本机交换节点。',
      );
    } catch (error) {
      if (this.disposed) return;
      this.statusText.text = wasRunning ? '节点停止失败' : '节点启动失败';
      this.toast.error(
        error instanceof Error
          ? error.message
          : wasRunning
            ? 'P2P 节点停止失败。'
            : 'P2P 节点启动失败。',
      );
    } finally {
      if (!this.disposed) {
        this.nodeTransitionInFlight = false;
        this.updateNodeControls();
      }
    }
  }

  private updateNodeControls(): void {
    const running = this.desktopRuntime && this.snapshot.running;
    this.nodeToggleButton.setLabel(
      this.nodeTransitionInFlight
        ? running
          ? '正在停止交换…'
          : '正在启动交换…'
        : running
          ? '停止本机交换'
          : this.desktopRuntime
            ? '启动本机交换'
            : '仅桌面版可启动',
    );
    this.nodeToggleButton.setIcon(running ? 'x' : 'network');
    this.nodeToggleButton.setDisabled(!this.desktopRuntime || this.nodeTransitionInFlight);
    this.copyCodeButton.setDisabled(
      !running || this.nodeTransitionInFlight || !this.snapshot.identity?.connectionCode,
    );
    this.connectionMode.setDisabled(!running || this.nodeTransitionInFlight);
    this.manualInput.setDisabled(!running || this.nodeTransitionInFlight);
    this.connectButton.setDisabled(!running || this.nodeTransitionInFlight);
    this.updateSelection();
  }

  private schedulePoll(): void {
    if (
      this.disposed
      || !this.desktopRuntime
      || !this.snapshot.running
      || this.pollTimer !== undefined
    ) return;
    this.pollTimer = window.setTimeout(async () => {
      this.pollTimer = undefined;
      await this.refreshSnapshot();
      if (this.snapshot.running) this.schedulePoll();
    }, 1400);
  }

  private async refreshSnapshot(): Promise<void> {
    if (this.disposed || this.refreshInFlight) return;
    this.refreshInFlight = true;
    const requestVersion = this.snapshotRequestVersion;
    try {
      const snapshot = await getP2pSnapshot();
      if (this.disposed || requestVersion !== this.snapshotRequestVersion) return;
      this.applySnapshot(snapshot);
    } catch (error) {
      if (this.disposed || requestVersion !== this.snapshotRequestVersion) return;
      this.statusText.text = '节点连接异常';
      if (error instanceof Error) this.snapshot.lastError = error.message;
    } finally {
      this.refreshInFlight = false;
    }
  }

  private applySnapshot(snapshot: P2pSnapshot): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    this.statusText.text = snapshot.running ? '节点在线 · 端到端加密' : '节点离线';
    const signature = JSON.stringify({
      running: snapshot.running,
      identity: snapshot.identity
        ? [
            snapshot.identity.peerId,
            snapshot.identity.displayName,
            snapshot.identity.connectionCode,
            snapshot.identity.listenAddresses,
          ]
        : null,
      peers: snapshot.peers.map((peer) => [
        peer.peerId,
        peer.displayName,
        peer.address,
        peer.connected,
        peer.nearby,
        peer.verified,
      ]),
      offers: snapshot.offers.map((offer) => [
        offer.id,
        offer.direction,
        offer.status,
        offer.signatureValid,
        offer.peerId,
        offer.peerName,
        offer.cid,
        offer.deck.id,
        offer.deck.name,
      ]),
    });
    if (signature !== this.snapshotSignature) {
      this.snapshotSignature = signature;
      this.rebuildPeers();
      this.rebuildOffers();
    }
    this.archiveCompletedOffers();
    if (this.selectedPeerId && !snapshot.peers.some((peer) => peer.peerId === this.selectedPeerId)) {
      this.selectedPeerId = undefined;
    }
    this.updateSelection();
    this.updateNodeControls();
    if (this.viewport) this.layout(this.viewport);
  }

  private rebuildPeers(): void {
    this.peerRows.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.peerViews = this.snapshot.peers
      .slice(0, this.peerCapacity)
      .map((peer) => this.createPeerRow(peer));
    this.peerViews.forEach((row) => this.peerRows.addChild(row.root));
    this.peerCount.text = `${this.snapshot.peers.filter((peer) => peer.connected).length} ONLINE`;
    this.emptyPeers.visible = this.snapshot.peers.length === 0;
  }

  private createPeerRow(peer: P2pPeer): PeerRow {
    const root = new Container();
    const separator = new Graphics();
    const name = new Text({
      text: peer.displayName || '匿名锻卡师',
      style: new TextStyle({
        fontFamily: DISPLAY_FONT,
        fontSize: 15,
        fontWeight: '700',
        fill: COLORS.paper,
        letterSpacing: 0,
      }),
    });
    const id = new Text({
      text: shortPeerId(peer.peerId),
      style: new TextStyle({
        fontFamily: FONT_FAMILY,
        fontSize: 9,
        fontWeight: '600',
        fill: COLORS.paperFaint,
        letterSpacing: 0,
      }),
    });
    const status = new Text({
      text: `${peer.nearby ? '附近' : '直连'}  ·  ${peer.verified ? '身份已验证' : '待验证'}`,
      style: new TextStyle({
        fontFamily: FONT_FAMILY,
        fontSize: 9,
        fontWeight: '600',
        fill: peer.verified ? COLORS.jade : COLORS.gold,
        letterSpacing: 0,
      }),
    });
    const button = new CanvasButton({
      label: this.selectedPeerId === peer.peerId ? '已选择' : '选择',
      variant: this.selectedPeerId === peer.peerId ? 'primary' : 'secondary',
      onPress: () => {
        this.selectedPeerId = peer.peerId;
        this.updateSelection();
        this.rebuildPeers();
        if (this.responsiveLayout) {
          this.activeSection = 'offer';
          this.sectionTabs.setValue('offer');
        }
        if (this.viewport) this.layout(this.viewport);
      },
    });
    root.addChild(separator, name, id, status, button);
    return {
      root,
      separator,
      name,
      id,
      status,
      button,
      peerId: peer.peerId,
      nameValue: peer.displayName || '匿名锻卡师',
      idValue: shortPeerId(peer.peerId),
      statusValue: `${peer.nearby ? '附近' : '直连'}  ·  ${peer.verified ? '身份已验证' : '待验证'}`,
    };
  }

  private rebuildOffers(): void {
    this.offerRows.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.offerViews = this.snapshot.offers
      .slice(0, this.offerCapacity)
      .map((offer) => this.createOfferRow(offer));
    this.offerViews.forEach((row) => this.offerRows.addChild(row.root));
    this.emptyOffers.visible = this.snapshot.offers.length === 0;
  }

  private archiveCompletedOffers(): void {
    for (const offer of this.snapshot.offers) {
      if (
        offer.status !== 'completed' ||
        !offer.signatureValid ||
        this.archivedOfferIds.has(offer.id) ||
        this.archivingOfferIds.has(offer.id)
      ) continue;
      this.archivingOfferIds.add(offer.id);
      void this.onDeckReceived(offer.deck, offer.id)
        .then((saved) => {
          if (saved) this.archivedOfferIds.add(offer.id);
        })
        .catch(() => undefined)
        .finally(() => this.archivingOfferIds.delete(offer.id));
    }
  }

  private createOfferRow(offer: ExchangeOffer): OfferRow {
    const root = new Container();
    const separator = new Graphics();
    const title = new Text({
      text: `${offer.direction === 'incoming' ? '收到' : '发出'} · ${offer.deck.name}`,
      style: new TextStyle({
        fontFamily: DISPLAY_FONT,
        fontSize: 13,
        fontWeight: '700',
        fill: COLORS.paper,
        letterSpacing: 0,
      }),
    });
    const meta = new Text({
      text: `${offer.peerName || shortPeerId(offer.peerId)}  ·  ${offer.signatureValid ? '签名有效' : '签名待验证'}`,
      style: new TextStyle({
        fontFamily: FONT_FAMILY,
        fontSize: 9,
        fontWeight: '500',
        fill: offer.signatureValid ? COLORS.jade : COLORS.paperFaint,
        letterSpacing: 0,
      }),
    });
    const status = new Text({
      text: offerStatusLabel(offer),
      style: new TextStyle({
        fontFamily: FONT_FAMILY,
        fontSize: 9,
        fontWeight: '700',
        fill: offer.status === 'completed' ? COLORS.jade : offer.status === 'failed' ? COLORS.danger : COLORS.gold,
        letterSpacing: 0,
      }),
    });
    let accept: CanvasButton | undefined;
    let decline: CanvasButton | undefined;
    if (offer.direction === 'incoming' && offer.status === 'pending') {
      accept = new CanvasButton({
        label: '接受',
        icon: 'check',
        variant: 'primary',
        onPress: () => this.acceptOffer(offer),
      });
      accept.setDisabled(!this.snapshot.running || !this.selectedDeckExchangeable);
      decline = new CanvasButton({
        label: '谢绝',
        icon: 'x',
        variant: 'ghost',
        onPress: () => this.declineOffer(offer),
      });
      decline.setDisabled(!this.snapshot.running);
    }
    root.addChild(separator, title, meta, status);
    if (decline) root.addChild(decline);
    if (accept) root.addChild(accept);
    return {
      offerId: offer.id,
      root,
      separator,
      title,
      meta,
      status,
      accept,
      decline,
      titleValue: `${offer.direction === 'incoming' ? '收到' : '发出'} · ${offer.deck.name}`,
      metaValue: `${offer.peerName || shortPeerId(offer.peerId)}  ·  ${offer.signatureValid ? '签名有效' : '签名待验证'}`,
    };
  }

  private updateConnectMode(): void {
    const manual = this.connectMode === 'manual' && this.desktopRuntime && this.snapshot.running;
    this.manualInput.visible = manual;
    this.connectButton.visible = manual;
    this.copyCodeButton.visible = !manual;
    if (!manual) this.manualInput.blur();
    this.updateNodeControls();
    if (this.viewport) this.layout(this.viewport);
  }

  private applySectionVisibility(responsive: boolean): void {
    this.sectionTabs.visible = responsive;
    this.identityBand.visible = !responsive || this.activeSection === 'identity';
    this.peerBand.visible = !responsive || this.activeSection === 'peers';
    this.offerBand.visible = !responsive || this.activeSection === 'offer';
    this.activityBand.visible = !responsive || this.activeSection === 'activity';
    if (!this.identityBand.visible) this.manualInput.blur();
  }

  private updateSelection(): void {
    const peer = this.snapshot.peers.find((candidate) => candidate.peerId === this.selectedPeerId);
    this.recipientLabel = peer
      ? `交换对象  ${peer.displayName || shortPeerId(peer.peerId)}`
      : '尚未选择节点';
    this.recipientText.text = this.recipientLabel;
    this.recipientText.style.fill = peer ? COLORS.jade : COLORS.paperMuted;
    this.sendButton.setDisabled(
      !this.desktopRuntime
      || !this.snapshot.running
      || !this.selectedDeckExchangeable
      || !peer
      || !peer.connected
      || !peer.verified,
    );
  }

  private async copyConnectionCode(): Promise<void> {
    if (!this.snapshot.running) return;
    const code = this.snapshot.identity?.connectionCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      if (this.disposed) return;
      this.toast.success('连接码已复制。');
    } catch {
      if (this.disposed) return;
      this.toast.error('无法访问剪贴板。');
    }
  }

  private async connectManual(): Promise<void> {
    if (!this.snapshot.running) {
      this.toast.info('请先启动本机交换。');
      return;
    }
    const code = this.manualInput.value.trim();
    if (!code) {
      this.manualInput.focus();
      return;
    }
    this.connectButton.setDisabled(true);
    try {
      await connectPeer(code);
      if (this.disposed) return;
      this.toast.success('直连请求已发出。');
      this.manualInput.setValue('');
      await this.refreshSnapshot();
    } catch (error) {
      if (this.disposed) return;
      this.toast.error(error instanceof Error ? error.message : '无法建立直连。');
    } finally {
      if (!this.disposed) this.updateNodeControls();
    }
  }

  private async sendOffer(): Promise<void> {
    if (!this.snapshot.running) {
      this.toast.info('请先启动本机交换。');
      return;
    }
    if (!this.selectedDeckExchangeable) {
      this.toast.info('个人同人研习套牌仅限本机，不能交换。');
      return;
    }
    if (!this.selectedPeerId) return;
    this.sendButton.setDisabled(true);
    try {
      await sendDeckOffer(this.selectedPeerId, this.selectedDeck);
      if (this.disposed) return;
      this.toast.success('交换请求已送达，等待对方回应。');
      await this.refreshSnapshot();
    } catch (error) {
      if (this.disposed) return;
      this.toast.error(error instanceof Error ? error.message : '交换请求发送失败。');
    } finally {
      if (!this.disposed) this.updateSelection();
    }
  }

  private async respond(offer: ExchangeOffer, accept: boolean): Promise<void> {
    try {
      if (!this.snapshot.running) {
        throw new Error('请先启动本机交换。');
      }
      if (accept && !this.selectedDeckExchangeable) {
        throw new Error('请先选择一套可交换的原创套牌作为回赠。');
      }
      if (accept && !offer.signatureValid) {
        throw new Error('对方卡包签名无效，已阻止交换。');
      }
      if (accept) this.toast.info('正在验证签名并交换卡包…');
      await respondToOffer(offer.id, accept, accept ? this.selectedDeck : undefined);
      if (this.disposed) return;
      this.toast.show(accept ? '已接受请求，正在交换并验证卡包。' : '已谢绝本次交换。', accept ? 'success' : 'info');
      await this.refreshSnapshot();
    } catch (error) {
      if (this.disposed) return;
      this.toast.error(error instanceof Error ? error.message : '回应交换请求失败。');
    }
  }

  private acceptOffer(offer: ExchangeOffer): void {
    void this.respond(offer, true);
  }

  private declineOffer(offer: ExchangeOffer): void {
    void this.respond(offer, false);
  }

  private selectNextDeck(): void {
    const nextIndex = findNextExchangeableDeckIndex(
      this.decks,
      this.selectedDeckIndex,
      canExchangeDeck,
    );
    if (nextIndex === null) {
      this.toast.info('没有其他可交换的原创套牌。');
      return;
    }
    this.selectedDeckIndex = nextIndex;
    this.updateDeckSelection();
    this.toast.info(`已选择「${this.selectedDeck.name}」作为交换套牌。`);
    if (this.viewport) this.layout(this.viewport);
  }

  private updateDeckSelection(): void {
    const deck = this.selectedDeck;
    const exchangeable = canExchangeDeck(deck);
    const nextExchangeableIndex = findNextExchangeableDeckIndex(
      this.decks,
      this.selectedDeckIndex,
      canExchangeDeck,
    );
    this.deckName.text = deck.name;
    const cid = shortDeckCid(deck);
    this.deckCidLabel = exchangeable
      ? (cid ? `内容版本  ${cid}` : 'CID  发送时生成')
      : '仅限本机  ·  不能交换';
    this.deckCid.text = this.deckCidLabel;
    this.deckCid.style.fill = exchangeable ? COLORS.paperFaint : COLORS.coral;
    this.sendButton.setLabel(
      exchangeable
        ? '发送交换请求'
        : '仅限本机，不能交换',
    );
    this.sendButton.setIcon(exchangeable ? 'send' : 'shield');
    this.deckSelectButton.setLabel(
      !exchangeable && nextExchangeableIndex !== null
        ? '切换可交换原创套牌'
        : nextExchangeableIndex !== null
        ? `选择交换套牌  ${this.selectedDeckIndex + 1}/${this.decks.length}`
        : exchangeable
          ? '当前原创套牌用于交换'
          : '没有可交换的原创套牌',
    );
    this.deckSelectButton.setDisabled(nextExchangeableIndex === null);
    const card = deck.cards[0];
    if (card) {
      this.deckCard
        ?.setData(card)
        .setArtStyle(deck.artStyleId)
        .setGameplayContext(deck.ruleKit?.modules)
        .setBackDesign(deck.cardBack, deck.name)
        .setFlipped(false, true);
    }
    this.rebuildOffers();
    this.updateSelection();
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.disposed = true;
    this.snapshotRequestVersion += 1;
    if (this.pollTimer !== undefined) window.clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    const leaseId = this.nodeLeaseId;
    this.nodeLeaseId = undefined;
    if (leaseId) void stopP2p(leaseId).catch(() => undefined);
    super.destroy(options ?? { children: true });
  }
}
