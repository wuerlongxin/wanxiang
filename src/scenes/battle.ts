import { Container, Graphics, Text, TextStyle, type TextStyleFontWeight } from 'pixi.js';
import { gsap } from 'gsap';
import { CardView } from '../card-view';
import { TopBar } from '../chrome';
import { COLORS, DISPLAY_FONT, FONT_FAMILY } from '../theme';
import type { CardData, DeckData, Viewport } from '../types';
import { CanvasButton } from '../ui';
import { attachInteractionHint } from '../interaction-hints';
import {
  BATTLE_MAX_HAND,
  BATTLE_OPPONENTS,
  BATTLE_OPPONENT_BY_ID,
  createBattle,
  endOpponentTurn,
  endPlayerTurn,
  planOpponentPlays,
  playCard,
  startOpponentTurn,
  type BattleDifficultyId,
  type BattleState,
} from '../services/battle';

interface BattleSceneOptions {
  deck: DeckData;
  onHome: () => void;
  onStudio: () => void;
  onRules: () => void;
  onLibrary: () => void;
  onExchange: () => void;
}

type BattleView = 'select' | 'fight';

const AI_PLAY_DELAY_MS = 650;

function makeText(
  text: string,
  size: number,
  fill: number,
  weight: TextStyleFontWeight = '600',
  letterSpacing = 0,
): Text {
  return new Text({
    text,
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: size,
      fontWeight: weight,
      fill,
      letterSpacing,
    }),
  });
}

function makeTitle(text: string, size: number, fill: number): Text {
  return new Text({
    text,
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: size,
      fontWeight: '700',
      fill,
      letterSpacing: 0,
    }),
  });
}

export class BattleScene extends Container {
  private readonly deck: DeckData;
  private readonly chrome: TopBar;
  private readonly selectView = new Container();
  private readonly fightView = new Container();
  private readonly resultView = new Container();
  private readonly resultDim = new Graphics();
  private readonly resultPanel = new Graphics();
  private readonly resultTitle = makeTitle('胜利', 40, COLORS.gold);
  private readonly resultDetail = makeText('', 13, COLORS.paper);
  private readonly rematchButton = new CanvasButton({
    label: '再来一局',
    icon: 'refresh-cw',
    variant: 'primary',
    onPress: () => this.startBattle(this.selectedDifficulty),
  });
  private readonly changeOpponentButton = new CanvasButton({
    label: '换对手',
    icon: 'swords',
    variant: 'secondary',
    onPress: () => this.showSelect(),
  });
  private readonly backHomeButton = new CanvasButton({
    label: '返回大厅',
    icon: 'arrow-left',
    variant: 'ghost',
    onPress: () => this.onHome(),
  });

  private readonly selectTitle = makeTitle('对战模式', 34, COLORS.paper);
  private readonly selectKicker = makeText('BATTLE  /  选择对手', 11, COLORS.gold, '700');
  private readonly selectDeckLine = makeText('', 13, COLORS.paperFaint);
  private readonly selectRecordLine = makeText('本次战绩：0 胜 0 负', 12, COLORS.paperFaint);
  private readonly selectRulesLine = makeText(
    '双方各 20 点生命，用同一套牌对战。手牌 3 张起手，每回合抽 1 张；每回合获得费用（第 1 回合 2 点，上限 5 点）。\n出牌支付费用，造成等同攻击的伤害，并获得等同防御的护甲；护甲先抵挡伤害，在持有者下回合开始时消失。',
    12,
    COLORS.paperFaint,
  );
  private readonly startButton = new CanvasButton({
    label: '开始对战',
    icon: 'swords',
    variant: 'primary',
    onPress: () => this.startBattle(this.selectedDifficulty),
  });
  private readonly opponentPanels: {
    root: Container;
    bg: Graphics;
    name: Text;
    title: Text;
    description: Text;
    id: BattleDifficultyId;
  }[] = [];

