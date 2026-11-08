export type RuleStackControl = 'edit' | 'toggle' | 'up' | 'down' | 'remove';

export interface RuleStackControlPosition {
  x: number;
  y: number;
}

export interface RuleStackRowLayout {
  rowWidth: number;
  rowHeight: number;
  rowStride: number;
  contentX: number;
  contentWidth: number;
  nameY: number;
  summaryY: number;
  controlSize: number;
  controls: Record<RuleStackControl, RuleStackControlPosition>;
}

export interface RuleStackMetaLayout {
  buttonWidth: number;
  buttonHeight: number;
  columns: 1 | 2 | 4;
  positions: ReadonlyArray<RuleStackControlPosition>;
  rowsTop: number;
}

const ROW_SIDE_INSET = 12;
const META_TOP = 64;
const META_BUTTON_HEIGHT = 34;
const META_BUTTON_MIN_WIDTH = 72;
const META_GAP = 5;
const META_ROWS_BOTTOM_GAP = 14;
const CONTENT_X = 48;
const CONTROL_SIZE = 32;
const CONTROL_GAP = 4;
const CONTROL_COLUMNS = 3;
const CONTROL_AREA_WIDTH = CONTROL_SIZE * CONTROL_COLUMNS + CONTROL_GAP * (CONTROL_COLUMNS - 1);
const CONTROL_RIGHT_INSET = 8;
const CONTENT_CONTROL_GAP = 10;

export function planRuleStackMetaLayout(panelWidth: number): RuleStackMetaLayout {
  const availableWidth = Math.max(1, panelWidth - ROW_SIDE_INSET * 2);
  const widthFor = (columns: number): number => (
    (availableWidth - META_GAP * (columns - 1)) / columns
  );
  const columns: 1 | 2 | 4 = widthFor(4) >= META_BUTTON_MIN_WIDTH
    ? 4
    : widthFor(2) >= META_BUTTON_MIN_WIDTH
      ? 2
      : 1;
  const buttonWidth = Math.max(1, widthFor(columns));
  const rowCount = Math.ceil(4 / columns);
  const positions = Array.from({ length: 4 }, (_, index) => ({
    x: ROW_SIDE_INSET + (index % columns) * (buttonWidth + META_GAP),
    y: META_TOP + Math.floor(index / columns) * (META_BUTTON_HEIGHT + META_GAP),
  }));

  return {
    buttonWidth,
    buttonHeight: META_BUTTON_HEIGHT,
    columns,
    positions,
    rowsTop: META_TOP
      + rowCount * META_BUTTON_HEIGHT
      + (rowCount - 1) * META_GAP
      + META_ROWS_BOTTOM_GAP,
  };
}

export function planRuleStackRowLayout(panelWidth: number): RuleStackRowLayout {
  const rowWidth = Math.max(1, panelWidth - ROW_SIDE_INSET * 2);
  const controlsX = rowWidth - CONTROL_RIGHT_INSET - CONTROL_AREA_WIDTH;
  const contentWidth = Math.max(1, controlsX - CONTENT_X - CONTENT_CONTROL_GAP);
  const secondRowY = 37;

  return {
    rowWidth,
    rowHeight: 72,
    rowStride: 78,
    contentX: CONTENT_X,
    contentWidth,
    nameY: 9,
    summaryY: 34,
    controlSize: CONTROL_SIZE,
    controls: {
      edit: { x: controlsX, y: 3 },
      toggle: { x: controlsX + CONTROL_SIZE + CONTROL_GAP, y: 3 },
      remove: { x: controlsX + (CONTROL_SIZE + CONTROL_GAP) * 2, y: 3 },
      up: { x: controlsX + (CONTROL_SIZE + CONTROL_GAP) / 2, y: secondRowY },
      down: { x: controlsX + (CONTROL_SIZE + CONTROL_GAP) * 1.5, y: secondRowY },
    },
  };
}
