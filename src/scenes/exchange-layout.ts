import type { Viewport } from '../types';

export type ExchangeSection = 'identity' | 'peers' | 'offer' | 'activity';

export interface ExchangeRect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface ExchangeLayout {
  responsive: boolean;
  tightHeader: boolean;
  legacyMainHeight: number;
  header: ExchangeRect;
  tabs?: ExchangeRect;
  main: ExchangeRect;
  sections: Record<ExchangeSection, ExchangeRect>;
}

export interface ExchangeIdentityControls {
  shallow: boolean;
  nodeToggle: ExchangeRect;
  copyCode?: ExchangeRect;
  connectionMode: ExchangeRect;
  manualInput?: ExchangeRect;
  connectButton?: ExchangeRect;
}

export interface ExchangeOfferControls {
  card: ExchangeRect;
  details: ExchangeRect;
  deckSelect: ExchangeRect;
  recipient: ExchangeRect;
  send: ExchangeRect;
}

export interface ExchangePeerRowLayout {
  row: ExchangeRect;
  selectButton: ExchangeRect;
}

export interface ExchangeActivityGrid {
  columns: number;
  capacity: number;
  rowsTop: number;
  rowWidth: number;
  rowStride: number;
  columnGap: number;
  side: number;
}

const LEGACY_TOP = 64;
const LEGACY_HEADER_HEIGHT = 94;
const LEGACY_BOTTOM_GAP = 20;
const CARD_RATIO = 88 / 63;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rect(x: number, y: number, width: number, height: number): ExchangeRect {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  return {
    x,
    y,
    width: safeWidth,
    height: safeHeight,
    right: x + safeWidth,
    bottom: y + safeHeight,
  };
}

export function getLegacyExchangeMainHeight(height: number): number {
  const activityHeight = Math.min(152, Math.max(120, height * 0.19));
  return height - (LEGACY_TOP + LEGACY_HEADER_HEIGHT) - activityHeight - LEGACY_BOTTOM_GAP;
}

/**
 * Switches layout based on usable information space, not a device name. The
 * legacy height formula stays explicit so the 420px threshold cannot drift.
 */
export function getExchangeLayout(viewport: Viewport): ExchangeLayout {
  const { width, height } = viewport;
  const legacyMainHeight = getLegacyExchangeMainHeight(height);
  const responsive = width < 900 || legacyMainHeight < 420;
  const tightHeader = viewport.lowHeight || viewport.profile.id === 'phone-landscape';
  const left = Math.max(0, viewport.safeLeft);
  const right = Math.max(0, viewport.safeRight);
  const availableWidth = Math.max(0, width - left - right);

  if (responsive) {
    const gap = tightHeader ? 6 : 8;
    const headerTop = viewport.profile.navigationHeight + gap;
    const headerHeight = tightHeader ? 38 : 52;
    const header = rect(left, headerTop, availableWidth, headerHeight);
    const tabs = rect(left, header.bottom + gap, availableWidth, 34);
    const mainTop = tabs.bottom + gap;
    const mainBottom = Math.max(mainTop, height - viewport.safeBottom);
    const main = rect(left, mainTop, availableWidth, mainBottom - mainTop);
    return {
      responsive,
      tightHeader,
      legacyMainHeight,
      header,
      tabs,
      main,
      sections: {
        identity: main,
        peers: main,
        offer: main,
        activity: main,
      },
    };
  }

  const legacySide = clamp(width * 0.025, 20, 34);
  const desktopLeft = Math.max(left, legacySide);
  const desktopRight = Math.max(right, legacySide);
  const desktopWidth = Math.max(0, width - desktopLeft - desktopRight);
  const mainTop = LEGACY_TOP + LEGACY_HEADER_HEIGHT;
  const activityHeight = Math.min(152, Math.max(120, height * 0.19));
  const gap = 12;
  const identityWidth = Math.min(292, desktopWidth * 0.25);
  const peerWidth = Math.min(350, desktopWidth * 0.3);
  const offerWidth = Math.max(0, desktopWidth - identityWidth - peerWidth - gap * 2);
  const main = rect(desktopLeft, mainTop, desktopWidth, legacyMainHeight);
  const identity = rect(desktopLeft, mainTop, identityWidth, legacyMainHeight);
  const peers = rect(identity.right + gap, mainTop, peerWidth, legacyMainHeight);
  const offer = rect(peers.right + gap, mainTop, offerWidth, legacyMainHeight);
  const activity = rect(desktopLeft, main.bottom + 10, desktopWidth, activityHeight - 10);
  return {
    responsive,
    tightHeader,
    legacyMainHeight,
    header: rect(desktopLeft, LEGACY_TOP + 18, desktopWidth, 58),
    main,
    sections: { identity, peers, offer, activity },
  };
}