  private readonly opponentBar = new Graphics();
  private readonly opponentName = makeText('', 14, COLORS.paper, '700');
  private readonly opponentHpText = makeText('', 13, COLORS.paper, '700');
  private readonly opponentArmorText = makeText('', 12, COLORS.jade, '700');
  private readonly opponentCounts = makeText('', 12, COLORS.paperFaint);
  private readonly opponentHandBacks = new Graphics();
  private readonly playerBar = new Graphics();
  private readonly playerName = makeText('你', 14, COLORS.paper, '700');
  private readonly playerHpText = makeText('', 13, COLORS.paper, '700');
  private readonly playerArmorText = makeText('', 12, COLORS.jade, '700');
  private readonly playerCounts = makeText('', 12, COLORS.paperFaint);
  private readonly energyText = makeText('', 14, COLORS.gold, '700');
  private readonly energyPips = new Graphics();
  private readonly logText = makeText('', 12, COLORS.paperFaint);
  private readonly turnText = makeText('', 13, COLORS.gold, '700');
  private readonly endTurnButton = new CanvasButton({
    label: '结束回合',
    icon: 'arrow-right',
    variant: 'primary',
    onPress: () => this.endTurn(),
  });
  private readonly playedPreview: CardView;
  private readonly handSlots: CardView[] = [];
  private readonly handLayer = new Container();

  private readonly onHome: () => void;
  private view: BattleView = 'select';
  private selectedDifficulty: BattleDifficultyId = 'craftsman';
  private battle: BattleState | null = null;
  private wins = 0;
  private losses = 0;
  private inputLocked = false;
  private timers: number[] = [];
  private viewport: Viewport | null = null;
  private disposed = false;
  private previewTween?: gsap.core.Tween;

  constructor(options: BattleSceneOptions) {
    super();
    this.deck = options.deck;
    this.onHome = options.onHome;
    this.chrome = new TopBar({
      current: 'battle',
      onHome: () => options.onHome(),
      onNavigate: (scene) => {
        if (scene === 'studio') options.onStudio();
        if (scene === 'rules') options.onRules();
        if (scene === 'library') options.onLibrary();
        if (scene === 'exchange') options.onExchange();
      },
    });
    this.playedPreview = new CardView(this.deck.cards[0], 150);
    this.playedPreview.alpha = 0;
    this.playedPreview.eventMode = 'none';

    for (let index = 0; index < BATTLE_MAX_HAND; index += 1) {
      const slot = new CardView(this.deck.cards[0], 132);
      slot.visible = false;
      slot.on('pointertap', () => this.playHandCard(index));
      this.handSlots.push(slot);
      this.handLayer.addChild(slot);
    }

    this.selectTitle.anchor.set(0.5, 0);
    this.selectKicker.anchor.set(0.5, 0);
    this.selectDeckLine.anchor.set(0.5, 0);
    this.selectRecordLine.anchor.set(0.5, 0);
    this.selectRulesLine.anchor.set(0.5, 0);
    this.resultTitle.anchor.set(0.5, 0);
    this.resultDetail.anchor.set(0.5, 0);

    BATTLE_OPPONENTS.forEach((opponent) => {
      const root = new Container();
      const bg = new Graphics();
      const name = makeTitle(opponent.name, 22, COLORS.paper);
      const title = makeText(opponent.title, 12, COLORS.gold, '700');
      const description = makeText(opponent.description, 12, COLORS.paperFaint);
      name.anchor.set(0.5, 0);
      title.anchor.set(0.5, 0);
      description.anchor.set(0.5, 0);
      root.addChild(bg, name, title, description);
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.on('pointertap', () => this.selectOpponent(opponent.id));
      attachInteractionHint(root, () => `选择对手：${opponent.name}`);
      this.opponentPanels.push({ root, bg, name, title, description, id: opponent.id });
      this.selectView.addChild(root);
    });

    this.selectView.addChild(
      this.selectTitle,
      this.selectKicker,
      this.selectDeckLine,
      this.selectRecordLine,
      this.selectRulesLine,
      this.startButton,
    );
    this.fightView.addChild(
      this.opponentBar,
      this.opponentName,
      this.opponentHpText,
      this.opponentArmorText,
      this.opponentCounts,
      this.opponentHandBacks,
      this.playerBar,
      this.playerName,
      this.playerHpText,
      this.playerArmorText,
      this.playerCounts,
      this.energyText,
      this.energyPips,
      this.logText,
      this.turnText,
      this.endTurnButton,
      this.playedPreview,
      this.handLayer,
    );
    this.resultView.addChild(
      this.resultDim,
      this.resultPanel,
      this.resultTitle,
      this.resultDetail,
      this.rematchButton,
      this.changeOpponentButton,
      this.backHomeButton,
    );
    this.resultView.visible = false;
    this.fightView.visible = false;
    this.addChild(this.selectView, this.fightView, this.resultView, this.chrome);
    this.refreshSelect();
  }

