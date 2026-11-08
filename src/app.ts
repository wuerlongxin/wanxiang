import {
  Application,
  Container,
  Graphics,
  Text,
  TextStyle,
  type FederatedPointerEvent,
} from 'pixi.js';
import { gsap } from 'gsap';
import { BackgroundField } from './background';
import { getArtStyleUiTheme } from './art-styles';
import { createStarterDeck, GAME_MODES, MODE_BY_ID } from './data';
import { assessDeckPrintReadiness } from './deck-composition';
import { ExchangeScene } from './scenes/exchange';
import { BattleScene } from './scenes/battle';
import { ContentPolicyScene } from './scenes/content-policy';
import { LibraryScene } from './scenes/library';
import { LobbyScene } from './scenes/lobby';
import { RuleBuilderScene } from './scenes/rule-builder';
import { DeckShowcaseScene } from './scenes/showcase';
import { StudioScene } from './scenes/studio';
import { DeckStorageError, loadDeckLibrary, saveDeckLibrary } from './services/storage';
import { validateDeckExportPolicy } from './services/content-policy';
import {
  createNextDeckRevision,
  deckRevisionReference,
  deckVersionCid,
  deckVersionKey,
  findDeckVersion,
} from './services/deck-identity';
import { COLORS, FONT_FAMILY } from './theme';
import type {
  DeckData,
  DeckLibraryData,
  DeckRevisionReason,
  GameMode,
  SceneId,
  Viewport,
  ViewportInsets,
} from './types';
import { getRecommendedDpr, getViewport } from './utils';
import { hideInteractionHint, InteractionHintLayer } from './interaction-hints';
import { audioEngine } from './services/audio';
import {
  DeckProjectError,
  exportDeckProject,
  importDeckProject,
} from './services/deck-project';

const WEBGL_INIT_TIMEOUT_MS = 3_200;
const CANVAS_INIT_TIMEOUT_MS = 3_200;
const LIBRARY_RESTORE_TIMEOUT_MS = 2_500;

type BootProgress = (stage: string, message: string) => void;

const ignoreBootProgress: BootProgress = () => undefined;

