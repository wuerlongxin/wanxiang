import '../src/pixi-runtime';
import { Application, Graphics, Text, TextStyle } from 'pixi.js';

import { resolveArtStyle } from '../src/art-styles';
import { CardView } from '../src/card-view';
import { createStarterDeck, MODE_BY_ID } from '../src/data';
import { COLORS, DISPLAY_FONT, FONT_FAMILY } from '../src/theme';
import type { GameModeId } from '../src/types';

interface ReadmeCardRendererHandle {
  render(modeId: GameModeId): Promise<void>;
  destroy(): void;
}

declare global {
  interface Window {
    __artificerReadmeCardRenderer?: ReadmeCardRendererHandle;
  }
}

const WIDTH = 700;
const HEIGHT = 900;
const CARD_WIDTH = 500;

let app: Application | undefined;
let host: HTMLDivElement | undefined;

export function destroyReadmeCard(): void {
  app?.destroy(true, { children: true });
  host?.remove();
  app = undefined;
  host = undefined;
}

export async function renderReadmeCard(modeId: GameModeId): Promise<void> {
  destroyReadmeCard();

  const deck = createStarterDeck(modeId);
  const mode = MODE_BY_ID[modeId];
  const style = resolveArtStyle(deck.artStyleId);

  host = document.createElement('div');
  host.id = 'readme-card-renderer';
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0 auto auto 0',
    width: `${WIDTH}px`,
    height: `${HEIGHT}px`,
    zIndex: '999999',
    background: '#17110f',
  });
  document.body.append(host);

  app = new Application();
  await app.init({
    width: WIDTH,
    height: HEIGHT,
    background: 0x17110f,
    antialias: true,
    resolution: 1,
    preference: 'webgl',
  });
  app.canvas.setAttribute('data-readme-card-canvas', modeId);
  host.append(app.canvas);

  const background = new Graphics()
    .rect(0, 0, WIDTH, HEIGHT)
    .fill({ color: 0x17110f })
    .roundRect(30, 28, WIDTH - 60, HEIGHT - 56, 12)
    .fill({ color: style.palette.ink, alpha: 0.56 })
    .stroke({ color: style.palette.accent, width: 2, alpha: 0.52 })
    .circle(WIDTH / 2, HEIGHT * 0.53, 280)
    .stroke({ color: style.palette.secondary, width: 1, alpha: 0.18 })
    .circle(WIDTH / 2, HEIGHT * 0.53, 234)
    .stroke({ color: COLORS.gold, width: 1, alpha: 0.14 });

  const title = new Text({
    text: `${mode.name} · ${style.name}`,
    style: new TextStyle({
      fontFamily: DISPLAY_FONT,
      fontSize: 28,
      fontWeight: '700',
      fill: style.palette.paper,
      letterSpacing: 0,
    }),
  });
  title.anchor.set(0.5);
  title.position.set(WIDTH / 2, 62);

  const caption = new Text({
    text: `${deck.cards.length} 张原型样卡 · ${style.tagline}`,
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 14,
      fontWeight: '500',
      fill: style.palette.accent,
      letterSpacing: 0,
    }),
  });
  caption.anchor.set(0.5);
  caption.position.set(WIDTH / 2, 100);

  const card = new CardView(deck.cards[0], CARD_WIDTH)
    .setArtStyle(deck.artStyleId)
    .setGameplayContext(deck.ruleKit?.modules)
    .setBackDesign(deck.cardBack, deck.name)
    .setFoilIntensity(0.92)
    .setInteractiveTilt(false)
    .setMotionProfile('static');
  card.position.set(WIDTH / 2, 500);

  app.stage.addChild(background, title, caption, card);
}

window.__artificerReadmeCardRenderer = {
  render: renderReadmeCard,
  destroy: destroyReadmeCard,
};