  layout(viewport: Viewport): void {
    this.viewport = viewport;
    const { width, height, phone } = viewport;
    const side = phone ? 16 : 42;
    const navHeight = viewport.profile.navigationHeight;
    this.chrome.layout(viewport);
    this.hitArea = { contains: (x: number, y: number) => x >= 0 && y >= 0 && x <= width && y <= height };

    if (this.view === 'select') this.layoutSelect(width, height, side, navHeight, phone);
    else this.layoutFight(width, height, side, navHeight, phone);
    this.layoutResult(width, height, phone);
  }

  private layoutSelect(
    width: number,
    height: number,
    side: number,
    navHeight: number,
    phone: boolean,
  ): void {
    const contentWidth = Math.min(phone ? width - side * 2 : 960, width - side * 2);
    const centerX = width / 2;
    let cursorY = navHeight + (phone ? 18 : 34);
    this.selectKicker.position.set(centerX, cursorY);
    cursorY += phone ? 22 : 26;
    this.selectTitle.position.set(centerX, cursorY);
    cursorY += phone ? 44 : 52;
    this.selectDeckLine.position.set(centerX, cursorY);
    cursorY += 26;
    this.selectRecordLine.position.set(centerX, cursorY);
    cursorY += 30;

    const panelGap = phone ? 10 : 16;
    const panelWidth = phone
      ? contentWidth
      : (contentWidth - panelGap * 2) / 3;
    const panelHeight = phone ? 108 : 168;
    this.opponentPanels.forEach((panel, index) => {
      const x = phone
        ? centerX - panelWidth / 2
        : centerX - contentWidth / 2 + index * (panelWidth + panelGap);
      const y = phone ? cursorY + index * (panelHeight + panelGap) : cursorY;
      panel.root.position.set(x, y);
      const selected = panel.id === this.selectedDifficulty;
      panel.bg
        .clear()
        .roundRect(0, 0, panelWidth, panelHeight, 10)
        .fill({ color: selected ? 0x2e1a12 : COLORS.ink, alpha: 0.92 })
        .stroke({ color: selected ? COLORS.gold : COLORS.bronze, width: selected ? 2 : 1, alpha: selected ? 0.95 : 0.55 });
      panel.name.position.set(panelWidth / 2, phone ? 12 : 22);
      panel.title.position.set(panelWidth / 2, phone ? 44 : 58);
      panel.description.position.set(panelWidth / 2, phone ? 68 : 88);
    });
    cursorY += phone
      ? panelHeight * 3 + panelGap * 2 + 24
      : panelHeight + 28;

    this.selectRulesLine.position.set(centerX, cursorY);
    cursorY += phone ? 52 : 48;
    this.startButton.setSize(phone ? 200 : 220, 48);
    this.startButton.position.set(centerX - this.startButton.width / 2, Math.min(cursorY, height - 76));
  }

