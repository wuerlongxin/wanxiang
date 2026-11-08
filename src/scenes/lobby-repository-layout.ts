import type { Viewport } from '../types';

export interface LobbyRepositoryRect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface LobbyRepositoryLayout extends LobbyRepositoryRect {
  stacked: boolean;
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  stacked: boolean,
): LobbyRepositoryLayout {
  return {
    x,
    y,
    width,
    height,
    right: x + width,
    bottom: y + height,
    stacked,
  };
}

export function getLobbyCoreLayout(viewport: Viewport): LobbyRepositoryRect {
  const landscapePhone = viewport.phone && viewport.orientation === 'landscape';
  const width = landscapePhone
    ? Math.min(96, viewport.height * 0.21)
    : viewport.phone
      ? Math.min(112, viewport.width * 0.29)
      : Math.min(178, viewport.height * 0.23);
  const height = width * (88 / 63);
  const centerY = landscapePhone
    ? viewport.profile.navigationHeight + height / 2 + 3
    : viewport.phone
      ? viewport.height * 0.39
      : Math.min(246, viewport.height * 0.28);
  return {
    x: viewport.width / 2 - width / 2,
    y: centerY - height / 2,
    width,
    height,
    right: viewport.width / 2 + width / 2,
    bottom: centerY + height / 2,
  };
}

/**
 * Keeps the repository plaque in a quiet edge region around the lobby fan.
 * Portrait phones use the narrow space left of the forge card; landscape
 */
export function getLobbyRepositoryLayout(viewport: Viewport): LobbyRepositoryLayout {
  const { width, height, phone } = viewport;
  const baseSide = phone ? 18 : 42;
  const left = Math.max(baseSide, viewport.safeLeft);
  const right = Math.max(baseSide, viewport.safeRight);
  const core = getLobbyCoreLayout(viewport);

  if (phone && viewport.orientation !== 'landscape') {
    const coreLeft = core.x;
    const plaqueWidth = Math.max(66, Math.min(112, coreLeft - left - 8));
    return rect(left, 172, plaqueWidth, 66, true);
  }

  if (phone) {
    const plaqueWidth = Math.min(232, Math.max(180, width * 0.27));
    return rect(width - right - plaqueWidth, 128, plaqueWidth, 44, false);
  }

  const coreRight = core.right;
  const availableRightGutter = width - right - coreRight - 10;
  const plaqueWidth = Math.max(132, Math.min(248, availableRightGutter));
  return rect(width - right - plaqueWidth, 136, plaqueWidth, 60, false);
}
