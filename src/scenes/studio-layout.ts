import type { Viewport } from '../types';

export interface StudioRect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface StudioLowHeightLandscapeLayout {
  content: StudioRect;
  previewColumn: StudioRect;
  editorPanel: StudioRect;
  editorContent: StudioRect;
  cardArea: StudioRect;
  deckStrip: StudioRect;
  previewCard: StudioRect;
  regenerateButton: StudioRect;
  previewTag: StudioRect;
  themeInput: StudioRect;
  contentPolicyButton: StudioRect;
  generateButton: StudioRect;
  tabs: StudioRect;
  fields: StudioRect;
  markAuthor: StudioRect;
  markStyle: StudioRect;
  markPlacement: StudioRect;
  markCardBackButton: StudioRect;
}

const CARD_RATIO = 88 / 63;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rect(x: number, y: number, width: number, height: number): StudioRect {
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

export function isStudioLowHeightLandscape(viewport: Viewport): boolean {
  return viewport.orientation === 'landscape' && viewport.lowHeight && viewport.width >= 560;
}

export function getStudioLowHeightLandscapeLayout(
  viewport: Viewport,
): StudioLowHeightLandscapeLayout {
  const topGap = viewport.profile.id === 'phone-landscape' ? 6 : 8;
  const contentTop = viewport.profile.navigationHeight + topGap;
  const contentBottom = Math.max(contentTop, viewport.height - viewport.safeBottom);
  const content = rect(
    viewport.safeLeft,
    contentTop,
    Math.max(0, viewport.width - viewport.safeLeft - viewport.safeRight),
    contentBottom - contentTop,
  );
  const gap = viewport.profile.gap;
  const desiredEditorWidth = clamp(viewport.width * 0.4, 280, 380);
  const editorWidth = Math.min(
    desiredEditorWidth,
    Math.max(0, content.width - gap - 240),
  );
  const previewWidth = Math.max(0, content.width - gap - editorWidth);
  const previewColumn = rect(content.x, content.y, previewWidth, content.height);
  const editorPanel = rect(previewColumn.right + gap, content.y, editorWidth, content.height);

  const stripHeight = viewport.height <= 420 ? 58 : 66;
  const deckStrip = rect(
    previewColumn.x,
    Math.max(previewColumn.y, previewColumn.bottom - stripHeight),
    previewColumn.width,
    Math.min(stripHeight, previewColumn.height),
  );
  // Compact strip cards cast outside their nominal bounds, so reserve an
  // optical gutter above the strip rather than relying on its panel rectangle.
  const stripClearance = 24;
  const cardArea = rect(
    previewColumn.x,
    previewColumn.y,
    previewColumn.width,
    Math.max(0, deckStrip.y - previewColumn.y - stripClearance),
  );
  const actionTop = cardArea.y + 4;
  const actionHeight = Math.min(28, cardArea.height);
  const cardTop = actionTop + actionHeight + 4;
  const cardBottom = Math.max(cardTop, cardArea.bottom - 4);
  const cardWidth = Math.max(0, Math.min(
    220,
    previewColumn.width * 0.52,
    (cardBottom - cardTop) / CARD_RATIO,
  ));
  const cardHeight = cardWidth * CARD_RATIO;
  const previewCard = rect(
    previewColumn.x + (previewColumn.width - cardWidth) / 2,
    cardTop + Math.max(0, (cardBottom - cardTop - cardHeight) / 2),
    cardWidth,
    cardHeight,
  );
  const regenerateWidth = Math.min(104, Math.max(0, previewColumn.width - 24));
  const regenerateButton = rect(
    previewColumn.x + 12,
    actionTop,
    regenerateWidth,
    actionHeight,
  );
  const previewTag = rect(
    Math.max(previewColumn.x + 12, previewColumn.right - 102),
    actionTop + 1,
    Math.min(90, Math.max(0, previewColumn.width - 24)),
    Math.min(26, actionHeight),
  );

  const editorContent = rect(
    editorPanel.x + 14,
    editorPanel.y + 8,
    Math.max(0, editorPanel.width - 28),
    Math.max(0, editorPanel.height - 16),
  );
  // CanvasInput enforces 60px when it has a visible label.
  const themeHeight = Math.min(60, editorContent.height);
  const themeWidth = Math.max(0, editorContent.width - 142);
  const themeInput = rect(editorContent.x, editorContent.y, themeWidth, themeHeight);
  const contentPolicyButton = rect(
    editorContent.right - 136,
    editorContent.y + 10,
    40,
    Math.min(40, editorContent.height),
  );
  const generateButton = rect(
    editorContent.right - 90,
    editorContent.y + 10,
    90,
    Math.min(40, editorContent.height),
  );
  const tabs = rect(
    editorContent.x,
    editorContent.y + 62,
    editorContent.width,
    Math.min(34, Math.max(0, editorContent.height - 62)),
  );
  const fieldsTop = tabs.bottom + 8;
  const fields = rect(
    editorContent.x,
    fieldsTop,
    editorContent.width,
    Math.max(0, editorContent.bottom - fieldsTop),
  );
  const markAuthor = rect(
    fields.x,
    fields.y,
    fields.width,
    Math.min(60, fields.height),
  );
  const markControlsTop = Math.min(fields.bottom, markAuthor.bottom + 6);
  const markControlHeight = Math.min(32, Math.max(0, fields.bottom - markControlsTop));
  const markControlGap = Math.min(6, fields.width);
  const markControlWidth = Math.max(0, (fields.width - markControlGap) / 2);
  const markStyle = rect(
    fields.x,
    markControlsTop,
    markControlWidth,
    markControlHeight,
  );
  const markPlacement = rect(
    markStyle.right + markControlGap,
    markControlsTop,
    markControlWidth,
    markControlHeight,
  );
  const markCardBackTop = Math.min(fields.bottom, markStyle.bottom + 6);
  const markCardBackButton = rect(
    fields.x,
    markCardBackTop,
    fields.width,
    Math.min(36, Math.max(0, fields.bottom - markCardBackTop)),
  );

  return {
    content,
    previewColumn,
    editorPanel,
    editorContent,
    cardArea,
    deckStrip,
    previewCard,
    regenerateButton,
    previewTag,
    themeInput,
    contentPolicyButton,
    generateButton,
    tabs,
    fields,
    markAuthor,
    markStyle,
    markPlacement,
    markCardBackButton,
  };
}