  private layoutFight(
    width: number,
    height: number,
    side: number,
    navHeight: number,
    phone: boolean,
  ): void {
    const top = navHeight + 12;
    const panelHeight = phone ? 56 : 64;
    const contentWidth = width - side * 2;
    const cardWidth = phone
      ? Math.max(76, Math.min(104, (contentWidth - 6 * 8) / 7))
      : Math.min(132, (contentWidth - 6 * 12) / 7);
    const cardHeight = cardWidth * (88 / 63);
    const playerPanelHeight = phone ? 52 : 60;
    const handTop = height - playerPanelHeight - 12 - cardHeight;
    const middleTop = top + panelHeight + 10;
    const middleHeight = Math.max(90, handTop - middleTop - 8);

    const opponent = this.battle?.opponent;
    const backs = Math.min(opponent?.hand.length ?? 0, 7);
    const backsWidth = backs * 18;
    this.opponentBar
      .clear()
      .roundRect(side, top, contentWidth, panelHeight, 8)
      .fill({ color: COLORS.ink, alpha: 0.85 })
      .stroke({ color: COLORS.bronze, width: 1, alpha: 0.5 });
    this.opponentName.position.set(side + 14, top + 10);
    this.drawHpBar(this.opponentBar, side + 14, top + 32, contentWidth - 28, 10,
      opponent?.hp ?? 20, opponent?.maxHp ?? 20, COLORS.cinnabar);
    this.opponentHpText.position.set(side + contentWidth - 14 - backsWidth - 8, top + 8);
    this.opponentHpText.anchor.set(1, 0);
    this.opponentArmorText.position.set(side + contentWidth - 14 - backsWidth - 8, top + 30);
    this.opponentArmorText.anchor.set(1, 0);
    this.opponentCounts.position.set(side + 14, top + panelHeight - 4);
    this.opponentCounts.anchor.set(0, 1);
    this.opponentHandBacks.clear();
    for (let index = 0; index < backs; index += 1) {
      this.opponentHandBacks
        .roundRect(side + contentWidth - 14 - index * 18 - 14, top + 8, 14, 20, 2)
        .fill({ color: 0x2b1515, alpha: 0.95 })
        .stroke({ color: COLORS.gold, width: 1, alpha: 0.8 });
    }

    const player = this.battle?.player;
    this.playerBar
      .clear()
      .roundRect(side, height - playerPanelHeight - 6, contentWidth, playerPanelHeight, 8)
      .fill({ color: COLORS.ink, alpha: 0.85 })
      .stroke({ color: COLORS.bronze, width: 1, alpha: 0.5 });
    const playerTop = height - playerPanelHeight - 6;
    const buttonWidth = phone ? 104 : 132;
    this.endTurnButton.setSize(buttonWidth, 40);
    const buttonX = side + contentWidth - buttonWidth - 10;
    this.endTurnButton.position.set(buttonX, playerTop + (playerPanelHeight - 40) / 2);
    const hpBarWidth = phone ? contentWidth * 0.34 : contentWidth * 0.36;
    this.playerName.position.set(side + 14, playerTop + 8);
    this.drawHpBar(this.playerBar, side + 14, playerTop + 30, hpBarWidth, 10,
      player?.hp ?? 20, player?.maxHp ?? 20, COLORS.jade);
    this.playerHpText.position.set(side + 14 + hpBarWidth + 10, playerTop + 26);
    this.playerHpText.anchor.set(0, 0);
    this.playerArmorText.position.set(side + 44, playerTop + 8);
    this.playerArmorText.anchor.set(0, 0);
    this.playerCounts.position.set(side + 14 + hpBarWidth + 10, playerTop + 8);
    this.energyText.position.set(buttonX - 170, playerTop + 8);
    this.energyPips.clear();
    const pipY = playerTop + 20;
    const pipStartX = buttonX - 170 + this.energyText.width + 12;
    for (let index = 0; index < 5; index += 1) {
      const filled = index < (player?.energy ?? 0);
      this.energyPips
        .circle(pipStartX + index * 14, pipY, 5)
        .fill({ color: filled ? COLORS.gold : COLORS.paper, alpha: filled ? 0.95 : 0.18 });
    }

    const handWidth = Math.min(contentWidth, this.handSlots.length * cardWidth + 6 * 10);
    const handX = (width - handWidth) / 2;
    this.handSlots.forEach((slot, index) => {
      slot.setSize(cardWidth);
      slot.position.set(handX + index * (cardWidth + 10), handTop);
    });

    this.turnText.position.set(side + 4, middleTop + 2);
    this.logText.position.set(side + 4, middleTop + 26);
    this.logText.style.wordWrap = true;
    this.logText.style.wordWrapWidth = Math.min(560, contentWidth * 0.62);
    const previewWidth = phone ? 120 : 150;
    this.playedPreview.setSize(previewWidth);
    this.playedPreview.position.set(
      width - side - previewWidth,
      middleTop + (middleHeight - previewWidth * (88 / 63)) / 2,
    );
  }

