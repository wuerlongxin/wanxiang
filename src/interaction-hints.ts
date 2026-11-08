import {
  Container,
  Graphics,
  Text,
  TextStyle,
  type FederatedPointerEvent,
} from 'pixi.js';

import { COLORS, FONT_FAMILY } from './theme';

type HintOwner = Container;

interface HitHintOptions {
  enabled?: () => boolean;
}

let activeLayer: InteractionHintLayer | null = null;

export class InteractionHintLayer extends Container {
  private readonly shadow = new Graphics();
  private readonly frame = new Graphics();
  private readonly accent = new Graphics();
  private readonly hintText = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: FONT_FAMILY,
      fontSize: 12,
      fontWeight: '600',
      fill: COLORS.paper,
      letterSpacing: 0,
      lineHeight: 18,
      wordWrap: true,
      breakWords: true,
    }),
  });
  private viewportWidth = 1;
  private viewportHeight = 1;
  private owner: HintOwner | null = null;
  private pointerX = 0;
  private pointerY = 0;

  constructor() {
    super();
    this.eventMode = 'none';
    this.visible = false;
    this.addChild(this.shadow, this.frame, this.accent, this.hintText);
    activeLayer = this;
  }

  layout(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    // A responsive relayout moves every hit target. Keeping a tooltip at the
    // previous pointer/owner coordinates can make it describe the wrong item.
    if (this.visible) this.hide();
  }

  show(owner: HintOwner, text: string, x: number, y: number): void {
    // Pointer events bubble through nested Canvas controls. Keep the deepest
    // target's hint instead of allowing an actionable parent row to replace it.
    if (this.owner && this.owner !== owner && isAncestorOf(owner, this.owner)) return;
    const normalized = text.replace(/\s+/gu, ' ').trim();
    if (!normalized) {
      this.hide(owner);
      return;
    }
    if (this.owner === owner && this.visible && this.hintText.text === normalized) {
      this.pointerX = x;
      this.pointerY = y;
      this.place();
      return;
    }
    this.owner = owner;
    this.pointerX = x;
    this.pointerY = y;
    this.hintText.style.wordWrapWidth = Math.min(252, Math.max(112, this.viewportWidth - 40));
    this.hintText.text = normalized;
    this.draw();
    this.visible = true;
    this.place();
  }

  move(owner: HintOwner, x: number, y: number): void {
    if (this.owner !== owner || !this.visible) return;
    this.pointerX = x;
    this.pointerY = y;
    this.place();
  }

  hide(owner?: HintOwner): void {
    if (owner && this.owner !== owner) return;
    this.owner = null;
    this.visible = false;
  }

  private draw(): void {
    const paddingX = 13;
    const paddingY = 9;
    const width = Math.ceil(this.hintText.width + paddingX * 2);
    const height = Math.ceil(this.hintText.height + paddingY * 2);
    this.shadow
      .clear()
      .roundRect(3, 4, width, height, 5)
      .fill({ color: COLORS.black, alpha: 0.46 });
    this.frame
      .clear()
      .moveTo(6, 0)
      .lineTo(width - 6, 0)
      .lineTo(width, 6)
      .lineTo(width, height - 6)
      .lineTo(width - 6, height)
      .lineTo(6, height)
      .lineTo(0, height - 6)
      .lineTo(0, 6)
      .closePath()
      .fill({ color: 0x241417, alpha: 0.97 })
      .stroke({ color: COLORS.gold, width: 1, alpha: 0.84 });
    this.frame
      .moveTo(5, height - 4)
      .lineTo(width - 5, height - 4)
      .stroke({ color: COLORS.cinnabar, width: 1, alpha: 0.46 });
    this.accent
      .clear()
      .circle(8, height / 2, 2.3)
      .fill({ color: COLORS.jade, alpha: 0.9 });
    this.hintText.position.set(paddingX, paddingY);
  }

  private place(): void {
    const bounds = this.getLocalBounds();
    const margin = 10;
    let x = this.pointerX + 15;
    let y = this.pointerY + 18;
    if (x + bounds.width > this.viewportWidth - margin) {
      x = this.pointerX - bounds.width - 15;
    }
    if (y + bounds.height > this.viewportHeight - margin) {
      y = this.pointerY - bounds.height - 16;
    }
    this.position.set(
      Math.max(margin, Math.min(this.viewportWidth - bounds.width - margin, x)),
      Math.max(margin, Math.min(this.viewportHeight - bounds.height - margin, y)),
    );
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (activeLayer === this) activeLayer = null;
    super.destroy(options ?? { children: true });
  }
}

function isAncestorOf(candidate: Container, target: Container): boolean {
  let current = target.parent;
  while (current) {
    if (current === candidate) return true;
    current = current.parent;
  }
  return false;
}

export function showInteractionHint(owner: HintOwner, text: string, x: number, y: number): void {
  activeLayer?.show(owner, text, x, y);
}

export function moveInteractionHint(owner: HintOwner, x: number, y: number): void {
  activeLayer?.move(owner, x, y);
}

export function hideInteractionHint(owner?: HintOwner): void {
  activeLayer?.hide(owner);
}

export function attachInteractionHint(
  target: Container,
  getText: () => string,
  options: HitHintOptions = {},
): () => void {
  const enabled = (): boolean => options.enabled?.() ?? true;
  const handleOver = (event: FederatedPointerEvent): void => {
    if (!enabled()) return;
    showInteractionHint(target, getText(), event.global.x, event.global.y);
  };
  const handleMove = (event: FederatedPointerEvent): void => {
    if (!enabled()) return;
    showInteractionHint(target, getText(), event.global.x, event.global.y);
  };
  const handleOut = (): void => hideInteractionHint(target);
  const handleDown = (): void => hideInteractionHint(target);
  target.on('pointerover', handleOver);
  target.on('pointermove', handleMove);
  target.on('pointerout', handleOut);
  target.on('pointerdown', handleDown);
  return () => {
    hideInteractionHint(target);
    target.off('pointerover', handleOver);
    target.off('pointermove', handleMove);
    target.off('pointerout', handleOut);
    target.off('pointerdown', handleDown);
  };
}
