export interface LibraryLayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LibraryRowLayout {
  readonly rowX: number;
  readonly rowWidth: number;
  readonly rowHeight: number;
  readonly pitch: number;
  readonly thumbnail: LibraryLayoutRect;
  readonly name: LibraryLayoutRect;
  readonly meta: LibraryLayoutRect;
  readonly source: LibraryLayoutRect;
  readonly divider: LibraryLayoutRect;
  readonly showcase: LibraryLayoutRect;
  readonly open: LibraryLayoutRect;
  readonly selectionBar: LibraryLayoutRect;
}

export const LIBRARY_ROWS_TOP = 48;
export const LIBRARY_PAGINATION_RESERVE = 58;
export const LIBRARY_ROW_OUTER_INSET = 12;
export const LIBRARY_ROW_HEIGHT = 112;
export const LIBRARY_ROW_GAP = 6;
export const LIBRARY_ROW_PITCH = LIBRARY_ROW_HEIGHT + LIBRARY_ROW_GAP;
export const LIBRARY_THUMBNAIL_WIDTH = 72;

const CARD_RATIO = 88 / 63;

export function getLibraryPageSize(listHeight: number): number {
  const available = Math.max(
    0,
    listHeight - LIBRARY_ROWS_TOP - LIBRARY_PAGINATION_RESERVE,
  );
  return Math.max(
    1,
    Math.floor((available + LIBRARY_ROW_GAP) / LIBRARY_ROW_PITCH),
  );
}

export function getLibraryRowsHeight(rowCount: number): number {
  const count = Math.max(0, Math.floor(rowCount));
  return count === 0
    ? 0
    : count * LIBRARY_ROW_HEIGHT + (count - 1) * LIBRARY_ROW_GAP;
}

export function getLibraryRowLayout(listWidth: number): LibraryRowLayout {
  const rowWidth = Math.max(232, listWidth - LIBRARY_ROW_OUTER_INSET * 2);
  const compact = rowWidth < 320;
  const thumbnailWidth = LIBRARY_THUMBNAIL_WIDTH;
  const thumbnailHeight = thumbnailWidth * CARD_RATIO;
  const thumbnailX = compact ? 14 : 16;
  const thumbnailCenterY = LIBRARY_ROW_HEIGHT / 2;
  const infoX = thumbnailX + thumbnailWidth + 12;
  const rightInset = 14;
  const infoWidth = Math.max(60, rowWidth - infoX - rightInset);
  const actionHeight = 32;
  const actionY = 76;
  const openWidth = 74;
  const showcaseWidth = 32;
  const actionGap = 6;
  const openX = rowWidth - rightInset - openWidth;
  const showcaseX = openX - actionGap - showcaseWidth;

  return {
    rowX: LIBRARY_ROW_OUTER_INSET,
    rowWidth,
    rowHeight: LIBRARY_ROW_HEIGHT,
    pitch: LIBRARY_ROW_PITCH,
    thumbnail: {
      x: thumbnailX,
      y: thumbnailCenterY - thumbnailHeight / 2,
      width: thumbnailWidth,
      height: thumbnailHeight,
    },
    name: { x: infoX, y: 7, width: infoWidth, height: 18 },
    meta: { x: infoX, y: 29, width: infoWidth, height: 13 },
    source: { x: infoX, y: 44, width: infoWidth, height: 13 },
    divider: { x: infoX, y: actionY - 4, width: infoWidth, height: 1 },
    showcase: { x: showcaseX, y: actionY, width: showcaseWidth, height: actionHeight },
    open: { x: openX, y: actionY, width: openWidth, height: actionHeight },
    selectionBar: { x: 2, y: 10, width: 4, height: LIBRARY_ROW_HEIGHT - 20 },
  };
}