async function withStartupTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: number | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return await Promise.race([task, timeout]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function readSafeAreaInsets(): Partial<ViewportInsets> {
  const style = window.getComputedStyle(document.documentElement);
  return {
    top: cssPixels(style.getPropertyValue('--safe-area-top')),
    right: cssPixels(style.getPropertyValue('--safe-area-right')),
    bottom: cssPixels(style.getPropertyValue('--safe-area-bottom')),
    left: cssPixels(style.getPropertyValue('--safe-area-left')),
  };
}

export class WanxiangDeckApp {
  pixi = new Application();
  private readonly background = new BackgroundField();
  private readonly sceneLayer = new Container();
  private readonly transitionLayer = new Container();
  private readonly transitionFill = new Graphics();
  private readonly transitionSeal = new Graphics();
  private readonly transitionSealText = new Text({
    text: '万象',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 20,
      fontWeight: '700',
      fill: COLORS.gold,
      letterSpacing: 0,
    }),
  });
  private readonly statusPill = new Container();
  private readonly interactionHints = new InteractionHintLayer();
  private readonly statusBg = new Graphics();
  private readonly statusText = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 12,
      fontWeight: '600',
      fill: COLORS.paper,
      letterSpacing: 0,
    }),
  });
  private currentScene?: LobbyScene | StudioScene | RuleBuilderScene | LibraryScene | ExchangeScene | DeckShowcaseScene | ContentPolicyScene | BattleScene;
  private sceneId: SceneId = 'lobby';
  private currentDeck: DeckData = createStarterDeck('strategy');
  private readonly localDecks = new Map<string, DeckData>();
  private readonly persistedDeckKeys = new Set<string>();
  private readonly receivedOfferIds = new Set<string>();
  private editableDeckKey: string | null = null;
  private viewport!: Viewport;
  private switching = false;
  private statusTimer?: number;
  private persistenceTimer?: number;
  private resizeFrame?: number;
  private libraryRevision = 0;
  private persistedRevision = 0;
  private persistenceTask?: Promise<void>;
  private storageBlocked = false;
  private lastPersistenceErrorAt = 0;
  private destroyed = false;
  private detachAudioLifecycle?: () => void;

  async init(root: HTMLElement, bootProgress: BootProgress = ignoreBootProgress): Promise<void> {
    const initialWidth = Math.max(1, window.innerWidth);
    const initialHeight = Math.max(1, window.innerHeight);
    const resolution = getRecommendedDpr(
      initialWidth,
      initialHeight,
      window.devicePixelRatio || 1,
    );
    const rendererOptions = {
      width: window.innerWidth,
      height: window.innerHeight,
      resolution,
      autoDensity: true,
      antialias: true,
      backgroundColor: COLORS.ink,
      backgroundAlpha: 1,
      powerPreference: 'high-performance' as const,
    };
    try {
      bootProgress('初始化 WebGL 光影画布', '正在点亮 WebGL 光影画布...');
      await withStartupTimeout(
        this.pixi.init({ ...rendererOptions, preference: ['webgl'] }),
        WEBGL_INIT_TIMEOUT_MS,
        'WebGL 初始化超时',
      );
      root.dataset.renderer = 'webgl';
    } catch (webglError) {
      console.warn('[Wanxiang Deck] WebGL 初始化失败或超时，切换 Canvas 渲染。', webglError);
      this.pixi = new Application();
      bootProgress('初始化 Canvas 安全画布', 'WebGL 未响应，正在切换安全画布...');
      await withStartupTimeout(
        this.pixi.init({ ...rendererOptions, preference: ['canvas'] }),
        CANVAS_INIT_TIMEOUT_MS,
        'Canvas 初始化超时',
      );
      root.dataset.renderer = 'canvas';
    }
    bootProgress('挂载本地画布', '正在挂载本地画布...');
    this.pixi.canvas.tabIndex = 0;
    this.pixi.canvas.setAttribute('role', 'application');
    this.pixi.canvas.setAttribute('aria-label', '万象卡域互动卡牌工作台');
    root.appendChild(this.pixi.canvas);

    this.pixi.stage.sortableChildren = true;
    this.background.zIndex = 0;
    this.sceneLayer.zIndex = 10;
    this.transitionLayer.zIndex = 1000;
    this.statusPill.zIndex = 1200;
    this.interactionHints.zIndex = 1400;
    this.transitionLayer.eventMode = 'none';
    this.statusPill.addChild(this.statusBg, this.statusText);
    this.statusPill.visible = false;
    this.pixi.stage.addChild(
      this.background,
      this.sceneLayer,
      this.transitionLayer,
      this.statusPill,
      this.interactionHints,
    );
    this.pixi.stage.on('pointerdowncapture', this.handleAudioUnlock);
    this.pixi.stage.on('pointertapcapture', this.handleInteractiveTap);
    this.detachAudioLifecycle = audioEngine.bindLifecycle();
    this.transitionSealText.anchor.set(0.5);
    this.transitionLayer.addChild(this.transitionFill, this.transitionSeal, this.transitionSealText);

    bootProgress('铺设动态画卷', '正在铺设动态画卷...');
    this.resize();
    bootProgress('读取本地作品库', '正在读取本地作品库...');
    await this.restoreLibrary();
    bootProgress('进入首页大厅', '正在进入首页大厅...');
    this.openLobby(false);
    window.addEventListener('resize', this.scheduleResize, { passive: true });
    window.addEventListener('orientationchange', this.scheduleResize, { passive: true });
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private resize = (): void => {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const resolution = getRecommendedDpr(width, height, window.devicePixelRatio || 1);
    this.pixi.renderer.resize(width, height, resolution);
    this.viewport = getViewport(width, height, resolution, {
      devicePixelRatio: window.devicePixelRatio || 1,
      safeArea: readSafeAreaInsets(),
    });
    this.pixi.stage.hitArea = this.pixi.screen;
    this.background.layout(width, height, this.viewport.phone);
    this.interactionHints.layout(width, height);
    this.currentScene?.layout(this.viewport);
    this.transitionFill
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: COLORS.ink, alpha: 0.98 })
      .rect(0, 0, width, 4)
      .fill({ color: COLORS.gold, alpha: 0.64 })
      .rect(0, height - 4, width, 4)
      .fill({ color: COLORS.cinnabar, alpha: 0.52 })
      .moveTo(0, height * 0.36)
      .bezierCurveTo(width * 0.24, height * 0.26, width * 0.58, height * 0.46, width, height * 0.3)
      .stroke({ color: COLORS.cinnabar, width: Math.max(42, height * 0.11), alpha: 0.08 })
      .moveTo(0, height * 0.72)
      .bezierCurveTo(width * 0.3, height * 0.58, width * 0.68, height * 0.84, width, height * 0.62)
      .stroke({ color: COLORS.gold, width: Math.max(24, height * 0.06), alpha: 0.055 });
    this.transitionFill.pivot.set(width / 2, height / 2);
    this.transitionFill.position.set(width / 2, height / 2);
    this.transitionFill.scale.set(0, 1);
    this.transitionFill.alpha = 1;
    const sealSize = Math.min(72, Math.max(52, width * 0.06));
    this.transitionSeal
      .clear()
      .roundRect(-sealSize / 2, -sealSize / 2, sealSize, sealSize, 4)
      .fill({ color: COLORS.cinnabar, alpha: 0.2 })
      .stroke({ color: COLORS.gold, width: 2, alpha: 0.88 })
      .rect(-sealSize / 2 + 6, -sealSize / 2 + 6, sealSize - 12, sealSize - 12)
      .stroke({ color: COLORS.cinnabar, width: 1, alpha: 0.78 });
    this.transitionSeal.position.set(width / 2, height / 2);
    this.transitionSealText.style.fontSize = Math.max(16, sealSize * 0.3);
    this.transitionSealText.position.set(width / 2, height / 2);
    this.transitionSeal.alpha = 0;
    this.transitionSealText.alpha = 0;
    this.layoutStatus();
  };

  private scheduleResize = (): void => {
    if (this.resizeFrame !== undefined) return;
    this.resizeFrame = window.requestAnimationFrame(() => {
      this.resizeFrame = undefined;
      this.resize();
    });
  };

  private openLobby(animate = true): void {
    const scene = new LobbyScene({
      onLibrary: () => this.openLibrary(),
      onStudio: () => this.openStudio(),
      onRules: () => this.openRules(),
      onExchange: () => this.openExchange(),
      onBattle: () => this.openBattle(),
      onChoose: (mode) => {
        this.setCurrentDeck(createStarterDeck(mode.id), true);
        this.openStudio(mode);
      },
    });
    this.sceneId = 'lobby';
    this.background.setPalette(COLORS.jade, COLORS.gold);
    this.swapScene(scene, animate);
  }

  private openStudio(
    mode: GameMode = MODE_BY_ID[this.currentDeck.modeId],
  ): void {
    this.ensureCurrentDeckStored();
    const scene = new StudioScene({
      deck: this.currentDeck,
      onHome: () => this.openLobby(),
      onLibrary: () => this.openLibrary(),
      onRules: () => this.openRules(),
      onExchange: () => this.openExchange(),
      onBattle: () => this.openBattle(),
      onDeckChange: (deck) => this.commitDeckEdit(deck),
      onDeckRevision: (deck, reason) => this.commitDeckRevision(deck, reason),
      onDeckCheckpoint: () => this.checkpointDeckStorage(),
      onContentPolicy: (deck) => {
        this.openContentPolicy(deck, 'studio');
      },
      onExport: () => void this.exportDeck(this.currentDeck),
    });
    this.sceneId = 'studio';
    const style = getArtStyleUiTheme(this.currentDeck.artStyleId);
    this.background.setPalette(style.accent, style.secondary);
    this.swapScene(scene, true);
  }

  private openRules(): void {
    this.ensureCurrentDeckStored();
    const scene = new RuleBuilderScene({
      deck: this.currentDeck,
      onHome: () => this.openLobby(),
      onStudio: () => this.openStudio(),
      onLibrary: () => this.openLibrary(),
      onExchange: () => this.openExchange(),
      onBattle: () => this.openBattle(),
      onBack: () => this.openStudio(),
      onDeckChange: (deck) => this.commitDeckEdit(deck),
    });
    this.sceneId = 'rules';
    const style = getArtStyleUiTheme(this.currentDeck.artStyleId);
    this.background.setPalette(style.accent, COLORS.gold);
    this.swapScene(scene, true);
  }

  private openExchange(): void {
    if (this.switching) return;
    this.ensureCurrentDeckStored();
    const scene = new ExchangeScene({
      deck: this.currentDeck,
      decks: [...this.localDecks.values()],
      onHome: () => this.openLobby(),
      onLibrary: () => this.openLibrary(),
      onStudio: () => this.openStudio(),
      onRules: () => this.openRules(),
      onBattle: () => this.openBattle(),
      onDeckReceived: (deck, offerId) => this.archiveReceivedDeck(deck, offerId),
    });
    this.sceneId = 'exchange';
    this.background.setPalette(COLORS.gold, COLORS.coral);
    this.swapScene(scene, true);
    scene.activate();
  }

  private openBattle(): void {
    if (this.switching) return;
    this.ensureCurrentDeckStored();
    const scene = new BattleScene({
      deck: this.currentDeck,
      onHome: () => this.openLobby(),
      onLibrary: () => this.openLibrary(),
      onStudio: () => this.openStudio(),
      onRules: () => this.openRules(),
      onExchange: () => this.openExchange(),
    });
    this.sceneId = 'battle';
    const style = getArtStyleUiTheme(this.currentDeck.artStyleId);
    this.background.setPalette(style.accent, COLORS.cinnabar);
    this.swapScene(scene, true);
  }

  private openLibrary(): void {
    const scene = new LibraryScene({
      decks: [...this.localDecks.values()],
      activeDeckKey: this.localDecks.has(deckVersionKey(this.currentDeck))
        ? deckVersionKey(this.currentDeck)
        : null,
      onHome: () => this.openLobby(),
      onStudio: () => this.openStudio(),
      onRules: () => this.openRules(),
      onExchange: () => this.openExchange(),
      onBattle: () => this.openBattle(),
      onOpen: (deck) => {
        const changed = deckVersionKey(deck) !== deckVersionKey(this.currentDeck);
        this.currentDeck = deck;
        this.editableDeckKey = null;
        if (changed) this.markLibraryChanged();
        this.openStudio();
      },
      onShowcase: (deck) => this.openShowcase(deck),
      onExport: (deck) => void this.exportDeck(deck),
      onProjectExport: (deck) => void this.saveDeckProject(deck),
      onProjectImport: () => void this.loadDeckProject(),
    });
    this.sceneId = 'library';
    const style = getArtStyleUiTheme(this.currentDeck.artStyleId);
    this.background.setPalette(style.accent, COLORS.gold);
    this.swapScene(scene, true);
  }

  private openShowcase(deck: DeckData): void {
    const activateDeck = (): void => {
      const changed = deckVersionKey(deck) !== deckVersionKey(this.currentDeck);
      this.currentDeck = deck;
      this.editableDeckKey = null;
      if (changed) this.markLibraryChanged();
    };
    const scene = new DeckShowcaseScene({
      deck,
      onHome: () => this.openLobby(),
      onLibrary: () => this.openLibrary(),
      onStudio: () => {
        activateDeck();
        this.openStudio();
      },
      onRules: () => {
        activateDeck();
        this.openRules();
      },
      onExchange: () => {
        activateDeck();
        this.openExchange();
      },
      onBattle: () => {
        activateDeck();
        this.openBattle();
      },
    });
    this.sceneId = 'library';
    const style = getArtStyleUiTheme(deck.artStyleId);
    this.background.setPalette(style.accent, COLORS.gold);
    this.swapScene(scene, true);
  }

  private openContentPolicy(
    deck: DeckData,
    returnTo: 'studio' | 'rules' | 'library',
    afterApply?: (deck: DeckData) => void,
  ): void {
    const returnToScene = (policySaved = false, returnedDeck = this.currentDeck): void => {
      if (returnTo === 'library') this.openLibrary();
      else if (returnTo === 'rules') this.openRules();
      else this.openStudio(MODE_BY_ID[this.currentDeck.modeId]);
    };
    const scene = new ContentPolicyScene({
      deck,
      onHome: () => this.openLobby(),
      onStudio: () => returnTo === 'studio' ? returnToScene(false) : this.openStudio(),
      onRules: () => this.openRules(),
      onLibrary: () => this.openLibrary(),
      onExchange: () => this.openExchange(),
      onBattle: () => this.openBattle(),
      onCancel: () => returnToScene(false),
      onApply: (nextDeck) => {
        const key = deckVersionKey(deck);
        let applied: DeckData;
        if (key === deckVersionKey(this.currentDeck)) {
          applied = this.commitDeckEdit(nextDeck);
        } else {
          applied = nextDeck;
          this.localDecks.set(key, applied);
          this.markLibraryChanged();
        }
        returnToScene(true, applied);
        afterApply?.(applied);
      },
    });
    this.sceneId = 'studio';
    this.background.setPalette(COLORS.cinnabar, COLORS.gold);
    this.swapScene(scene, true);
  }

  private setCurrentDeck(deck: DeckData, editable = false): DeckData {
    this.currentDeck = deck;
    const key = deckVersionKey(deck);
    this.localDecks.set(key, deck);
    this.editableDeckKey = editable ? key : null;
    if (this.sceneId === 'studio' || this.sceneId === 'rules') {
      const style = getArtStyleUiTheme(deck.artStyleId);
      this.background.setPalette(style.accent, style.secondary);
    }
    this.markLibraryChanged();
    return deck;
  }

  private commitDeckEdit(next: DeckData): DeckData {
    this.ensureCurrentDeckStored();
    const currentKey = deckVersionKey(this.currentDeck);
    if (this.editableDeckKey === currentKey && !this.currentDeck.provenance) {
      const { provenance: _nextProvenance, revision: _nextRevision, ...content } = next;
      return this.setCurrentDeck(
        {
          ...content,
          ...(this.currentDeck.revision ? { revision: this.currentDeck.revision } : {}),
        },
        true,
      );
    }

    const committed = createNextDeckRevision(
      this.localRevisionSource(this.currentDeck),
      next,
      'manual-snapshot',
      Date.now(),
      this.localDecks.values(),
    );
    this.showStatus('原版本已保留，修改写入新版本', false);
    return this.setCurrentDeck(committed, true);
  }

  private commitDeckRevision(next: DeckData, reason: DeckRevisionReason): DeckData {
    this.ensureCurrentDeckStored();
    const committed = createNextDeckRevision(
      this.localRevisionSource(this.currentDeck),
      next,
      reason,
      Date.now(),
      this.localDecks.values(),
    );
    return this.setCurrentDeck(committed, true);
  }

  private localRevisionSource(deck: DeckData): DeckData {
    if (!deck.provenance) return deck;
    const randomPart = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
    const localFamilyId = `${deck.id.slice(0, 88)}-local-${Date.now().toString(36)}-${randomPart}`;
    const { provenance: _provenance, revision: _revision, ...content } = deck;
    return { ...content, id: localFamilyId };
  }

  private ensureCurrentDeckStored(): void {
    const key = deckVersionKey(this.currentDeck);
    if (this.localDecks.has(key)) return;
    this.localDecks.set(key, this.currentDeck);
    this.markLibraryChanged();
  }

  private async archiveReceivedDeck(deck: DeckData, offerId: string): Promise<boolean> {
    if (this.receivedOfferIds.has(offerId)) return true;
    const key = deckVersionKey(deck);
    if (this.persistedDeckKeys.has(key)) {
      this.receivedOfferIds.add(offerId);
      return true;
    }
    const hasSiblingVersion = [...this.localDecks.values()].some(
      (stored) => stored.id === deck.id && deckVersionKey(stored) !== key,
    );
    if (!this.localDecks.has(key)) {
      this.localDecks.set(key, deck);
      this.libraryRevision += 1;
    }
    if (this.persistenceTimer !== undefined) {
      window.clearTimeout(this.persistenceTimer);
      this.persistenceTimer = undefined;
    }
    try {
      await this.persistLatest();
      if (!this.persistedDeckKeys.has(key)) return false;
      this.receivedOfferIds.add(offerId);
      this.showStatus(
        hasSiblingVersion ? '交换套牌的新版本已独立保存' : '交换套牌已保存到作品库',
        false,
      );
      return true;
    } catch (error) {
      this.notifyPersistenceFailure(error);
      return false;
    }
  }

  private swapScene(
    scene: LobbyScene | StudioScene | RuleBuilderScene | LibraryScene | ExchangeScene | DeckShowcaseScene | ContentPolicyScene | BattleScene,
    animate: boolean,
  ): void {
    hideInteractionHint();
    if (this.switching && animate) return;
    if (animate) audioEngine.play('scene-transition');
    this.switching = animate;
    scene.alpha = animate ? 0 : 1;
    scene.layout(this.viewport);
    this.sceneLayer.addChild(scene);
    const previous = this.currentScene;
    this.currentScene = scene;

    if (!animate) {
      if (previous) {
        this.sceneLayer.removeChild(previous);
        previous.destroy();
      }
      this.switching = false;
      return;
    }

    this.transitionFill.scale.x = 0;
    this.transitionSeal.alpha = 0;
    this.transitionSealText.alpha = 0;
    const timeline = gsap.timeline({
      onComplete: () => {
        if (previous) {
          this.sceneLayer.removeChild(previous);
          previous.destroy();
        }
        this.switching = false;
      },
    });
    if (previous) timeline.to(previous, { alpha: 0, duration: 0.22, ease: 'power2.out' }, 0.06);
    timeline
      .to(this.transitionFill.scale, { x: 1, duration: 0.28, ease: 'power3.inOut' }, 0)
      .to([this.transitionSeal, this.transitionSealText], { alpha: 1, duration: 0.16, ease: 'power2.out' }, 0.17)
      .to(scene, { alpha: 1, duration: 0.22, ease: 'power2.out' }, 0.31)
      .to([this.transitionSeal, this.transitionSealText], { alpha: 0, duration: 0.12, ease: 'power2.in' }, 0.38)
      .to(this.transitionFill.scale, { x: 0, duration: 0.34, ease: 'power3.inOut' }, 0.42);
  }

  private async restoreLibrary(): Promise<void> {
    try {
      const library = await withStartupTimeout(
        loadDeckLibrary(),
        LIBRARY_RESTORE_TIMEOUT_MS,
        '作品库读取超时',
      );
      this.localDecks.clear();
      this.persistedDeckKeys.clear();
      for (const deck of library.decks) {
        const key = deckVersionKey(deck);
        this.localDecks.set(key, deck);
        this.persistedDeckKeys.add(key);
      }
      const restored =
        (library.activeDeckId
          ? findDeckVersion(
              library.decks,
              library.activeDeckId,
              library.activeDeckCid,
              library.activeDeckRevision,
            )
          : undefined) ??
        library.decks[0];
      if (restored) this.currentDeck = restored;
      this.libraryRevision = 0;
      this.persistedRevision = 0;
    } catch (error) {
      this.storageBlocked = true;
      const timedOut = error instanceof Error && error.message.includes('超时');
      this.showStatus(
        timedOut
          ? '作品库读取超时，已先进入首页；当前为只读保护，重启后可重试读取'
          : '作品库读取失败，原文件未被覆盖',
        false,
        true,
      );
    }
  }

  private librarySnapshot(): DeckLibraryData {
    const currentKey = deckVersionKey(this.currentDeck);
    const currentStored = this.localDecks.has(currentKey);
    return {
      schemaVersion: 1,
      activeDeckId: currentStored ? this.currentDeck.id : null,
      activeDeckCid: currentStored ? deckVersionCid(this.currentDeck) : null,
      activeDeckRevision: currentStored ? deckRevisionReference(this.currentDeck) : null,
      decks: [...this.localDecks.values()],
    };
  }

  private markLibraryChanged(): void {
    this.libraryRevision += 1;
    this.schedulePersistence();
  }

  private schedulePersistence(): void {
    if (this.storageBlocked || this.destroyed) return;
    if (this.persistenceTimer !== undefined) window.clearTimeout(this.persistenceTimer);
    this.persistenceTimer = window.setTimeout(() => {
      this.persistenceTimer = undefined;
      void this.persistLatest().catch((error) => this.notifyPersistenceFailure(error));
    }, 450);
  }

  /** Starts a non-blocking disk write for streamed local artwork. */
  private checkpointDeckStorage(): void {
    if (this.storageBlocked || this.destroyed) return;
    if (this.persistenceTimer !== undefined) {
      window.clearTimeout(this.persistenceTimer);
      this.persistenceTimer = undefined;
    }
    void this.persistLatest().catch((error) => this.notifyPersistenceFailure(error));
  }

  private persistLatest(): Promise<void> {
    if (this.storageBlocked) {
      return Promise.reject(new Error('作品库处于只读保护状态。'));
    }
    if (!this.persistenceTask) {
      const task = this.flushPersistence();
      this.persistenceTask = task;
      void task.then(
        () => {
          if (this.persistenceTask === task) this.persistenceTask = undefined;
        },
        () => {
          if (this.persistenceTask === task) this.persistenceTask = undefined;
        },
      );
    }
    return this.persistenceTask;
  }

  private async flushPersistence(): Promise<void> {
    while (this.persistedRevision < this.libraryRevision) {
      const targetRevision = this.libraryRevision;
      const saved = await saveDeckLibrary(this.librarySnapshot());
      this.persistedDeckKeys.clear();
      saved.decks.forEach((deck) => this.persistedDeckKeys.add(deckVersionKey(deck)));
      this.persistedRevision = targetRevision;
    }
  }

  private notifyPersistenceFailure(error: unknown): void {
    const now = Date.now();
    if (now - this.lastPersistenceErrorAt < 5000) return;
    this.lastPersistenceErrorAt = now;
    const diagnostic = error instanceof DeckStorageError
      ? { code: error.code, message: error.message }
      : { code: 'DECK_STORAGE_FAILED', message: error instanceof Error ? error.message : String(error) };
    console.error('[deck-storage] 作品库保存失败', diagnostic);
    if (error instanceof DeckStorageError && error.code === 'DECK_STORAGE_CONFLICT') {
      this.showStatus('检测到另一窗口已更新作品库；原库未被覆盖，请关闭重复窗口后重启', false, true);
      return;
    }
    const detail = error instanceof DeckStorageError && error.message.trim()
      ? error.message.trim().slice(0, 72)
      : '修改尚未落盘';
    this.showStatus(`作品库保存失败：${detail}`, false, true);
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState !== 'hidden' || this.storageBlocked) return;
    if (this.persistenceTimer !== undefined) {
      window.clearTimeout(this.persistenceTimer);
      this.persistenceTimer = undefined;
    }
    void this.persistLatest().catch(() => undefined);
  };

  private handleInteractiveTap = (event: FederatedPointerEvent): void => {
    if (event.target === this.pixi.stage) return;
    audioEngine.handleInteractiveTap();
  };

  private handleAudioUnlock = (): void => {
    audioEngine.activateFromGesture();
  };

  /** Flushes the latest version before the native desktop window is destroyed. */
  async flushPendingStorage(): Promise<void> {
    if (this.storageBlocked || this.destroyed) return;
    if (this.persistenceTimer !== undefined) {
      window.clearTimeout(this.persistenceTimer);
      this.persistenceTimer = undefined;
    }
    if (this.persistedRevision < this.libraryRevision || this.persistenceTask) {
      await this.persistLatest();
    }
  }

  reportClosePersistenceFailure(error: unknown): void {
    this.notifyPersistenceFailure(error);
    this.showStatus('关闭前保存失败；窗口已保留。再次关闭将放弃尚未落盘的修改', false, true);
  }

  private async exportDeck(deck: DeckData): Promise<void> {
    if (this.statusPill.visible) return;
    const printReadiness = assessDeckPrintReadiness(deck);
    if (!printReadiness.ready) {
      this.showStatus(printReadiness.message, false, true);
      return;
    }
    const policy = validateDeckExportPolicy(deck);
    if (!policy.allowed) {
      const returnTo = this.sceneId === 'library'
        ? 'library'
        : this.sceneId === 'rules'
          ? 'rules'
          : 'studio';
      this.showStatus(policy.message, false, true);
      this.openContentPolicy(deck, returnTo, (acceptedDeck) => {
        window.setTimeout(() => void this.exportDeck(acceptedDeck), 520);
      });
      return;
    }
    this.showStatus('正在准备 PDF/X-4 印厂文件…', true);
    try {
      const { exportDeckPdfX4 } = await import('./services/export-pdfx4');
      const result = await exportDeckPdfX4(deck, (progress) => {
        this.showStatus(progress.message, true);
      });
      this.showStatus(
        result.saved
          ? `PDF/X-4 印厂文件已保存 · ${result.pageCount} 页 · ${result.profileName ?? 'CMYK'}`
          : '已取消导出',
        false,
      );
    } catch (error) {
      this.showStatus(error instanceof Error ? error.message : '导出失败，请稍后重试', false, true);
    }
  }

  private async saveDeckProject(deck: DeckData): Promise<void> {
    if (this.statusPill.visible) return;
    this.showStatus(`正在封装《${deck.name}》工程…`, true);
    try {
      const result = await exportDeckProject(deck);
      this.showStatus(
        result.saved
          ? `套牌工程已保存到所选位置 · ${deck.cards.length} 张卡牌与全部玩法数据`
          : '已取消保存套牌工程',
        false,
      );
    } catch (error) {
      const message = error instanceof DeckProjectError ? error.message : '套牌工程保存失败。';
      this.showStatus(message, false, true);
    }
  }

  private async loadDeckProject(): Promise<void> {
    if (this.statusPill.visible) return;
    this.showStatus('请选择要导入的套牌工程…', true);
    try {
      const result = await importDeckProject();
      if (!result.imported || !result.deck) {
        this.showStatus('已取消导入套牌工程', false);
        return;
      }

      let imported = result.deck;
      const importedKey = deckVersionKey(imported);
      const existing = this.localDecks.get(importedKey);
      if (existing && JSON.stringify(existing) !== JSON.stringify(imported)) {
        imported = createNextDeckRevision(
          this.localRevisionSource(imported),
          imported,
          'imported',
          Date.now(),
          this.localDecks.values(),
        );
      }
      this.currentDeck = imported;
      this.editableDeckKey = null;
      this.localDecks.set(deckVersionKey(imported), imported);
      this.markLibraryChanged();
      await this.persistLatest();
      this.showStatus(`已从所选文件导入《${imported.name}》，可继续编辑`, false);
      this.openStudio();
    } catch (error) {
      const message = error instanceof DeckProjectError ? error.message : '套牌工程导入失败。';
      this.showStatus(message, false, true);
    }
  }

  private showStatus(message: string, persistent: boolean, error = false): void {
    if (this.statusTimer !== undefined) window.clearTimeout(this.statusTimer);
    const maximumWidth = Math.max(168, Math.min(520, (this.viewport?.width ?? 560) - 32));
    this.statusText.style.wordWrap = true;
    this.statusText.style.wordWrapWidth = maximumWidth - 36;
    this.statusText.text = message;
    const width = Math.min(maximumWidth, Math.max(168, this.statusText.width + 36));
    const height = Math.max(42, this.statusText.height + 18);
    const color = error ? COLORS.danger : persistent ? COLORS.gold : COLORS.jade;
    this.statusBg
      .clear()
      .roundRect(0, 0, width, height, 8)
      .fill({ color: COLORS.panelRaised, alpha: 0.98 })
      .stroke({ color, width: 1, alpha: 0.78 });
    this.statusText.position.set((width - this.statusText.width) / 2, (height - this.statusText.height) / 2);
    this.statusPill.visible = true;
    this.statusPill.alpha = 1;
    this.layoutStatus();
    if (!persistent) {
      this.statusTimer = window.setTimeout(() => {
        gsap.to(this.statusPill, {
          alpha: 0,
          duration: 0.22,
          onComplete: () => {
            this.statusPill.visible = false;
            this.statusPill.alpha = 1;
          },
        });
      }, error ? 4200 : 1800);
    }
  }

  private layoutStatus(): void {
    if (!this.viewport) return;
    const bounds = this.statusPill.getLocalBounds();
    this.statusPill.position.set(
      (this.viewport.width - bounds.width) / 2,
      this.viewport.phone ? 68 : 76,
    );
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener('resize', this.scheduleResize);
    window.removeEventListener('orientationchange', this.scheduleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.statusTimer !== undefined) window.clearTimeout(this.statusTimer);
    if (this.persistenceTimer !== undefined) window.clearTimeout(this.persistenceTimer);
    if (this.resizeFrame !== undefined) window.cancelAnimationFrame(this.resizeFrame);
    this.pixi.stage.off('pointerdowncapture', this.handleAudioUnlock);
    this.pixi.stage.off('pointertapcapture', this.handleInteractiveTap);
    this.detachAudioLifecycle?.();
    this.detachAudioLifecycle = undefined;
    audioEngine.destroy();
    this.currentScene?.destroy();
    this.background.destroy();
    this.pixi.destroy(true, { children: true, texture: true });
  }
}

export const DEFAULT_MODE = GAME_MODES[2];
