export interface PrintSheetCell {
  x: number;
  y: number;
}

export interface PrintLineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const PRINT_PAGE_WIDTH_MM = 210;
export const PRINT_PAGE_HEIGHT_MM = 297;
export const PRINT_CARD_WIDTH_MM = 63;
export const PRINT_CARD_HEIGHT_MM = 88;
export const PRINT_BLEED_MM = 3;
export const PRINT_CROP_MARK_CLEARANCE_MM = 0.25;
export const PRINT_CROP_MARK_LENGTH_MM = 1.5;
export const PRINT_CROP_MARK_STROKE_MM = 0.15;
export const PRINT_CROP_MARK_OFFSET_MM = PRINT_BLEED_MM + PRINT_CROP_MARK_CLEARANCE_MM;

export const RULE_PAGE_LOGICAL_WIDTH_PX = 1400;
export const RULE_PAGE_LOGICAL_HEIGHT_PX = 1980;
export const RULE_PAGE_RASTER_WIDTH_PX = 2480;
export const RULE_PAGE_RASTER_HEIGHT_PX = 3508;

// Two columns leave independent bleed and crop-mark clearance on an A4 sheet.
export const PRINT_SHEET_CELLS: readonly PrintSheetCell[] = [
  { x: 36, y: 6.6 },
  { x: 111, y: 6.6 },
  { x: 36, y: 104.3 },
  { x: 111, y: 104.3 },
  { x: 36, y: 202 },
  { x: 111, y: 202 },
];

export function getCropMarkSegments(
  x: number,
  y: number,
  width = PRINT_CARD_WIDTH_MM,
  height = PRINT_CARD_HEIGHT_MM,
): readonly PrintLineSegment[] {
  const offset = PRINT_CROP_MARK_OFFSET_MM;
  const length = PRINT_CROP_MARK_LENGTH_MM;
  return [
    { x1: x - offset - length, y1: y, x2: x - offset, y2: y },
    { x1: x, y1: y - offset - length, x2: x, y2: y - offset },
    { x1: x + width + offset, y1: y, x2: x + width + offset + length, y2: y },
    { x1: x + width, y1: y - offset - length, x2: x + width, y2: y - offset },
    { x1: x - offset - length, y1: y + height, x2: x - offset, y2: y + height },
    { x1: x, y1: y + height + offset, x2: x, y2: y + height + offset + length },
    {
      x1: x + width + offset,
      y1: y + height,
      x2: x + width + offset + length,
      y2: y + height,
    },
    {
      x1: x + width,
      y1: y + height + offset,
      x2: x + width,
      y2: y + height + offset + length,
    },
  ];
}

export function mirrorPrintCell(cell: PrintSheetCell): PrintSheetCell {
  return {
    x: PRINT_PAGE_WIDTH_MM - cell.x - PRINT_CARD_WIDTH_MM,
    y: cell.y,
  };
}