  private layoutResult(width: number, height: number, phone: boolean): void {
    this.resultDim.clear().rect(0, 0, width, height).fill({ color: COLORS.ink, alpha: 0.82 });
    const panelWidth = Math.min(phone ? width - 32 : 460, width - 32);
    const panelHeight = phone ? 250 : 260;
    const panelX = (width - panelWidth) / 2;
    const panelY = (height - panelHeight) / 2;
    this.resultPanel
      .clear()
      .roundRect(panelX, panelY, panelWidth, panelHeight, 12)
      .fill({ color: COLORS.ink, alpha: 0.98 })
      .stroke({ color: COLORS.gold, width: 1.5, alpha: 0.85 });
    this.resultTitle.position.set(width / 2, panelY + 24);
    this.resultDetail.position.set(width / 2, panelY + 84);
    const buttonWidth = phone ? panelWidth - 48 : 180;
    const buttonY = panelY + panelHeight - 64;
    if (phone) {
      this.rematchButton.setSize(buttonWidth, 44);
      this.rematchButton.position.set((width - buttonWidth) / 2, buttonY);
      this.changeOpponentButton.visible = false;
      this.backHomeButton.visible = false;
    } else {
      this.changeOpponentButton.visible = true;
      this.backHomeButton.visible = true;
      this.rematchButton.setSize(buttonWidth, 44);
      this.changeOpponentButton.setSize(buttonWidth, 44);
      this.backHomeButton.setSize(buttonWidth, 44);
      const gap = 12;
      const total = buttonWidth * 3 + gap * 2;
      const startX = (width - total) / 2;
      this.rematchButton.position.set(startX, buttonY);
      this.changeOpponentButton.position.set(startX + buttonWidth + gap, buttonY);
      this.backHomeButton.position.set(startX + (buttonWidth + gap) * 2, buttonY);
    }
  }

  private drawHpBar(
    target: Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    hp: number,
    maxHp: number,
    fill: number,
  ): void {
    const ratio = maxHp > 0 ? Math.max(0, hp / maxHp) : 0;
    target
      .roundRect(x, y, width, height, height / 2)
      .fill({ color: COLORS.paper, alpha: 0.14 });
    if (ratio > 0) {
      target
        .roundRect(x, y, Math.max(height, width * ratio), height, height / 2)
        .fill({ color: fill, alpha: 0.95 });
    }
  }

  private refreshSelect(): void {
    this.selectDeckLine.text = `出战套牌：${this.deck.name} · ${this.deck.cards.length} 张`;
    this.selectRecordLine.text = `本次战绩：${this.wins} 胜 ${this.losses} 负`;
    if (this.viewport) this.layout(this.viewport);
  }

  private selectOpponent(id: BattleDifficultyId): void {
    this.selectedDifficulty = id;
    this.refreshSelect();
  }

  private showSelect(): void {
    this.clearTimers();
    this.battle = null;
    this.view = 'select';
    this.resultView.visible = false;
    this.fightView.visible = false;
    this.selectView.visible = true;
    this.refreshSelect();
  }

  private startBattle(difficulty: BattleDifficultyId): void {
    this.clearTimers();
    this.selectedDifficulty = difficulty;
    this.battle = createBattle(this.deck, difficulty);
    this.view = 'fight';
    this.selectView.visible = false;
    this.resultView.visible = false;
    this.fightView.visible = true;
    this.inputLocked = false;
    this.playedPreview.alpha = 0;
    this.endTurnButton.setDisabled(false);
    this.renderFight();
    if (this.viewport) this.layout(this.viewport);
  }

  private playHandCard(slotIndex: number): void {
    const state = this.battle;
    if (!state || this.view !== 'fight' || this.inputLocked || state.phase !== 'player') return;
    const card = state.player.hand[slotIndex];
    if (!card) return;
    const result = playCard(state, 'player', card.id);
    if (!result.ok) return;
    this.showPlayedCard(card);
    this.renderFight();
    if (state.winner !== null) this.finishBattle();
  }

  private endTurn(): void {
    const state = this.battle;
    if (!state || this.view !== 'fight' || this.inputLocked || state.phase !== 'player') return;
    if (!endPlayerTurn(state)) return;
    this.inputLocked = true;
    this.endTurnButton.setDisabled(true);
    this.renderFight();
    startOpponentTurn(state);
    const plays = planOpponentPlays(state);
    this.applyOpponentPlays(plays, 0);
  }