export function getExchangeIdentityControls(
  width: number,
  height: number,
  manual: boolean,
  responsive: boolean,
): ExchangeIdentityControls {
  if (!responsive) {
    return {
      shallow: false,
      nodeToggle: rect(18, 166, width - 36, 40),
      copyCode: rect(18, 214, width - 36, 40),
      connectionMode: rect(18, 262, width - 36, 38),
      manualInput: manual ? rect(18, 308, width - 36, 60) : undefined,
      connectButton: manual ? rect(18, 376, width - 36, 40) : undefined,
    };
  }

  const side = width < 360 ? 14 : 18;
  const contentWidth = Math.min(640, Math.max(0, width - side * 2));
  const controlsX = width > 680 ? (width - contentWidth) / 2 : side;
  const shallow = height < 400;
  const gap = shallow ? 3 : 10;
  const toggleHeight = shallow ? 38 : 44;
  const modeHeight = shallow ? 36 : 40;
  const toggleY = shallow ? 81 : 154;
  const nodeToggle = rect(controlsX, toggleY, contentWidth, toggleHeight);
  const mode = rect(controlsX, nodeToggle.bottom + gap, contentWidth, modeHeight);
  if (manual) {
    const inputHeight = shallow ? 44 : 68;
    const buttonHeight = 44;
    const inputY = mode.bottom + gap;
    const buttonY = inputY + inputHeight + (shallow ? 3 : 8);
    return {
      shallow,
      nodeToggle,
      connectionMode: mode,
      manualInput: rect(controlsX, inputY, contentWidth, inputHeight),
      connectButton: rect(controlsX, buttonY, contentWidth, buttonHeight),
    };
  }

  return {
    shallow,
    nodeToggle,
    connectionMode: mode,
    copyCode: rect(controlsX, mode.bottom + gap, contentWidth, 44),
  };
}

export function getExchangeOfferControls(width: number, height: number): ExchangeOfferControls {
  const side = width < 360 ? 14 : 18;
  const gap = width < 360 ? 12 : 16;
  const cardTop = 56;
  const minimumDetailsWidth = Math.min(120, width * 0.4);
  const widthLimit = Math.max(0, width - side * 2 - gap - minimumDetailsWidth);
  const heightLimit = Math.max(0, (height - cardTop - side) / CARD_RATIO);
  const cardWidth = Math.max(0, Math.min(164, width * 0.38, widthLimit, heightLimit));
  const cardHeight = cardWidth * CARD_RATIO;
  const availableDetailsWidth = Math.max(0, width - side * 2 - cardWidth - gap);
  const detailsWidth = Math.min(420, availableDetailsWidth);
  const groupWidth = cardWidth + gap + detailsWidth;
  const groupX = Math.max(side, (width - groupWidth) / 2);
  const detailsX = groupX + cardWidth + gap;
  const sendHeight = 44;
  const sendY = Math.max(112, height - side - sendHeight);
  const recipientY = Math.max(88, sendY - 28);
  const selectY = Math.max(110, recipientY - 46);
  const actionWidth = Math.min(320, detailsWidth);
  const recipientWidth = Math.min(420, detailsWidth);
  return {
    card: rect(groupX, cardTop, cardWidth, cardHeight),
    details: rect(detailsX, 54, detailsWidth, Math.max(0, height - 54 - side)),
    deckSelect: rect(detailsX, selectY, actionWidth, 38),
    recipient: rect(detailsX, recipientY, recipientWidth, 18),
    send: rect(detailsX, sendY, actionWidth, sendHeight),
  };
}

export function getExchangePeerCapacity(height: number, responsive: boolean): number {
  const available = Math.max(0, height - 64);
  if (available < 66) return 0;
  return Math.min(6, Math.floor(available / (responsive ? 72 : 78)));
}

export function getExchangePeerRowLayout(
  width: number,
  index: number,
  responsive: boolean,
): ExchangePeerRowLayout {
  const side = 16;
  const rowWidth = Math.max(0, width - side * 2);
  const stride = responsive ? 72 : 78;
  const buttonWidth = Math.min(84, Math.max(68, rowWidth * 0.28));
  return {
    row: rect(side, 64 + index * stride, rowWidth, stride),
    selectButton: rect(side + rowWidth - buttonWidth, 64 + index * stride + 17, buttonWidth, 36),
  };
}

export function getExchangeActivityGrid(
  width: number,
  height: number,
  responsive: boolean,
): ExchangeActivityGrid {
  if (!responsive) {
    const rowStride = height < 130 ? 74 : 70;
    const availableRowsHeight = Math.max(0, height - 10);
    const rowCapacity = availableRowsHeight < 62
      ? 0
      : 1 + Math.floor((availableRowsHeight - 62) / rowStride);
    return {
      columns: 2,
      capacity: Math.min(4, rowCapacity * 2),
      rowsTop: 10,
      rowWidth: Math.min(340, Math.max(0, (width - 150) / 2)),
      rowStride,
      columnGap: 18,
      side: 128,
    };
  }

  const side = width < 360 ? 14 : 16;
  const columnGap = 14;
  const innerWidth = Math.max(0, width - side * 2);
  const candidateWidth = (innerWidth - columnGap) / 2;
  const columns = width > 520 && candidateWidth >= 300 ? 2 : 1;
  const rowWidth = columns === 1 ? innerWidth : candidateWidth;
  const rowsTop = 54;
  const rowStride = 72;
  const rows = Math.max(0, Math.floor((height - rowsTop) / rowStride));
  return {
    columns,
    capacity: Math.min(4, rows * columns),
    rowsTop,
    rowWidth,
    rowStride,
    columnGap,
    side,
  };
}