  private applyOpponentPlays(plays: string[], index: number): void {
    const state = this.battle;
    if (this.disposed || !state) return;
    if (index >= plays.length || state.phase !== 'opponent') {
      this.finishOpponentTurn();
      return;
    }
    const cardId = plays[index];
    const card = state.opponent.hand.find((candidate) => candidate.id === cardId);
    if (card) {
      const result = playCard(state, 'opponent', cardId);
      if (result.ok) this.showPlayedCard(card);
    }
    this.renderFight();
    if (state.winner !== null) {
      this.finishBattle();
      return;
    }
    this.timers.push(window.setTimeout(
      () => this.applyOpponentPlays(plays, index + 1),
      AI_PLAY_DELAY_MS,
    ));
  }

  private finishOpponentTurn(): void {
    const state = this.battle;
    if (this.disposed || !state || state.phase !== 'opponent') return;
    endOpponentTurn(state);
    this.inputLocked = false;
    this.endTurnButton.setDisabled(false);
    this.renderFight();
  }

  private finishBattle(): void {
    const state = this.battle;
    if (!state || state.phase !== 'over') return;
    if (state.winner === 'player') this.wins += 1;
    else if (state.winner === 'opponent') this.losses += 1;
    this.inputLocked = true;
    this.endTurnButton.setDisabled(true);
    this.timers.push(window.setTimeout(() => {
      if (this.disposed) return;
      const won = state.winner === 'player';
      this.resultTitle.text = won ? '胜利' : '败北';
      this.resultTitle.style.fill = won ? COLORS.gold : COLORS.cinnabar;
      this.resultDetail.text = won
        ? `你在第 ${state.turn} 回合击败了${BATTLE_OPPONENT_BY_ID[state.difficulty].name}。`
        : `${BATTLE_OPPONENT_BY_ID[state.difficulty].name}在第 ${state.turn} 回合击败了你。`;
      this.resultView.visible = true;
      if (this.viewport) this.layout(this.viewport);
    }, 750));
  }

  private showPlayedCard(card: CardData): void {
    this.previewTween?.kill();
    this.playedPreview.setData(card);
    this.playedPreview.alpha = 0;
    this.previewTween = gsap.to(this.playedPreview, {
      alpha: 1,
      duration: 0.25,
      ease: 'power2.out',
      onComplete: () => {
        this.previewTween = gsap.to(this.playedPreview, {
          alpha: 0,
          duration: 0.5,
          delay: 0.9,
          ease: 'power2.in',
        });
      },
    });
  }

  private renderFight(): void {
    const state = this.battle;
    if (!state) return;
    const opponent = state.opponent;
    const player = state.player;
    this.opponentName.text = BATTLE_OPPONENT_BY_ID[state.difficulty].name;
    this.opponentHpText.text = `${opponent.hp} / ${opponent.maxHp}`;
    this.opponentArmorText.text = opponent.armor > 0 ? `护甲 ${opponent.armor}` : '';
    this.opponentCounts.text = `手牌 ${opponent.hand.length} 张 · 牌库 ${opponent.deck.length} 张`;
    this.playerHpText.text = `${player.hp} / ${player.maxHp}`;
    this.playerArmorText.text = player.armor > 0 ? `护甲 ${player.armor}` : '';
    this.playerCounts.text = `牌库 ${player.deck.length} 张 · 弃牌 ${player.discard.length} 张`;
    this.energyText.text = `费用 ${player.energy} / ${Math.max(player.energy, 5)}`;
    this.turnText.text = state.phase === 'over'
      ? '对战结束'
      : state.phase === 'player'
        ? `第 ${state.turn} 回合 · 轮到你出牌`
        : `第 ${state.turn} 回合 · 对手行动中…`;
    this.logText.text = state.log.slice(-6).map((entry) => entry.text).join('\n');

    this.handSlots.forEach((slot, index) => {
      const card = player.hand[index];
      if (!card) {
        slot.visible = false;
        return;
      }
      slot.visible = true;
      slot.setData(card);
      const affordable = card.cost <= player.energy && state.phase === 'player' && !this.inputLocked;
      slot.alpha = affordable ? 1 : 0.45;
      slot.eventMode = affordable ? 'static' : 'none';
      slot.cursor = affordable ? 'pointer' : 'default';
    });
    if (this.viewport) this.layout(this.viewport);
  }

  private clearTimers(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers = [];
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.disposed = true;
    this.clearTimers();
    this.previewTween?.kill();
    super.destroy(options ?? { children: true });
  }
}
